/**
 * 分享 / 导出链接模式 —— 对齐 WorkBuddy `share:*`(share a conversation/artifact
 * via link or downloadable file)。可移植部分:生成可分享的载荷(markdown / 自包含
 * HTML)、构造下载用 blob: URL、构造 mailto / Web Share 意图 URL。
 *
 * OpenBuddy 是本地桌面应用,没有云端 share 后端,因此只做「本地导出 + 系统分享意图」,
 * 不上传任何内容(对应 WorkBuddy `share:uploadFile/createLink` 的云上传部分不移植)。
 * 纯函数 + 依赖注入(URL / navigator),便于单测。
 */
import { buildSessionMarkdown, sanitizeFilename } from "../files/export-markdown";
import type { ChatMessage } from "@/stores/session-store";

/** 分享载荷格式。 */
export type ShareFormat = "markdown" | "html" | "text";

/** 构造好的分享载荷。 */
export interface SharePayload {
  /** 文件名(已 sanitize)。 */
  filename: string;
  /** MIME 类型。 */
  mime: string;
  /** 文本内容(markdown / html / text)。 */
  content: string;
  /** 字节大小(UTF-8 近似)。 */
  bytes: number;
}

/** 把会话构建成指定格式的分享载荷。 */
export function buildSharePayload(
  messages: ChatMessage[],
  format: ShareFormat,
  title?: string,
): SharePayload {
  const base = sanitizeFilename(title || "对话导出");
  if (format === "markdown") {
    const content = buildSessionMarkdown(messages, title);
    return {
      filename: `${base}.md`,
      mime: "text/markdown;charset=utf-8",
      content,
      bytes: byteLength(content),
    };
  }
  if (format === "html") {
    const content = buildShareHtml(messages, title);
    return {
      filename: `${base}.html`,
      mime: "text/html;charset=utf-8",
      content,
      bytes: byteLength(content),
    };
  }
  // text:剥离 markdown 标记的纯文本。
  const content = buildSessionMarkdown(messages, title).replace(/^[#>*_`-]+/gm, "").trim();
  return {
    filename: `${base}.txt`,
    mime: "text/plain;charset=utf-8",
    content,
    bytes: byteLength(content),
  };
}

/** 构造自包含 HTML(内联 markdown 正文,可在浏览器直接打开)。 */
export function buildShareHtml(messages: ChatMessage[], title?: string): string {
  const md = buildSessionMarkdown(messages, title);
  const escaped = htmlEscape(md);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(title || "对话导出")}</title>
<style>
body{font:14px/1.6 -apple-system,"Segoe UI",Roboto,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#222}
pre{background:#f5f5f5;padding:8px;border-radius:6px;overflow:auto}
code{font-family:ui-monospace,Consolas,monospace}
blockquote{border-left:3px solid #ccc;margin:0;padding:2px 12px;color:#666}
</style>
</head>
<body>
<pre>${escaped}</pre>
</body>
</html>`;
}

/** 构造 mailto 分享链接(把正文塞进 body,URL 编码)。 */
export function buildMailtoUrl(
  subject: string,
  body: string,
  deps: { encode?: (s: string) => string } = {},
): string {
  const enc = deps.encode ?? encodeURIComponent;
  return `mailto:?subject=${enc(subject)}&body=${enc(body)}`;
}

/**
 * 构造下载用 blob: URL。依赖注入 URL.createObjectURL + Blob 以保持可测。
 * 返回 { url, revoke }。
 */
export function buildDownloadUrl(
  payload: SharePayload,
  deps: {
    createObjectURL?: (b: Blob) => string;
    Blob?: typeof Blob;
  } = {},
): { url: string; revoke: () => void } {
  const createObjectURL = deps.createObjectURL ?? ((b: Blob) => URL.createObjectURL(b));
  const BlobCtor = deps.Blob ?? Blob;
  const blob = new BlobCtor([payload.content], { type: payload.mime });
  const url = createObjectURL(blob);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

/** 触发浏览器下载(创建 <a> 并 click)。依赖注入 document 以保持可测。
 *  显式传 document:null 视为「无 document」(安全返回)。 */
export function triggerDownload(
  payload: SharePayload,
  deps: {
    document?: Document | null;
    createObjectURL?: (b: Blob) => string;
  } = {},
): void {
  // deps.document 显式传入(含 null)优先;未传时回落全局 document。
  const doc =
    "document" in deps
      ? deps.document
      : typeof document !== "undefined"
        ? document
        : undefined;
  if (!doc) return;
  const { url } = buildDownloadUrl(payload, { createObjectURL: deps.createObjectURL });
  const a = doc.createElement("a");
  a.href = url;
  a.download = payload.filename;
  a.rel = "noopener";
  doc.body.appendChild(a);
  a.click();
  doc.body.removeChild(a);
  // 略微延迟 revoke,确保下载已启动。
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- 工具 ----------

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
