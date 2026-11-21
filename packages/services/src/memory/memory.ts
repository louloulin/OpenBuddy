import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { MemoryEntry } from "@openbuddy/protocol/dto";
import type { Settings } from "../settings/settings.js";

/**
 * Cross-session memory (20261116-pii W5.1–W5.3). One Markdown file per memory note:
 *
 * - global:  `<agentDir>/memory/**\/*.md`
 * - workspace: `<cwd>/.pi/memory/**\/*.md` — read and written only while the folder is trusted.
 *
 * The built-in `ob_remember` tool appends to `MEMORY.md`; the library panel edits any note.
 * Everything is plain files so users can open, copy and delete them outside the app.
 */
export type MemoryScope = "global" | "workspace";

const MAX_LIST_FILES = 500;
const MAX_DEPTH = 4;
/** The injection budget (W5.2): about 4K tokens, the rest is dropped with a marker. */
export const MEMORY_INJECT_CHARS = 16_000;

export class MemoryService {
  constructor(
    private settings: Settings,
    /** Folder trust gate: workspace memory is invisible without it (same gate as agents / skills). */
    private trusted: (cwd: string) => boolean,
  ) {}

  private root(scope: MemoryScope, cwd?: string): string {
    if (scope === "global") return join(this.settings.dir, "memory");
    if (!cwd) throw Error("memory_no_workspace: 需要先打开任务");
    return join(cwd, ".pi", "memory");
  }

  /** Resolve a user supplied relative path inside a scope; rejects escapes. */
  private target(scope: MemoryScope, path: string, cwd?: string): string {
    const parts = path.split(/[\\/]+/).filter(Boolean);
    if (!parts.length || parts.includes("..") || path.startsWith("/") || /^[A-Za-z]:/.test(path))
      throw Error("memory_invalid_path: 记忆路径必须位于记忆目录内");
    if (!/\.md$/i.test(parts[parts.length - 1])) throw Error("memory_invalid_path: 记忆文件需以 .md 结尾");
    return join(this.root(scope, cwd), ...parts);
  }

  /** Workspace memory requires a trusted folder; listing then reports only global memory. */
  private canReadWorkspace(cwd?: string): cwd is string {
    return !!cwd && this.trusted(cwd);
  }

  async list(cwd?: string): Promise<MemoryEntry[]> {
    const out: MemoryEntry[] = [];
    await this.collect("global", cwd, out);
    if (this.canReadWorkspace(cwd)) await this.collect("workspace", cwd, out);
    return out.sort((a, b) => (a.scope === b.scope ? a.path.localeCompare(b.path) : a.scope === "global" ? -1 : 1));
  }

  private async collect(scope: MemoryScope, cwd: string | undefined, out: MemoryEntry[]) {
    const root = this.root(scope, cwd);
    let entries: Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await this.walk(root, root, entries, scope, out, 0);
  }

