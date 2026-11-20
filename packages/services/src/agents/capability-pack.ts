import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { CapabilityPack, CapabilityPackRemoval, WorkBuddyContribution, WorkBuddySkippedContribution } from "@openbuddy/protocol/experts";
import type { WorkBuddyMcpServer, WorkBuddyPackage } from "./workbuddy.js";

/**
 * 能力包 (B1b/B1a): WorkBuddy 包里的 `skills` / `commands` / `mcpServers` 落到 Pi 的真实装载面。
 *
 * - skills 写到 `<pi>/capability-packs/<pack>/skills/<name>/`，并把 `<…>/skills` 追加到
 *   `openbuddy.json` 的 `skillPaths`；Pi 的 `DefaultResourceLoader` 在会话创建时装载。
 * - commands 写成 `<pi>/prompts/<name>.md`；`promptsOverride` 会把它们并入 `/` 菜单。
 *   禁用时改名为 `<name>.md.disabled`（Pi 只扫描 `.md`），用户改动过的文件在移除时保留。
 * - mcpServers 交给宿主注册，**一律 `enabled: false`**，由用户显式开启；包级禁用只关闭，不删除。
 * - 每个包装载时写 `pack.json` 描述符：整体/逐项开关与“回退到安装前”都以此为准，重启后可恢复。
 *
 * 这里只做“声明 → 文件/注册”；会话内的真正生效仍由 Pi 的 loader 决定，避免出现第二套真相。
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
  /** The descriptor id: use it for 整体启停 / 逐项开关 / 移除 (B1a). */
  packId: string;
}

