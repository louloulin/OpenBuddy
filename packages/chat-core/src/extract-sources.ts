/**
 * 从工具输出里提取可核实的来源链接。
 *
 * Pi 的工具（WebFetch/WebSearch/MCP）把网页、搜索结果以文本返回；这里只做
 * 确定性的 URL 汇总，不推断"引用关系"。没有 URL 就返回空数组，UI 不渲染来源区。
 */
export interface SourceLink {
  url: string;
  /** Markdown link text when present, otherwise the hostname. */
  title: string;
}

const MARKDOWN_LINK = /\[([^\]]{1,120})\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL = /https?:\/\/[^\s<>"'`)\]]+/g;
const TRAILING = /[.,;:!?，。；：！？、]+$/;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Extract unique http(s) links from arbitrary tool output text. */
export function extractSources(texts: Array<string | undefined | null>, limit = 6): SourceLink[] {
  const found = new Map<string, SourceLink>();
  const add = (url: string, title?: string) => {
    const clean = url.replace(TRAILING, "");
    if (!/^https?:\/\//i.test(clean)) return;
    if (found.has(clean) || found.size >= limit) return;
    found.set(clean, { url: clean, title: title?.trim() || hostOf(clean) });
  };

  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(MARKDOWN_LINK)) add(match[2], match[1]);
    for (const match of text.matchAll(BARE_URL)) add(match[0]);
  }
  return [...found.values()];
}
