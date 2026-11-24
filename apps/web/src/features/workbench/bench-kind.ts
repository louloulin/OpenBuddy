/** What the artifact panel can do with a file, by extension. */
export type BenchKind =
  | "markdown" | "html" | "image" | "pdf" | "docx" | "pptx" | "sheet"
  | "csv" | "json" | "code" | "text" | "audio" | "video" | "mermaid" | "diagram" | "binary";

const EXT: Record<string, BenchKind> = {
  md: "markdown", markdown: "markdown", mdx: "markdown",
  html: "html", htm: "html",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", bmp: "image", ico: "image",
  pdf: "pdf", docx: "docx", pptx: "pptx", xlsx: "sheet", xls: "sheet",
  csv: "csv", tsv: "csv", json: "json", jsonl: "text",
  txt: "text", log: "text", rst: "text", env: "text", ini: "text", conf: "text",
  // 图表 (G3-1): mermaid 直接渲染，drawio/excalidraw 是结构化图表文件。
  mmd: "mermaid", mermaid: "mermaid", drawio: "diagram", excalidraw: "diagram",
  mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio", flac: "audio",
  mp4: "video", webm: "video", mov: "video",
};
const CODE = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "java", "kt", "c", "h", "cpp", "hpp", "cs", "rb", "php",
  "swift", "sh", "bash", "zsh", "ps1", "css", "scss", "less", "sql", "proto", "yml", "yaml", "toml", "xml", "vue", "svelte",
]);

export function extOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function benchKind(path: string): BenchKind {
  const ext = extOf(path);
  if (EXT[ext]) return EXT[ext];
  if (CODE.has(ext)) return "code";
  const name = (path.split(/[\\/]/).pop() ?? "").toLowerCase();
  if (["dockerfile", "makefile", "license", "readme"].includes(name)) return "text";
  return "binary";
}

/** Text the user can edit in place (and the agent can be asked to change). */
export const isTextKind = (kind: BenchKind) =>
  ["markdown", "html", "csv", "json", "code", "text", "mermaid", "diagram"].includes(kind);
/** Loaded as base64 bytes rather than text. */
export const isBinaryLoaded = (kind: BenchKind) => ["image", "docx", "pptx", "sheet"].includes(kind);

/** Short monogram for file icons. */
export const KIND_GLYPH: Record<BenchKind, string> = {
  markdown: "MD", html: "</>", image: "IMG", pdf: "PDF", docx: "DOC", pptx: "PPT", sheet: "XLS",
  csv: "CSV", json: "{ }", code: "</>", text: "TXT", audio: "♪", video: "▶", mermaid: "◇", diagram: "◇", binary: "BIN",
};

export const KIND_LABEL: Record<BenchKind, string> = {
  markdown: "Markdown", html: "网页", image: "图片", pdf: "PDF", docx: "Word", pptx: "PPT", sheet: "表格",
  csv: "CSV", json: "JSON", code: "代码", text: "文本", audio: "音频", video: "视频",
  mermaid: "Mermaid 图", diagram: "图表", binary: "文件",
};

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
};
export const imageMime = (path: string) => MIME[extOf(path)] ?? "application/octet-stream";

/** Minimal CSV/TSV parser (quotes, escaped quotes, newlines in quotes). */
export function parseCsv(text: string, maxRows = 1000): string[][] {
  const delimiter = text.split("\n", 1)[0].includes("\t") && !text.split("\n", 1)[0].includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if ((cell || row.length) && rows.length < maxRows) { row.push(cell); rows.push(row); }
  return rows;
}

/** A fenced block that cannot be closed early by backticks inside the code. */
export function fence(code: string, lang: string): string {
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((m) => m.length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${lang}\n${code}\n${ticks}`;
}

export function formatSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
