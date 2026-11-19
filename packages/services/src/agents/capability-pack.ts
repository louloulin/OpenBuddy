import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { WorkBuddyContribution, WorkBuddySkippedContribution } from "@openbuddy/protocol/experts";
import type { WorkBuddyMcpServer, WorkBuddyPackage } from "./workbuddy.js";

/**
 * 能力包安装 (B1b): WorkBuddy 包里的 `skills` / `commands` / `mcpServers` 落到 Pi 的真实装载面。
 *
 * - skills 写到 `<pi>/capability-packs/<pack>/skills/<name>/`，并把 `<…>/skills` 追加到
 *   `openbuddy.json` 的 `skillPaths`；Pi 的 `DefaultResourceLoader` 在会话创建时装载。
 * - commands 写成 `<pi>/prompts/<name>.md`；`promptsOverride` 会把它们并入 `/` 菜单。
 * - mcpServers 交给宿主注册，**一律 `enabled: false`**，由用户显式开启。
 *
 * 这里只做"声明 → 文件/注册"；会话内的真正生效仍由 Pi 的 loader 决定，避免出现第二套真相。
 */

export interface CapabilityPackConfig {
  skillPaths: string[];
  disabledSkills: string[];
}

export interface CapabilityPackConfigStore {
  read(): CapabilityPackConfig;
  write(value: CapabilityPackConfig): void;
}

export type McpRegistrar = (servers: WorkBuddyMcpServer[]) => {
  installed: string[];
  skipped: Array<{ name: string; reason: string }>;
};

export interface CapabilityInstallResult {
  contributions: WorkBuddyContribution[];
  skippedContributions: WorkBuddySkippedContribution[];
  requires: string[];
}

const PACK_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const packIdOf = (name: string): string => {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return PACK_ID.test(slug) ? slug : "workbuddy-pack";
};

/** True when `child` is strictly inside `parent` after normalisation. */
const inside = (child: string, parent: string): boolean => {
  const rel = relative(parent, child);
  return !!rel && !rel.startsWith("..") && !isAbsolute(rel);
};

export class CapabilityPackService {
  constructor(
    /** The app's Pi data dir (`<userData>/pi`). */
    private readonly dir: string,
    private readonly config: CapabilityPackConfigStore,
    private readonly registerMcp?: McpRegistrar,
  ) {}

  install(pkg: WorkBuddyPackage): CapabilityInstallResult {
    const packRoot = join(this.dir, "capability-packs", packIdOf(pkg.name));
    const skillsRoot = join(packRoot, "skills");
    const promptsDir = join(this.dir, "prompts");
    const contributions: WorkBuddyContribution[] = [];
    const skipped: WorkBuddySkippedContribution[] = [...pkg.skippedContributions];

    for (const skill of pkg.skills) {
      const target = join(skillsRoot, skill.name);
      let safe = true;
      for (const file of skill.files) {
        const dest = join(target, file.relative);
        if (!inside(dest, target)) {
          safe = false;
          break;
        }
        mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
        writeFileSync(dest, file.bytes, { mode: 0o600 });
      }
      if (!safe) {
        skipped.push({ kind: "skill", name: skill.name, reason: "包含越界文件路径" });
        continue;
      }
      contributions.push({ kind: "skill", name: skill.name, enabled: pkg.enabledByDefault });
    }

    if (pkg.skills.length) {
      const current = this.config.read();
      const skillPaths = [...current.skillPaths];
      if (!skillPaths.includes(skillsRoot)) skillPaths.push(skillsRoot);
      const disabled = new Set(current.disabledSkills);
      for (const skill of pkg.skills) {
        if (pkg.enabledByDefault) disabled.delete(skill.name);
        else disabled.add(skill.name);
      }
      this.config.write({ skillPaths, disabledSkills: [...disabled] });
    }

    for (const prompt of pkg.prompts) {
      const dest = join(promptsDir, `${prompt.name}.md`);
      if (!inside(dest, promptsDir)) {
        skipped.push({ kind: "command", name: prompt.name, reason: "指令路径越界" });
        continue;
      }
      if (existsSync(dest)) {
        try {
          if (readFileSync(dest).equals(Buffer.from(prompt.content))) {
            contributions.push({ kind: "prompt", name: prompt.name, enabled: true });
            continue;
          }
        } catch {
          /* unreadable: treat as a collision */
        }
        skipped.push({ kind: "command", name: prompt.name, reason: "同名指令已存在，保留用户版本" });
        continue;
      }
      mkdirSync(promptsDir, { recursive: true, mode: 0o700 });
      writeFileSync(dest, prompt.content, { mode: 0o600 });
      contributions.push({ kind: "prompt", name: prompt.name, enabled: true });
    }

    if (pkg.mcpServers.length) {
      if (!this.registerMcp) {
        for (const server of pkg.mcpServers) {
          skipped.push({ kind: "mcp", name: server.name, reason: "当前宿主未提供 MCP 注册" });
        }
      } else {
        const result = this.registerMcp(pkg.mcpServers);
        for (const name of result.installed) contributions.push({ kind: "mcp", name, enabled: false });
        for (const item of result.skipped) skipped.push({ kind: "mcp", name: item.name, reason: item.reason });
      }
    }

    return { contributions, skippedContributions: skipped, requires: pkg.requires };
  }
}
