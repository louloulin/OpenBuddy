/**
 * mention —— `@` 触发块的纯逻辑层。
 *
 * 与 Composer 的 `MentionPicker.tsx` 的区别:那一个把 `@path` 当纯文本
 * 插入 textarea;本模块服务于 TipTap 的 mention 节点,插入后是一个
 * 带 `data-id` 的原子节点,删除时整体删除、导出时还原为 `@path`。
 *
 * 插件扩展点:`editor.mention-sources` 槽位可以让插件追加候选来源
 * (文件 / 专家 / skill / MCP 工具之外的第四方来源),聚合逻辑在
 * `gatherMentionItems` —— 单个来源抛错不影响其它来源。
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

/**
 * 结构守卫:插件可能塞进 null / 缺字段的条目。
 *
 * 先守卫再过滤的原因:`filterMentionItems` 会直接读 `item.label`,一条脏数据
 * 就能把整个来源打挂(异常被 gatherMentionItems 吞掉 → 来源静默变空)。
 */
export function isMentionItem(value: unknown): value is EditorMentionItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<EditorMentionItem>;
  return typeof item.id === "string" && typeof item.label === "string";
}

/** 插件通过 `editor.mention-sources` 槽位贡献的一条候选来源。 */
export interface EditorMentionSource {
  /** 唯一 id,用于去重与调试。 */
  id: string;
  /** 人类可读的来源名(菜单分组用)。 */
  label?: string;
  /** 静态候选:一次性候选列表,由内核统一按 query 过滤。 */
  items?: readonly EditorMentionItem[];
  /** 动态候选:按 query 拉取(比 items 优先,适合远端 / 大列表)。 */
  getItems?: (query: string) => EditorMentionItem[] | Promise<EditorMentionItem[]>;
}

/**
 * 聚合所有来源的候选。
 *
 * 设计取舍:
 *   - **串行** await:来源数量是个位数,串行让"最近使用优先"的顺序可预期,
 *     并行反而需要额外排序;
 *   - **单点容错**:某个来源抛错只丢它自己的条目,其余来源照常;
 *   - **按 id 去重**:同一文件同时被"最近打开"和"工作区"两个来源命中时只留一条。
 */
export async function gatherMentionItems(
  sources: readonly (EditorMentionSource | undefined | null)[] | undefined,
  query: string,
  limit = 20,
): Promise<EditorMentionItem[]> {
  if (!sources || sources.length === 0) return [];
  const collected: EditorMentionItem[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    let items: readonly EditorMentionItem[] | undefined;
    try {
      if (typeof source.getItems === "function") {
        items = (await source.getItems(query)) ?? [];
      } else if (Array.isArray(source.items)) {
        items = filterMentionItems(source.items.filter(isMentionItem), query, limit);
      }
    } catch {
      continue;
    }
    for (const item of items ?? []) {
      if (!isMentionItem(item)) continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      collected.push(item);
      if (collected.length >= limit) return collected;
    }
  }
  return collected;
}

/** 把 mention 项渲染回 markdown 文本(`@label`),用于导出。 */
export function mentionToMarkdown(item: Pick<EditorMentionItem, "label">): string {
  return `@${item.label}`;
}