  private async walk(
    root: string,
    dir: string,
    entries: Dirent[],
    scope: MemoryScope,
    out: MemoryEntry[],
    depth: number,
  ) {
    for (const item of entries) {
      if (out.length >= MAX_LIST_FILES || item.name.startsWith(".")) return;
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        if (depth >= MAX_DEPTH) continue;
        try {
          await this.walk(root, full, await readdir(full, { withFileTypes: true }), scope, out, depth + 1);
        } catch {
          /* unreadable folder: skip */
        }
        continue;
      }
      if (!item.isFile() || !/\.md$/i.test(item.name)) continue;
      try {
        const info = await stat(full);
        out.push({
          scope,
          path: relative(root, full).split(sep).join("/"),
          content: await readFile(full, "utf8"),
          size: info.size,
        });
      } catch {
        /* vanished between readdir and read */
      }
    }
  }

  async get(scope: MemoryScope, path: string, cwd?: string): Promise<string> {
    if (scope === "workspace" && !this.canReadWorkspace(cwd))
      throw Error("memory_trust_required: 该工作区尚未受信任，不能读取项目记忆");
    return readFile(this.target(scope, path, cwd), "utf8");
  }

  async save(scope: MemoryScope, path: string, content: string, cwd?: string): Promise<MemoryEntry> {
    if (scope === "workspace" && !this.canReadWorkspace(cwd))
      throw Error("memory_trust_required: 该工作区尚未受信任，不能写入项目记忆");
    const file = this.target(scope, path, cwd);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeAtomic(file, content);
    return { scope, path: relative(this.root(scope, cwd), file).split(sep).join("/"), content, size: Buffer.byteLength(content) };
  }

  async delete(scope: MemoryScope, path: string, cwd?: string): Promise<void> {
    if (scope === "workspace" && !this.canReadWorkspace(cwd))
      throw Error("memory_trust_required: 该工作区尚未受信任，不能删除项目记忆");
    await rm(this.target(scope, path, cwd), { force: false });
  }

  /**
   * The model's own note (`ob_remember`): append one bullet to `MEMORY.md` of the global scope.
   * Writes from the agent always land in the global memory; project memory is user-curated.
   */
  async remember(text: string, title?: string): Promise<MemoryEntry> {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 2000);
    if (!clean) throw Error("memory_empty: 记忆内容不能为空");
    const stamp = new Date().toISOString().slice(0, 10);
    const heading = title?.trim().replace(/\s+/g, " ").slice(0, 80);
    const line = `- ${heading ? `**${heading}**：` : ""}${clean}（${stamp}）`;
    const file = this.target("global", "MEMORY.md");
    let current = "";
    try {
      current = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const body = current.trim() ? `${current.replace(/\s+$/, "")}\n${line}\n` : `# 记忆\n\n${line}\n`;
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeAtomic(file, body);
    return { scope: "global", path: "MEMORY.md", content: body, size: Buffer.byteLength(body) };
  }

  /**
   * Consolidate the memory notes (W5.3 "整理记忆"): merge every global note into `MEMORY.md`,
   * deduplicating identical bullets and blank lines. Deterministic, idempotent, and nothing is
   * deleted until the merged file has been written successfully.
   */
  async rewrite(): Promise<{ merged: number; kept: number }> {
    const root = this.root("global");
    const entries = await this.list();
    const global = entries.filter((e) => e.scope === "global");
    const bullets: string[] = [];
    const blocks: string[] = [];
    for (const entry of global) {
      for (const raw of entry.content.split(/\r?\n/)) {
        const line = raw.trimEnd();
        if (/^[-*]\s+/.test(line)) {
          const key = line.replace(/\s+/g, " ").trim();
          if (!bullets.includes(key)) bullets.push(key);
        } else if (line.trim() && !/^#\s/.test(line)) {
          if (!blocks.includes(line.trim())) blocks.push(line.trim());
        }
      }
    }
    const merged = ["# 记忆", "", ...bullets, ...(blocks.length ? ["", ...blocks] : []), ""].join("\n");
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeAtomic(join(root, "MEMORY.md"), merged);
    for (const entry of global) {
      if (entry.path === "MEMORY.md") continue;
      await rm(join(root, entry.path.split("/").join(sep)), { force: true });
    }
    return { merged: global.length, kept: bullets.length };
  }

  /** Everything the model should see at the start of a run (W5.2), within the injection budget. */
  async injection(cwd?: string): Promise<string | undefined> {
    const entries = await this.list(cwd);
    const readable = entries.filter((e) => e.scope === "global" || this.canReadWorkspace(cwd));
    if (!readable.length) return undefined;
    const sections: string[] = [];
    let used = 0;
    for (const entry of readable) {
      const body = entry.content.trim();
      if (!body) continue;
      const label = entry.scope === "global" ? "全局记忆" : "工作区记忆";
      const chunk = `### ${label} · ${entry.path}\n${body}`;
      if (used + chunk.length > MEMORY_INJECT_CHARS) {
        sections.push("（还有更多记忆未展示，可在资料库中查看）");
        break;
      }
      sections.push(chunk);
      used += chunk.length;
    }
    if (!sections.length) return undefined;
    return [
      "## 长期记忆",
      "",
      "以下是用户过去确认过、希望你在以后的任务中继续遵守或参考的记忆。它们是对本次任务上下文的补充，不能覆盖系统规则、安全规则和用户的当前指令。",
      "",
      ...sections,
    ].join("\n");
  }
}

async function writeAtomic(file: string, content: string) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, file);
}
