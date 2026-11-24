/** App.tsx 的纯函数辅助 —— 拆出后 App 保持在边界门禁的行数上限内。 */
import { baseName, parseUserText } from "@openbuddy/chat-core/user-text";

/** `/compact [instructions]` typed as the whole message. */
export const COMPACT_COMMAND = /^\/compact(?:\s+([\s\S]*))?$/;

/** Optimistic sidebar title; the engine persists the authoritative one after the first turn. */
export function deriveTitle(text: string): string {
  const display = parseUserText(text);
  const clean = display.text.replace(/^【[^】]{1,12}】/, "").replace(/\s+/g, " ").trim();
  if (!clean) return display.skill ? `技能：${display.skill}` : display.attachments[0] ? `查看 ${baseName(display.attachments[0])}` : "新任务";
  return clean.length > 30 ? clean.slice(0, 30) + "…" : clean;
}

export const sessionStatusOf = (status: "running" | "idle" | "failed") =>
  status === "running" ? ("working" as const) : status === "failed" ? ("failed" as const) : ("completed" as const);

/**
 * Strip YAML frontmatter (`---\n...\n---`) from a markdown agent file and
 * return only the body (the system prompt content).
 */
export function extractMarkdownBody(raw: string): string {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) return raw.trim();
  const afterOpen = trimmed.indexOf("\n");
  if (afterOpen === -1) return raw.trim();
  const rest = trimmed.slice(afterOpen + 1);
  const closeIdx = rest.search(/\n---\s*(\n|$)/);
  if (closeIdx === -1) return raw.trim();
  return rest.slice(closeIdx + 1).replace(/^\n---\s*/, "").trim();
}

const LEVEL_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
/** What Pi will use for a requested level (unset = Pi's default "medium"): the next supported one up. */
export function clampThinking(requested: string | undefined, levels: string[]): string | undefined {
  if (!levels.length) return undefined;
  const want = requested ?? "medium";
  if (levels.includes(want)) return want;
  const i = LEVEL_ORDER.indexOf(want);
  return levels.find((level) => LEVEL_ORDER.indexOf(level) >= i) ?? levels[levels.length - 1];
}
