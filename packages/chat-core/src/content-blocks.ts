/**
 * Composer 多块提示组装 —— 对齐 WorkBuddy `cb-chat-ui/chat-input/use-content-blocks`
 * + `mentions`(多块提示:文本 / @skill / @expert / @文件 引用)。
 *
 * 一个 prompt 由有序的「块」组成:
 *  - text:普通文本片段
 *  - skill:引用一个技能(组装时展开为 skill:// 块 + 名称)
 *  - expert:引用一个专家(组装时展开为角色前缀)
 *  - file:引用一个文件路径(组装时作为「相关文件」附加;输入框里写作 `@路径`,见文末 mention 工具)
 *
 * 纯函数:块的定义、增删/重排/校验、组装成最终发送文本。便于单测,与 Composer 解耦。
 */
import type { AgentEntry } from "@openbuddy/protocol/dto";

/** 内容块类型。 */
export type ContentBlock =
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "skill"; name: string }
  | { id: string; kind: "expert"; expert: AgentEntry }
  | { id: string; kind: "file"; path: string };

let seq = 0;
/** 生成稳定 id。 */
export function blockId(): string {
  seq += 1;
  return `blk_${Date.now().toString(36)}_${seq}`;
}

/** 创建各类块。 */
export const blocks = {
  text: (text = ""): ContentBlock => ({ id: blockId(), kind: "text", text }),
  skill: (name: string): ContentBlock => ({ id: blockId(), kind: "skill", name }),
  expert: (expert: AgentEntry): ContentBlock => ({ id: blockId(), kind: "expert", expert }),
  file: (path: string): ContentBlock => ({ id: blockId(), kind: "file", path }),
};

/** 增删改查:在末尾追加。返回新数组。 */
export function appendBlock(list: ContentBlock[], block: ContentBlock): ContentBlock[] {
  return [...list, block];
}

/** 删除指定 id。返回新数组。 */
export function removeBlock(list: ContentBlock[], id: string): ContentBlock[] {
  return list.filter((b) => b.id !== id);
}

/** 更新指定 id 的文本块内容;非文本块或空 id 忽略。 */
export function updateTextBlock(list: ContentBlock[], id: string, text: string): ContentBlock[] {
  return list.map((b) => (b.id === id && b.kind === "text" ? { ...b, text } : b));
}

/** 移动指定 id 到新位置(0-based,clamp)。返回新数组。 */
export function moveBlock(list: ContentBlock[], from: number, to: number): ContentBlock[] {
  if (from < 0 || from >= list.length) return list;
  const clampedTo = Math.max(0, Math.min(to, list.length - 1));
  if (from === clampedTo) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(clampedTo, 0, moved);
  return next;
}

/** 校验:至少有一个非空文本块或任意引用块。 */
export function isSubmittable(list: ContentBlock[]): boolean {
  if (list.length === 0) return false;
  return list.some(
    (b) =>
      (b.kind === "text" && b.text.trim().length > 0) ||
      b.kind === "skill" ||
      b.kind === "expert" ||
      b.kind === "file",
  );
}

/**
 * 把块序列组装成最终发送给 agent 的文本。
 *  - expert:作为角色前缀(`【角色 — 名】` + 描述/正文)
 *  - skill:展开为 `skill://name` 引用块
 *  - text:原样拼接
 *  - file:聚合成「相关文件」清单附在末尾
 *
 * 顺序保持用户排列顺序;file 统一后置(对齐 WorkBuddy 附件行为)。
 */
export function assemblePrompt(list: ContentBlock[]): string {
  const segs: string[] = [];
  const files: string[] = [];
  for (const b of list) {
    if (b.kind === "text") {
      const t = b.text.trim();
      if (t) segs.push(t);
    } else if (b.kind === "expert") {
      const body = b.expert.description?.trim() || b.expert.name;
      segs.push(`【角色 — ${b.expert.name}】\n从现在起以该专家身份作答。\n${body}`);
    } else if (b.kind === "skill") {
      segs.push(`skill://${b.name}`);
    } else if (b.kind === "file") {
      files.push(b.path);
    }
  }
  if (files.length > 0) {
    segs.push("相关文件:\n" + files.map((p) => `- ${p}`).join("\n"));
  }
  return segs.join("\n\n");
}

/** 块的可读预览(用于 UI chip 文案)。 */
export function blockLabel(block: ContentBlock): string {
  switch (block.kind) {
    case "text":
      return block.text.trim().slice(0, 30) || "(空文本)";
    case "skill":
      return `@${block.name}`;
    case "expert":
      return `@${block.expert.name}`;
    case "file":
      return `📎 ${block.path.replace(/\\/g, "/").split("/").pop()}`;
  }
}

// ---- `@` 文件引用 (20261116-pii W1.3) ----
// In the composer a file is referenced inline as `@path` (`@"path with spaces"`), relative to the
// workspace; the model opens it with its read tool. Skill / expert references stay blocks, so a
// bare `@name` without a path separator or extension is never taken for a file.

/** The `@query` being typed at the cursor (at the start or after whitespace, so e-mail addresses never match). */
export function mentionToken(text: string, cursor: number): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const match = before.match(/(^|\s)@([^\s@"]*)$/);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2] };
}

/** How a file reference is written into the prompt. */
export function formatFileMention(path: string): string {
  const p = path.replace(/\\/g, "/");
  return /[\s"]/.test(p) ? `@"${p.replace(/"/g, "'")}"` : `@${p}`;
}

/** Replace the `@query` token at the caret with a reference to `path` (plus one space). */
export function insertFileMention(text: string, token: { start: number }, cursor: number, path: string): { text: string; cursor: number } {
  const after = text.slice(cursor).replace(/^\S*/, "");
  const head = text.slice(0, token.start) + formatFileMention(path) + " ";
  return { text: head + after.replace(/^ /, ""), cursor: head.length };
}

const MENTION = /(^|\s)@(?:"([^"\n]+)"|([^\s@"]+))/g;
const looksLikePath = (value: string) => /[/\\]/.test(value) || /\.[A-Za-z0-9]{1,8}$/.test(value);

/** File references in `text`: where each starts and ends, and the path. */
function mentionsIn(text: string): Array<{ start: number; end: number; path: string }> {
  const out: Array<{ start: number; end: number; path: string }> = [];
  for (const m of text.matchAll(MENTION)) {
    const start = m.index! + m[1].length;
    if (m[2] !== undefined) { out.push({ start, end: start + m[2].length + 3, path: m[2] }); continue; }
    // Sentence punctuation right after a bare path is not part of it.
    const path = m[3].replace(/[),.;:!?，。；：！？）]+$/, "");
    if (path && looksLikePath(path)) out.push({ start, end: start + 1 + path.length, path });
  }
  return out;
}

/** File paths referenced in a prompt, in order, without duplicates. */
export function fileMentions(text: string): string[] {
  return [...new Set(mentionsIn(text).map((m) => m.path))];
}

/** Split typed text into text and file blocks (the inverse of writing `@path` references). */
export function blocksFromText(text: string): ContentBlock[] {
  const out: ContentBlock[] = [];
  let last = 0;
  for (const m of mentionsIn(text)) {
    if (m.start > last) out.push(blocks.text(text.slice(last, m.start)));
    out.push(blocks.file(m.path));
    last = m.end;
  }
  if (last < text.length) out.push(blocks.text(text.slice(last)));
  return out;
}
