/**
 * 拖拽文件工具 —— 对齐 WorkBuddy `cb-chat-ui/chat-input/drop-zone` +
 * `drop-zone-filename-utils`。
 *
 * 把 Electron-compatible 的 `DragDropEvent`(native 文件拖拽,带真实绝对路径)归一化为
 * Composer 附件路径列表。纯函数、无副作用,便于单测;Electron-compatible 的 webview 原生
 * onDrop/onDragOver 在浏览器层拿不到本地文件路径(只有 File blob),所以这里
 * 必须走 `getCurrentWebview().onDragDropEvent` 而不是 DOM onDrop。
 */

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

/** Electron drag-drop event 的最小结构(与 @/lib/platform/electron-api 一致)。 */
export type DragDropEvent =
  | { type: "enter"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "leave" };

/** 「放下」事件的具体类型(带 paths)。 */
export type DropEvent = Extract<DragDropEvent, { type: "drop" }>;

/** 取后缀(小写,含点)。无后缀返回空串。 */
export function extOf(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

/** 取文件名(去目录)。 */
export function basenameOf(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash >= 0 ? path.slice(slash + 1) : path;
}

/**
 * 从一次 drop 事件中过滤出有效附件路径。
 *
 *  - 去重(保持顺序,以首次出现为准)
 *  - 过滤掉目录(以路径分隔符结尾的视为目录;Electron-compatible 对目录也给出 paths)
 *  - 可选后缀白名单:`allowedExts` 非空时只保留命中后缀的文件
 *  - 忽略空/空白路径
 */
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
    // 以分隔符结尾 → 目录,跳过(Electron-compatible 会把拖入的目录也列在 paths 里)。
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
