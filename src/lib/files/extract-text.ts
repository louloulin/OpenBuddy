/**
 * 从消息提取纯文本 / 关键词高亮分词 —— 对齐 WorkBuddy `cb-chat-ui/chat-search`
 * (extract-plain-text + highlight-text-nodes)。
 *
 * 用于「会话内搜索」与「消息反馈」等需要把一条结构化消息当成可检索字符串的场景。
 * 纯函数、无副作用,便于单测。
 */
import type { ChatMessage, ToolCallView } from "@/stores/session-store";

/**
 * 从一条消息的全部 parts 拼出纯文本(供搜索索引)。
 *  - text:取原文
 *  - thought:取原文(思考链同样可被检索)
 *  - tool_call:取 title + 命令 + 输出(截断)
 */
export function extractPlainText(message: ChatMessage): string {
  const segs: string[] = [];
  for (const p of message.parts) {
    if (p.kind === "text") {
      segs.push(p.text);
    } else if (p.kind === "thought") {
      segs.push(p.text);
    } else if (p.kind === "tool_call") {
      segs.push(extractToolCallText(p.toolCall));
    }
  }
  return segs.join("\n");
}

/** 从单个工具调用提取可检索文本(title + command + 输出 + diff path)。 */
export function extractToolCallText(tc: ToolCallView): string {
  const segs: string[] = [tc.title];
  for (const c of tc.content ?? []) {
    if (c.type === "command_output") {
      if (c.command) segs.push(c.command);
      if (c.output) segs.push(c.output);
    } else if (c.type === "text") {
      segs.push(c.text);
    } else if (c.type === "diff") {
      segs.push(c.diff.path);
    }
  }
  return segs.join("\n");
}

/** 一段高亮文本:被命中的片段 `hit=true`,其余为普通文本。 */
export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/**
 * 把一段文本按(大小写不敏感)关键词切分成片段序列,命中处 `hit=true`。
 * 用于搜索结果高亮。空 query 时返回整段作为一个非命中片段。
 */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  if (!query) return [{ text, hit: false }];
  // 转义正则元字符,避免 `(`、`.` 等破坏 RegExp 构造。
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "gi");
  const segs: HighlightSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index), hit: false });
    segs.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
    // 防御零宽匹配死循环(转义后不会发生,但保险)。
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < text.length) segs.push({ text: text.slice(last), hit: false });
  return segs;
}

/** 大小写不敏感地判断文本是否命中 query(空白 query 视为未命中)。 */
export function matchesQuery(text: string, query: string): boolean {
  if (!query) return false;
  return text.toLowerCase().includes(query.toLowerCase());
}
