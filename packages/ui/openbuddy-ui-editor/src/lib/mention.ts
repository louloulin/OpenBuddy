/**
 * mention —— `@` 触发块的纯逻辑层。
 *
 * 与 Composer 的 `MentionPicker.tsx` 的区别:那一个把 `@path` 当纯文本
 * 插入 textarea;本模块服务于 TipTap 的 mention 节点,插入后是一个
 * 带 `data-id` 的原子节点,删除时整体删除、导出时还原为 `@path`。
 */

export interface EditorMentionItem {
  id: string;
  label: string;
  /** 可选副标题(如文件路径 / 角色)。 */
  detail?: string;
  group?: string;
  kind?: "file" | "folder" | "agent" | "skill" | "symbol" | "other";
  /** 额外检索词。 */
  keywords?: string[];
}

export interface MentionTrigger {
  from: number;
  to: number;
  query: string;
}

/**
 * 探测光标前是否是 mention 触发上下文。
 *
 * 规则:
 *   - trigger 必须是行首或紧跟在空白 / `(` / `[` 之后(避免吃掉 email
 *     里的 `@`);
 *   - trigger 与光标之间允许中文、字母数字、`/._-`,不允许空白。
 */
export function detectMentionTrigger(
  textBeforeCursor: string,
  trigger = "@",
): MentionTrigger | null {
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[\\s(\\[])${escaped}([^\\s${escaped}]*)$`);
  const match = pattern.exec(textBeforeCursor);
  if (!match) return null;
  const query = match[2];
  const from = textBeforeCursor.length - query.length - trigger.length;
  return { from, to: textBeforeCursor.length, query };
}

/**
 * 按 query 过滤 mention 候选项。
 *
 * 打分:label 前缀 > label 包含 > detail 包含 > keywords 前缀。
 * 空 query 返回原顺序的前 `limit` 条。
 */
export function filterMentionItems(
  items: readonly EditorMentionItem[],
  query: string,
  limit = 20,
): EditorMentionItem[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return items.slice(0, limit);

  const scored: Array<{ item: EditorMentionItem; score: number }> = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    const detail = (item.detail ?? "").toLowerCase();
    const keywords = (item.keywords ?? []).map((keyword) => keyword.toLowerCase());
    let score = 0;
    if (label === q) score = 100;
    else if (label.startsWith(q)) score = 80;
    else if (label.includes(q)) score = 60;
    else if (keywords.some((keyword) => keyword.startsWith(q))) score = 50;
    else if (detail.includes(q)) score = 30;
    if (score > 0) scored.push({ item, score });
  }
  return scored
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.score - a.entry.score || a.index - b.index)
    .slice(0, limit)
    .map(({ entry }) => entry.item);
}

/** 把 mention 项渲染回 markdown 文本(`@label`),用于导出。 */
export function mentionToMarkdown(item: Pick<EditorMentionItem, "label">): string {
  return `@${item.label}`;
}
