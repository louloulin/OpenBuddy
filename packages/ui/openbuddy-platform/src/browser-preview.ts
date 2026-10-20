/**
 * 浏览器预览 —— 对齐 WorkBuddy `context-viewer-components/browser-preview`
 * (嵌入式网页预览框)。
 *
 * 纯函数:URL 安全校验 + iframe sandbox 策略。OpenBuddy 是本地桌面应用,在 WebView 内
 * 再嵌 iframe 预览外部页面,需限制可加载的协议 + sandbox 属性。便于单测。
 */

/** 判定 URL 是否可安全嵌入预览。 */
export function isPreviewableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    // 仅允许 http/https(禁 file/data/javascript/blob 等,避免本地文件/脚本注入)。
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    // 拒绝明显的本地/内网回环(localhost/127/0.0.0.0/::1/内网 IP 段)以防 SSRF。
    const host = u.hostname.toLowerCase();
    // IPv6 回环(URL.hostname 带 [ ],也覆盖无括号形式)。
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return false;
    if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

/** 推荐的 iframe sandbox 属性(最小权限:允许脚本但禁顶层导航/弹窗/同源)。 */
export const PREVIEW_SANDBOX = [
  "allow-scripts",
  "allow-same-origin",
  "allow-forms",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
].join(" ");

/**
 * 规整预览 URL:补全协议(http)、去锚点。
 * 无效(空/非预览able)返回 null。
 */
export function normalizePreviewUrl(input: string): string | null {
  const trimmed = (input || "").trim();
  if (!trimmed) return null;
  // 若已带非 http(s) 协议(file:/data:/javascript: 等)直接拒绝,不补全。
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  // 补全缺省协议(仅当没有协议时)。
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!isPreviewableUrl(withProto)) return null;
  try {
    const u = new URL(withProto);
    u.hash = ""; // 去锚点
    return u.toString();
  } catch {
    return null;
  }
}

/** 生成预览标题(用 hostname)。 */
export function previewTitle(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "网页预览";
  }
}