const PACK_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PROMPT_NAME = /^[A-Za-z0-9._-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;

const packIdOf = (name: string): string => {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return PACK_ID.test(slug) ? slug : "workbuddy-pack";
};

/** True when `child` is strictly inside `parent` after normalisation. */
const inside = (child: string, parent: string): boolean => {
  const rel = relative(parent, child);
  return !!rel && !rel.startsWith("..") && !isAbsolute(rel);
};

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

interface StoredContribution extends WorkBuddyContribution {
  /** Prompt only: sha256 of the text we wrote, so removal never deletes a user rewrite. */
  hash?: string;
}

interface StoredPack {
  schemaVersion: 1;
  id: string;
  name: string;
  installedAt: number;
  enabled: boolean;
  requires: string[];
  contributions: StoredContribution[];
  skipped: WorkBuddySkippedContribution[];
}

const contributionKinds = new Set(["skill", "prompt", "mcp"]);

export class CapabilityPackService {
  constructor(
    /** The app's Pi data dir (`<userData>/pi`). */
    private readonly dir: string,
    private readonly config: CapabilityPackConfigStore,
    private readonly registerMcp?: McpRegistrar,
    /** Switch one registered MCP server (pack-level disable must not leave a live tool). */
    private readonly setMcpEnabled?: (name: string, enabled: boolean) => void,
    /** Current MCP switch state, so the descriptor view does not go stale after 连接器 edits. */
    private readonly mcpEnabled?: (name: string) => boolean,
  ) {}

  private get packsDir() {
    return join(this.dir, "capability-packs");
  }

  private get promptsDir() {
    return join(this.dir, "prompts");
  }

  private packDir(id: string): string {
    if (!PACK_ID.test(id)) throw Error("invalid_payload: packId");
    return join(this.packsDir, id);
  }

  private skillsRoot(id: string): string {
    return join(this.packDir(id), "skills");
  }

  private recordPath(id: string): string {
    return join(this.packDir(id), "pack.json");
  }

  private readRecord(id: string): StoredPack | undefined {
    try {
      const data = JSON.parse(readFileSync(this.recordPath(id), "utf8")) as Record<string, unknown>;
      if (data.schemaVersion !== 1 || data.id !== id || typeof data.name !== "string" || !Array.isArray(data.contributions)) return undefined;
      const contributions: StoredContribution[] = [];
      for (const item of data.contributions) {
        if (!item || typeof item !== "object") continue;
        const value = item as Record<string, unknown>;
        const kind = String(value.kind);
        if (!contributionKinds.has(kind) || typeof value.name !== "string" || typeof value.enabled !== "boolean") continue;
        contributions.push({
          kind: kind as StoredContribution["kind"],
          name: value.name,
          enabled: value.enabled,
          ...(typeof value.hash === "string" && HASH.test(value.hash) ? { hash: value.hash } : {}),
        });
      }
      return {
        schemaVersion: 1,
        id,
        name: data.name,
        installedAt: typeof data.installedAt === "number" ? data.installedAt : Date.now(),
        enabled: data.enabled !== false,
        requires: Array.isArray(data.requires) ? data.requires.filter((item): item is string => typeof item === "string") : [],
        contributions,
        skipped: Array.isArray(data.skipped) ? (data.skipped as WorkBuddySkippedContribution[]) : [],
      };
    } catch {
      return undefined;
    }
  }

  private writeRecord(pack: StoredPack): void {
    mkdirSync(this.packDir(pack.id), { recursive: true, mode: 0o700 });
    writeFileSync(this.recordPath(pack.id), JSON.stringify(pack, null, 2), { mode: 0o600 });
  }

  /** The public view (no local hashes). */
  private publicRecord(pack: StoredPack): CapabilityPack {
    return {
      id: pack.id,
      name: pack.name,
      installedAt: pack.installedAt,
      enabled: pack.enabled,
      requires: [...pack.requires],
      contributions: pack.contributions.map(({ kind, name, enabled }) => ({
        kind,
        name,
        enabled: kind === "mcp" ? (this.mcpEnabled?.(name) ?? enabled) : enabled,
      })),
      skipped: [...pack.skipped],
    };
  }

  /** Every installed pack, newest first. A corrupt descriptor is skipped, never thrown at the UI. */
  list(): CapabilityPack[] {
    let ids: string[];
    try {
      ids = readdirSync(this.packsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && PACK_ID.test(entry.name)).map((entry) => entry.name);
    } catch {
      return [];
    }
    const packs: CapabilityPack[] = [];
    for (const id of ids) {
      const record = this.readRecord(id);
      if (record) packs.push(this.publicRecord(record));
    }
    return packs.sort((a, b) => b.installedAt - a.installedAt);
  }

  install(pkg: WorkBuddyPackage): CapabilityInstallResult {
    const id = packIdOf(pkg.name);
    const packRoot = this.packDir(id);
    const skillsRoot = this.skillsRoot(id);
    const contributions: StoredContribution[] = [];
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
      const dest = join(this.promptsDir, `${prompt.name}.md`);
      const off = `${dest}.disabled`;
      if (!inside(dest, this.promptsDir) || !PROMPT_NAME.test(prompt.name)) {
        skipped.push({ kind: "command", name: prompt.name, reason: "指令路径越界" });
        continue;
      }
      // A disabled copy from an earlier install comes back before the collision check.
      if (!existsSync(dest) && existsSync(off)) renameSync(off, dest);
      if (existsSync(dest)) {
        let same = false;
        try {
          same = readFileSync(dest).equals(Buffer.from(prompt.content));
        } catch {
          /* unreadable: treat as a collision */
        }
        if (same) {
          contributions.push({ kind: "prompt", name: prompt.name, enabled: true, hash: sha(prompt.content) });
          continue;
        }
        skipped.push({ kind: "command", name: prompt.name, reason: "同名指令已存在，保留用户版本" });
        continue;
      }
      mkdirSync(this.promptsDir, { recursive: true, mode: 0o700 });
      writeFileSync(dest, prompt.content, { mode: 0o600 });
      contributions.push({ kind: "prompt", name: prompt.name, enabled: true, hash: sha(prompt.content) });
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

    const record: StoredPack = {
      schemaVersion: 1,
      id,
      name: pkg.name,
      installedAt: Date.now(),
      enabled: pkg.enabledByDefault,
      requires: [...pkg.requires],
      contributions,
      skipped,
    };
    this.writeRecord(record);
    return {
      contributions: this.publicRecord(record).contributions,
      skippedContributions: skipped,
      requires: record.requires,
      packId: id,
    };
  }

  /** Enable or disable every contribution of one pack (MCP stays opt-in: disabling always turns it off). */
  setEnabled(id: string, enabled: boolean): CapabilityPack[] {
    const record = this.readRecord(id);
    if (!record) throw Error("capability_pack_not_found");
    for (const item of record.contributions) {
      if (item.kind === "mcp") {
        if (!enabled) this.toggleMcp(item.name, false);
        continue;
      }
      this.applyContribution(item, enabled);
      item.enabled = enabled;
    }
    record.enabled = enabled;
    this.writeRecord(record);
    return this.list();
  }

  /** Toggle one skill / prompt / MCP contribution; the pack switch follows the result. */
  setContribution(id: string, kind: "skill" | "prompt" | "mcp", name: string, enabled: boolean): CapabilityPack[] {
    const record = this.readRecord(id);
    if (!record) throw Error("capability_pack_not_found");
    const item = record.contributions.find((entry) => entry.kind === kind && entry.name === name);
    if (!item) throw Error("capability_contribution_not_found");
    this.applyContribution(item, enabled);
    item.enabled = enabled;
    const manageable = record.contributions.filter((entry) => entry.kind !== "mcp");
    record.enabled = manageable.some((entry) => entry.enabled);
    this.writeRecord(record);
    return this.list();
  }

  /**
   * Return to the pre-install state: delete the pack's skill files and prompt templates, drop the
   * skill path, and turn pack-registered MCP servers off (never delete a config the user may have
   * edited). A prompt the user rewrote is kept and reported.
   */
  remove(id: string): CapabilityPackRemoval {
    const record = this.readRecord(id);
    if (!record) throw Error("capability_pack_not_found");
    const kept: string[] = [];
    const current = this.config.read();
    const skillNames = new Set(record.contributions.filter((entry) => entry.kind === "skill").map((entry) => entry.name));
    const skillPaths = current.skillPaths.filter((entry) => entry !== this.skillsRoot(id));
    const disabledSkills = current.disabledSkills.filter((name) => !skillNames.has(name));
    if (skillPaths.length !== current.skillPaths.length || disabledSkills.length !== current.disabledSkills.length)
      this.config.write({ skillPaths, disabledSkills });
    for (const item of record.contributions) {
      if (item.kind === "prompt") {
        const base = join(this.promptsDir, `${item.name}.md`);
        for (const file of [base, `${base}.disabled`]) {
          if (!existsSync(file)) continue;
          let removable = !item.hash;
          try {
            removable = !item.hash || sha(readFileSync(file)) === item.hash;
          } catch {
            removable = false;
          }
          if (removable) rmSync(file, { force: true });
          else kept.push(`prompt:${item.name}`);
        }
      } else if (item.kind === "mcp") {
        this.toggleMcp(item.name, false);
      }
    }
    rmSync(this.packDir(id), { recursive: true, force: true });
    return { packId: id, removed: true, kept };
  }

  private applyContribution(item: StoredContribution, enabled: boolean): void {
    if (item.kind === "skill") this.toggleSkill(item.name, enabled);
    else if (item.kind === "prompt") this.togglePrompt(item.name, enabled);
    else this.toggleMcp(item.name, enabled);
  }

  private toggleSkill(name: string, enabled: boolean): void {
    const current = this.config.read();
    const disabled = new Set(current.disabledSkills);
    if (enabled) disabled.delete(name);
    else disabled.add(name);
    this.config.write({ skillPaths: current.skillPaths, disabledSkills: [...disabled] });
  }

  private togglePrompt(name: string, enabled: boolean): void {
    if (!PROMPT_NAME.test(name)) return;
    const base = join(this.promptsDir, `${name}.md`);
    const off = `${base}.disabled`;
    if (!inside(base, this.promptsDir)) return;
    if (enabled) {
      if (!existsSync(base) && existsSync(off)) renameSync(off, base);
      return;
    }
    if (existsSync(base)) renameSync(base, off);
  }

  private toggleMcp(name: string, enabled: boolean): void {
    try {
      this.setMcpEnabled?.(name, enabled);
    } catch {
      /* a removed server must not block the pack switch */
    }
  }
}
