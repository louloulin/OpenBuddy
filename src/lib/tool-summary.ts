import type { ToolCallView } from "@/stores/session-store";
import type { DiffLine } from "@/lib/unified-diff";

/** Pi built-in tools and MCP tools in plain words. */
const LABELS: Record<string, string> = {
  bash: "执行命令",
  powershell: "执行命令",
  read: "读取文件",
  write: "写入文件",
  edit: "编辑文件",
  grep: "搜索内容",
  find: "查找文件",
  ls: "查看目录",
};

export type ToolCategory = "command" | "read" | "write" | "search" | "mcp" | "other";

export function toolCategory(name: string): ToolCategory {
  if (name === "bash" || name === "powershell") return "command";
  if (name === "read" || name === "ls") return "read";
  if (name === "write" || name === "edit") return "write";
  if (name === "grep" || name === "find") return "search";
  if (name.startsWith("mcp__")) return "mcp";
  return "other";
}

/** "mcp__github__create_issue" → { server: "github", tool: "create_issue" } */
export function mcpParts(name: string): { server: string; tool: string } | undefined {
  const match = name.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/);
  return match ? { server: match[1], tool: match[2] } : undefined;
}

export function toolLabel(name: string): string {
  if (LABELS[name]) return LABELS[name];
  const mcp = mcpParts(name);
  if (mcp) return `${mcp.server} · ${mcp.tool}`;
  return name || "工具";
}

function args(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}
const str = (value: unknown) => (typeof value === "string" ? value : undefined);

/** Shorten an absolute path relative to the workspace. */
export function displayPath(path: string, cwd?: string): string {
  if (cwd && path.startsWith(cwd)) {
    const rest = path.slice(cwd.length).replace(/^[\\/]+/, "");
    return rest || ".";
  }
  return path;
}

/** The object of a tool call: command, path or pattern. */
export function toolSubject(name: string, input: unknown, cwd?: string): string {
  const a = args(input);
  if (name === "bash" || name === "powershell") return (str(a.command) ?? "").split("\n")[0];
  if (["read", "write", "edit", "ls"].includes(name)) return displayPath(str(a.path) ?? (name === "ls" ? "." : ""), cwd);
  if (name === "grep") {
    const where = str(a.path) ? ` · ${displayPath(str(a.path)!, cwd)}` : "";
    return `${str(a.pattern) ?? ""}${where}`;
  }
  if (name === "find") return str(a.pattern) ?? "";
  const first = Object.values(a).find((value) => typeof value === "string");
  return typeof first === "string" ? first.split("\n")[0] : "";
}

/** Parse a unified patch (Pi edit `details.patch`) into diff lines. */
export function patchLines(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const line of patch.split("\n")) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("Index:") || line.startsWith("====")) continue;
    if (line.startsWith("+")) lines.push({ kind: "add", text: line.slice(1), newLine: newLine++ });
    else if (line.startsWith("-")) lines.push({ kind: "del", text: line.slice(1), oldLine: oldLine++ });
    else if (line.startsWith(" ")) lines.push({ kind: "context", text: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
  }
  return lines;
}

/** Diff of a file-changing tool call, when one is known. */
export function toolDiff(tc: ToolCallView): { path: string; lines: DiffLine[] } | undefined {
  const a = args(tc.rawInput);
  const path = str(a.path) ?? "";
  if (tc.kind === "edit") {
    const details = args(tc.details);
    const patch = str(details.patch);
    if (patch) return { path, lines: patchLines(patch) };
    return undefined;
  }
  if (tc.kind === "write") {
    const content = str(a.content);
    if (content === undefined) return undefined;
    return { path, lines: content.split("\n").map((text, i) => ({ kind: "add" as const, text, newLine: i + 1 })) };
  }
  return undefined;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "add") added++;
    else if (line.kind === "del") removed++;
  }
  return { added, removed };
}

/** Plain text output of a tool call. */
export function toolOutput(tc: ToolCallView): string {
  return tc.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

export function formatDuration(ms?: number): string {
  if (ms === undefined || ms < 0) return "";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

/** Title of an approval card: what kind of operation is asking. */
export function permissionTitle(name: string): string {
  switch (toolCategory(name)) {
    case "command": return "执行命令需要确认";
    case "write": return name === "edit" ? "修改文件需要确认" : "写入文件需要确认";
    case "read": return "读取文件需要确认";
    case "search": return "搜索文件需要确认";
    case "mcp": return `调用 ${toolLabel(name)} 需要确认`;
    default: return `使用 ${toolLabel(name)} 需要确认`;
  }
}

/** Label of the approval card's object row. */
export function permissionObjectLabel(name: string): string {
  switch (toolCategory(name)) {
    case "command": return "命令";
    case "write":
    case "read": return "文件";
    case "search": return "范围";
    default: return "参数";
  }
}
