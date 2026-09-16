/**
 * slash-command —— `/` 触发块的纯逻辑层(与 TipTap 解耦,便于单测)。
 *
 * 与 composer 输入框的 `SlashCommands.tsx` 不同:那一个是"往 textarea
 * 里插文本",本模块服务于 TipTap 的 suggestion 插件,选中后直接改写
 * ProseMirror 文档节点(插入标题 / 表格 / 图表等真实块)。
 */

export type SlashCommandKind =
  | "heading"
  | "list"
  | "block"
  | "insert"
  | "media";

export interface EditorSlashCommand {
  /** 唯一 id,同时作为 suggestion 的 item key。 */
  id: string;
  /** 中文标题(菜单主文本)。 */
  title: string;
  /** 次要说明,展示在标题下方。 */
  description?: string;
  /** 检索用的英文别名 / 拼音缩写。 */
  aliases?: string[];
  kind: SlashCommandKind;
  /** emoji 或单字符图标(与仓库其它菜单的图标策略一致)。 */
  icon: string;
  /** 分组名,菜单按组渲染。 */
  group: string;
}

/**
 * 内置命令表。
 * 顺序即默认展示顺序,分组按 `group` 聚合。
 */
export const DEFAULT_SLASH_COMMANDS: readonly EditorSlashCommand[] = [
  { id: "h1", title: "一级标题", description: "章节大标题", aliases: ["h1", "title", "biaoti"], kind: "heading", icon: "H₁", group: "基础块" },
  { id: "h2", title: "二级标题", description: "小节标题", aliases: ["h2", "subtitle"], kind: "heading", icon: "H₂", group: "基础块" },
  { id: "h3", title: "三级标题", description: "更小的层级", aliases: ["h3"], kind: "heading", icon: "H₃", group: "基础块" },
  { id: "bullet", title: "无序列表", description: "圆点列表", aliases: ["ul", "bullet", "list"], kind: "list", icon: "•", group: "基础块" },
  { id: "ordered", title: "有序列表", description: "编号列表", aliases: ["ol", "ordered", "number"], kind: "list", icon: "1.", group: "基础块" },
  { id: "task", title: "任务列表", description: "可勾选待办", aliases: ["todo", "task", "check"], kind: "list", icon: "☑", group: "基础块" },
  { id: "quote", title: "引用", description: "引用块", aliases: ["quote", "blockquote"], kind: "block", icon: "❝", group: "基础块" },
  { id: "divider", title: "分隔线", description: "水平分隔", aliases: ["hr", "divider", "line"], kind: "insert", icon: "―", group: "基础块" },
  { id: "code", title: "代码块", description: "等宽代码块", aliases: ["code", "fence"], kind: "block", icon: "{ }", group: "技术块" },
  { id: "table", title: "表格", description: "3×3 可编辑表格", aliases: ["table", "grid"], kind: "insert", icon: "▦", group: "技术块" },
  { id: "mermaid", title: "Mermaid 图表", description: "流程图 / 时序图", aliases: ["mermaid", "diagram", "flow"], kind: "insert", icon: "◇", group: "技术块" },
  { id: "math", title: "数学公式", description: "块级 KaTeX 公式", aliases: ["math", "katex", "formula", "gongshi"], kind: "insert", icon: "∑", group: "技术块" },
  { id: "image", title: "图片", description: "按 URL 插入图片", aliases: ["image", "img", "picture"], kind: "media", icon: "▣", group: "媒体" },
];

export interface SlashTrigger {
  /** 触发字符所在位置(含 `/`)。 */
  from: number;
  /** `to` 通常是光标位置。 */
  to: number;
  /** `/` 之后、光标之前的文本。 */
  query: string;
}

/**
 * 探测光标前是否是 slash 触发上下文。
 *
 * 规则(与 Composer 的 `/` 行为保持一致,避免两处语义漂移):
 *   - `/` 必须是行首或紧跟在空白之后(因此 URL / 路径内部的 `/` 不会触发);
 *   - `/` 与光标之间不能出现空白(出现即视为普通文本);
 *   - query 里允许再出现 `/`,因为 PI 的命令名本身带斜杠(如 `/mcp/reload`)。
 */
export function detectSlashTrigger(textBeforeCursor: string): SlashTrigger | null {
  const match = /(^|[\s\n])\/(\S*)$/.exec(textBeforeCursor);
  if (!match) return null;
  const query = match[2];
  const from = textBeforeCursor.length - query.length - 1;
  return { from, to: textBeforeCursor.length, query };
}

/**
 * 按 query 过滤 + 排序命令。
 *
 * 打分规则(高 → 低):id 完全相等 > id 前缀 > title 包含 > alias 前缀 >
 * description 包含。空 query 时保持原顺序(即 DEFAULT 顺序)。
 */
export function filterSlashCommands(
  commands: readonly EditorSlashCommand[],
  query: string,
): EditorSlashCommand[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [...commands];

  const scored: Array<{ command: EditorSlashCommand; score: number }> = [];
  for (const command of commands) {
    const id = command.id.toLowerCase();
    const title = command.title.toLowerCase();
    const description = (command.description ?? "").toLowerCase();
    const aliases = (command.aliases ?? []).map((alias) => alias.toLowerCase());
    let score = 0;
    if (id === q) score = 100;
    else if (id.startsWith(q)) score = 80;
    else if (aliases.some((alias) => alias === q)) score = 70;
    else if (aliases.some((alias) => alias.startsWith(q))) score = 60;
    else if (title.includes(q)) score = 50;
    else if (description.includes(q)) score = 30;
    if (score > 0) scored.push({ command, score });
  }
  return scored
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.score - a.entry.score || a.index - b.index)
    .map(({ entry }) => entry.command);
}

/** 把命令按 `group` 聚合,保持首次出现顺序。 */
export function groupSlashCommands(
  commands: readonly EditorSlashCommand[],
): Array<{ group: string; commands: EditorSlashCommand[] }> {
  const groups = new Map<string, EditorSlashCommand[]>();
  for (const command of commands) {
    const bucket = groups.get(command.group);
    if (bucket) bucket.push(command);
    else groups.set(command.group, [command]);
  }
  return Array.from(groups, ([group, items]) => ({ group, commands: items }));
}

/**
 * 键盘导航:在扁平列表里按方向键移动高亮。
 * 环形滚动(到底回到顶部),对齐其它补全菜单的手感。
 */
export function moveSlashSelection(
  current: number,
  delta: number,
  length: number,
): number {
  if (length <= 0) return 0;
  const next = (current + delta) % length;
  return next < 0 ? next + length : next;
}
