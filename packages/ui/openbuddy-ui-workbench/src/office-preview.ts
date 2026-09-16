/**
 * Office 预览纯函数助手 —— 与 `pdfjs-loader` / `PdfJsPreview` 同层的
 * 「纯逻辑 / 副作用」拆分：本文件只做字符串与字节层面的判定,不做任何
 * DOM / 网络 / 动态 import,便于在 jsdom 与 Node 下直接单测。
 *
 * 覆盖三类 OOXML 文档:
 *   - docx → docx-preview  的 renderAsync
 *   - xlsx → SheetJS(xlsx) 的 sheet_to_html
 *   - pptx → pptx-preview  的 init().preview
 *
 * 注意:只识别 OOXML 家族扩展名。老式二进制格式(`.doc` / `.xls` / `.ppt`)
 * 这三个库都读不了,刻意返回 null,让调用方走「暂不支持内嵌预览」的显式
 * 分支,而不是渲染出一个必然失败的加载态。
 */

/** 可内嵌预览的 Office 文档种类。 */
export type OfficePreviewKind = "docx" | "xlsx" | "pptx";

/** 扩展名 → 种类映射（全部小写,不含点）。 */
const EXTENSION_MAP: Record<string, OfficePreviewKind> = {
  // Word（OOXML）
  docx: "docx",
  docm: "docx",
  dotx: "docx",
  dotm: "docx",
  // Excel（OOXML）
  xlsx: "xlsx",
  xlsm: "xlsx",
  xltx: "xlsx",
  xltm: "xlsx",
  // PowerPoint（OOXML）
  pptx: "pptx",
  pptm: "pptx",
  ppsx: "pptx",
  ppsm: "pptx",
  potx: "pptx",
  potm: "pptx",
};

/** 去掉 URL 查询串 / hash(预览面板有时传的是带参数的资源 URL)。 */
function stripQueryAndHash(value: string): string {
  let cut = value.length;
  const query = value.indexOf("?");
  if (query !== -1 && query < cut) cut = query;
  const hash = value.indexOf("#");
  if (hash !== -1 && hash < cut) cut = hash;
  return value.slice(0, cut);
}

/**
 * 根据文件名（或路径 / URL）判定 Office 预览种类。
 *
 * - 大小写不敏感（`Report.DOCX` 也算 docx）;
 * - 同时接受 POSIX 与 Windows 路径分隔符;
 * - 无扩展名、只有点前缀（`.gitignore`）、老式二进制格式一律返回 null。
 */
export function pickOfficePreviewKind(filename: string): OfficePreviewKind | null {
  if (typeof filename !== "string" || filename.length === 0) return null;
  const cleaned = stripQueryAndHash(filename).replace(/\\/g, "/");
  const lastSlash = cleaned.lastIndexOf("/");
  const basename = cleaned.slice(lastSlash + 1);
  const dot = basename.lastIndexOf(".");
  // dot === -1：无扩展名;dot === 0：dotfile;dot 在末尾：`report.`
  if (dot <= 0 || dot === basename.length - 1) return null;
  const ext = basename.slice(dot + 1).toLowerCase();
  return EXTENSION_MAP[ext] ?? null;
}

/** 人类可读的种类标签,给预览头部 / 空态用。 */
export function officePreviewKindLabel(kind: OfficePreviewKind): string {
  switch (kind) {
    case "docx":
      return "Word";
    case "xlsx":
      return "Excel";
    case "pptx":
      return "PowerPoint";
    default:
      return "Office";
  }
}

/** UTF-8 编码（TextEncoder 在浏览器 / jsdom / Node 18+ 均可用）。 */
function utf8Bytes(value: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value);
  }
  // 兜底:无 TextEncoder 的环境下按 latin1 近似处理,保证不抛异常。
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) bytes[i] = value.charCodeAt(i) & 0xff;
  return bytes;
}

/**
 * 把 data URL / 裸 base64 字符串解码成字节。
 *
 * 支持三种输入:
 *   1. `data:application/...;base64,<b64>` —— 常见形态;
 *   2. 裸 base64(`UEsDBBQ...`);
 *   3. 非 base64 的 data URL(`data:text/plain,hello%20world`)—— 按 URI 解码。
 *
 * 输入非法（含非 base64 字符）时 `atob` 会抛错,调用方应捕获并渲染 fallback。
 */
export function decodeDataUrl(content: string): Uint8Array {
  const raw = typeof content === "string" ? content : "";
  let payload = raw;
  let isBase64 = true;
  if (raw.startsWith("data:")) {
    const comma = raw.indexOf(",");
    if (comma !== -1) {
      const meta = raw.slice("data:".length, comma);
      payload = raw.slice(comma + 1);
      isBase64 = /;base64/i.test(meta);
    }
  }
  if (!isBase64) {
    return utf8Bytes(decodeURIComponent(payload));
  }
  // base64 里可能存在换行 / 空格（PEM 风格粘贴）,先剔除再解码。
  const binary = atob(payload.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 复制出一份长度精确的 ArrayBuffer。
 *
 * 第三方库（pptx-preview `preview(file: ArrayBuffer)`、SheetJS）会直接读
 * `buffer` 全量内存,而 `Uint8Array.buffer` 在某些情况下带额外容量,必须
 * 复制出 byteLength 精确的副本,否则会把脏字节一起喂给解析器。
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
