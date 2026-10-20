/**
 * 路径 → 画布承载的映射(纯函数,便于单测)。
 *
 * 右侧工作区的「在画布中打开」按扩展名决定用哪种承载:
 * 文本类带 `content`(就地编辑),二进制类只带 `sourcePath`
 * (画布用 file:// 原生渲染,见 CanvasFilePreview)。
 */
import { useCanvasStore, type CanvasTabKind } from "@openbuddy/ui-state/canvas-store";

const EXT_KIND: Record<string, CanvasTabKind> = {
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  html: "html",
  htm: "html",
  svg: "svg",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  pdf: "pdf",
};

/** 二进制承载:只给 sourcePath,不给 content。 */
export function isBinaryCanvasKind(kind: CanvasTabKind): boolean {
  return kind === "image" || kind === "pdf";
}

export function canvasKindForPath(path: string): CanvasTabKind {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_KIND[ext] ?? "code";
}

/** 同一文件的重复打开落到同一 tab(store 的 openTab 会合并同 id)。 */
export function canvasTabIdForPath(path: string): string {
  return `file:${path}`;
}

/** 取末段作为标题;`/` 与 `\` 都要认(Windows 路径)。 */
export function canvasTitleForPath(path: string): string {
  const norm = path.replace(/\\/g, "/");
  return norm.slice(norm.lastIndexOf("/") + 1) || path;
}

/**
 * 把工作区里的一个文件开进画布。抽成函数(而不是内联进按钮)是为了能直接
 * 对 store 断言「按钮点下去真的开了一模一样的 tab」。
 */
export function openPathInCanvas(path: string, text?: string | null): void {
  const kind = canvasKindForPath(path);
  useCanvasStore.getState().openTab({
    canvasId: canvasTabIdForPath(path),
    kind,
    title: canvasTitleForPath(path),
    content: isBinaryCanvasKind(kind) ? undefined : (text ?? ""),
    sourcePath: path,
  });
}
