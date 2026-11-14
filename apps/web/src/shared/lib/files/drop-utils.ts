import { extOf } from "@openbuddy/chat-core/file-ext";

/** 受支持文件名后缀白名单(空数组表示不过滤)。 */
export const DEFAULT_ALLOWED_EXTS: string[] = [];

/** 常见代码/文档/数据扩展名,用于按需过滤。 */
export const CODE_DOC_EXTS = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".toml", ".yaml", ".yml", ".xml", ".csv",
  ".md", ".txt", ".rst",
  ".py", ".rs", ".go", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs",
  ".rb", ".php", ".swift", ".sh", ".bash", ".ps1",
  ".html", ".css", ".scss", ".less",
  ".sql", ".proto",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp",
  ".zip", ".tar", ".gz",
];


export type DragDropEvent =
  | { type: "enter"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "leave" };

/** 「放下」事件的具体类型(带 paths)。 */
export type DropEvent = Extract<DragDropEvent, { type: "drop" }>;

/** 取后缀(小写,含点)。无后缀返回空串。实现在 chat-core(20261115-md R7)。 */
export { extOf };

/** 取文件名(去目录)。 */
export function basenameOf(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash >= 0 ? path.slice(slash + 1) : path;
}


export function collectDroppedPaths(
  paths: string[] | undefined | null,
  allowedExts: string[] = DEFAULT_ALLOWED_EXTS,
): string[] {
  if (!paths || paths.length === 0) return [];
  const extSet = allowedExts.length > 0 ? new Set(allowedExts) : null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const p = (raw ?? "").trim();
    if (!p) continue;
    if (p.endsWith("/") || p.endsWith("\\")) continue;
    if (seen.has(p)) continue;
    if (extSet && !extSet.has(extOf(p))) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * 把新 drop 的路径合并进现有附件列表(去重,保持顺序:已有在前,新增在后)。
 */
export function mergeAttachments(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing);
  const out = [...existing];
  for (const p of incoming) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/**
 * 判定一个 DragDropEvent 是否为「拖入悬停」(应显示 drop-zone 遮罩)。
 *  enter / over → 显示;drop / leave → 隐藏。
 */
export function isDragHovering(event: DragDropEvent): boolean {
  return event.type === "enter" || event.type === "over";
}

/** 判定一个 DragDropEvent 是否为「放下」(应收集路径)。 */
export function isDragDrop(event: DragDropEvent): event is DropEvent {
  return event.type === "drop";
}
