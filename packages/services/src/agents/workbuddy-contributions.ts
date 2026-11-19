import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import type { WorkBuddySkippedContribution } from "@openbuddy/protocol/experts";
import { declaredList, declaredRoots, safeEntry, slugName, text } from "./workbuddy-shared.js";

/** One skill directory from the package: `SKILL.md` plus its adjacent files. */
export interface WorkBuddySkillFile {
  name: string;
  description?: string;
  files: Array<{ relative: string; bytes: Uint8Array }>;
}

/** One prompt/command Markdown file (`commands/*.md`). */
export interface WorkBuddyPromptFile {
  name: string;
  content: Uint8Array;
}

/** One MCP server declaration; installed disabled until the user opts in. */
export interface WorkBuddyMcpServer {
  name: string;
  config: Record<string, unknown>;
}

const MAX_SKILLS = 64;
const MAX_PROMPTS = 128;
const MAX_MCP = 32;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const CONTRIBUTION_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** `skills` → one entry per directory that contains `SKILL.md`, with its adjacent files. */
export function collectSkills(
  files: Map<string, Uint8Array>,
  prefix: string,
  declared: unknown,
  skipped: WorkBuddySkippedContribution[],
): WorkBuddySkillFile[] {
  const dirs = new Set<string>();
  for (const root of declaredRoots(declared, prefix, "skills")) {
    if (files.has(`${root}/SKILL.md`)) {
      dirs.add(root);
      continue;
    }
    for (const key of files.keys()) {
      if (!key.startsWith(`${root}/`) || !/\/SKILL\.md$/i.test(key)) continue;
      const dir = key.slice(0, -9); // remove "/SKILL.md"
      const rest = dir.slice(root.length + 1);
      if (rest && !rest.includes("/")) dirs.add(dir);
    }
  }
  const out: WorkBuddySkillFile[] = [];
  const seen = new Set<string>();
  for (const dir of [...dirs].sort()) {
    const skillMd = files.get(`${dir}/SKILL.md`);
    if (!skillMd) continue;
    const fallback = dir.split("/").pop() ?? "skill";
    let meta: Record<string, unknown> = {};
    try {
      const parsed = parseFrontmatter<Record<string, unknown>>(new TextDecoder().decode(skillMd));
      meta = parsed.frontmatter && typeof parsed.frontmatter === "object" ? parsed.frontmatter : {};
    } catch {
      /* keep the directory name */
    }
    const name = slugName(text(meta.name, 80) ?? fallback);
    if (!CONTRIBUTION_NAME.test(name)) {
      skipped.push({ kind: "skill", name: fallback, reason: "技能名不合法" });
      continue;
    }
    if (seen.has(name)) {
      skipped.push({ kind: "skill", name, reason: "同名技能重复" });
      continue;
    }
    seen.add(name);
    const payload: Array<{ relative: string; bytes: Uint8Array }> = [];
    for (const [key, bytes] of files) {
      if (!key.startsWith(`${dir}/`)) continue;
      const relative = key.slice(dir.length + 1);
      if (!relative || !safeEntry(relative) || bytes.length > MAX_FILE_BYTES) continue;
      payload.push({ relative, bytes });
    }
    const description = text(meta.description, 300);
    out.push({ name, ...(description ? { description } : {}), files: payload });
    if (out.length >= MAX_SKILLS) break;
  }
  return out;
}

/** `commands` → Markdown prompt templates. The file stem is the `/name` invocation. */
export function collectPrompts(
  files: Map<string, Uint8Array>,
  prefix: string,
  declared: unknown,
  skipped: WorkBuddySkippedContribution[],
): WorkBuddyPromptFile[] {
  const out: WorkBuddyPromptFile[] = [];
  const seen = new Set<string>();
  for (const root of declaredRoots(declared, prefix, "commands")) {
    const entries = [...files.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [key, bytes] of entries) {
      if (!key.startsWith(`${root}/`) || !/\.md$/i.test(key)) continue;
      const relative = key.slice(root.length + 1);
      if (!relative || relative.split("/").length > 3 || /(^|\/)readme\.md$/i.test(relative)) continue;
      const rawName = basename(key).replace(/\.md$/i, "");
      const name = slugName(rawName);
      if (!CONTRIBUTION_NAME.test(name)) {
        skipped.push({ kind: "command", name: rawName, reason: "指令名只能包含小写字母、数字、- 和 _" });
        continue;
      }
      if (seen.has(name)) {
        skipped.push({ kind: "command", name, reason: "同名指令重复" });
        continue;
      }
      seen.add(name);
      out.push({ name, content: bytes });
    }
  }
  return out.slice(0, MAX_PROMPTS);
}

const MCP_FIELDS = ["command", "args", "env", "headers", "url", "type", "exposure", "timeout", "cwd"] as const;

/** `mcpServers` → OpenBuddy's config shape. Everything is installed disabled. */
export function collectMcp(value: unknown, skipped: WorkBuddySkippedContribution[]): WorkBuddyMcpServer[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const out: WorkBuddyMcpServer[] = [];
  for (const [rawName, raw] of Object.entries(value as Record<string, unknown>)) {
    const name = rawName.trim().slice(0, 64);
    if (!name || !raw || typeof raw !== "object" || Array.isArray(raw)) {
      skipped.push({ kind: "mcp", name: rawName.slice(0, 64) || "mcp", reason: "配置不是对象" });
      continue;
    }
    const config = raw as Record<string, unknown>;
    if (config.auth !== undefined) {
      skipped.push({ kind: "mcp", name, reason: "需要宿主令牌委托，暂不自动导入" });
      continue;
    }
    if (!text(config.command, 2048) && !text(config.url, 2048)) {
      skipped.push({ kind: "mcp", name, reason: "缺少 command 或 url" });
      continue;
    }
    const sanitized: Record<string, unknown> = { enabled: false };
    for (const key of MCP_FIELDS) if (config[key] !== undefined) sanitized[key] = config[key];
    out.push({ name, config: sanitized });
  }
  return out.slice(0, MAX_MCP);
}

export function declaredRequires(plugin: {
  requiresProductFeature?: unknown;
  workbuddy?: { requiresProductFeature?: unknown };
}): string[] {
  return [...new Set([
    ...declaredList(plugin.requiresProductFeature),
    ...declaredList(plugin.workbuddy?.requiresProductFeature),
  ])].slice(0, 16);
}
