/**
 * Office 预览库懒加载器 —— 与 `pdfjs-loader.ts` 同构。
 *
 * 设计要点:
 * - **懒加载**:只有真正打开 docx / xlsx / pptx 附件时才 dynamic import,
 *   主包零增量。三个库合计体积可观(docx-preview ≈ 400KB、xlsx ≈ 900KB、
 *   pptx-preview + echarts ≈ 1MB),绝不能静态引入。
 * - **缓存 + 可重试**:每个库只 import 一次;失败时清空缓存,允许用户重试
 *   (例如磁盘 / asar 解包瞬间失败)。
 * - **结构类型而非上游类型**:这里声明的是「本包真正用到的最小形状」,
 *   上游升版新增导出不会传染到本包,单测里也更容易用 vi.mock 造替身。
 * - **CSP / 离线安全**:全部走本地依赖,没有任何 CDN。
 *
 * 返回结构刻意保持「模块命名空间」形态,方便测试直接 mock 整个模块。
 */

/** `docx-preview` 的最小用到形状。 */
export interface DocxPreviewModule {
  renderAsync(
    data: Blob | ArrayBuffer | Uint8Array,
    bodyContainer: HTMLElement,
    styleContainer?: HTMLElement,
    userOptions?: Record<string, unknown>,
  ): Promise<unknown>;
}

/** `xlsx`(SheetJS) 的最小用到形状。 */
export interface XlsxWorkbook {
  SheetNames: string[];
  Sheets: Record<string, unknown>;
}

export interface XlsxModule {
  read(data: unknown, opts?: Record<string, unknown>): XlsxWorkbook;
  utils: {
    sheet_to_html(worksheet: unknown, options?: Record<string, unknown>): string;
  };
}

/** `pptx-preview` 的最小用到形状。 */
export interface PptxPreviewer {
  preview(file: ArrayBuffer): Promise<unknown>;
  destroy?(): void;
}

export interface PptxPreviewModule {
  init(
    dom: HTMLElement,
    options: { width?: number; height?: number; mode?: "list" | "slide"; renderer?: string },
  ): PptxPreviewer;
}

/**
 * 统一的「懒加载 + 单次缓存 + 失败可重试」包装。
 *
 * 抽成泛型工厂是为了让三个库共用同一段缓存语义(避免三份复制的 `.catch`
 * 逻辑漂移),同时保留各自的返回类型。
 */
function createCachedLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => {
    if (!cached) {
      cached = load().catch((error: unknown) => {
        // 失败即失效,下一次调用重新尝试 import。
        cached = null;
        throw error;
      });
    }
    return cached;
  };
}

/**
 * 归一化 CJS / ESM 互操作结果。
 *
 * 三个库里 `docx-preview` 与 `pptx-preview` 走 ESM(具名导出),
 * 而 `xlsx` 在 Node 侧是 CJS、在打包器侧可能被解析成
 * `{ default: module.exports }`。统一取 `default ?? namespace`,
 * 避免生产构建下出现 `mod.read is not a function`。
 */
function unwrapModule<T>(mod: unknown): T {
  const namespace = mod as { default?: unknown };
  return (namespace?.default ?? mod) as T;
}

/** 懒加载 `docx-preview`。多次调用返回同一 Promise。 */
export const loadDocxPreview = createCachedLoader<DocxPreviewModule>(async () =>
  unwrapModule<DocxPreviewModule>(await import("docx-preview")),
);

/** 懒加载 `xlsx`(SheetJS)。 */
export const loadXlsx = createCachedLoader<XlsxModule>(async () =>
  unwrapModule<XlsxModule>(await import("xlsx")),
);

/** 懒加载 `pptx-preview`。 */
export const loadPptxPreview = createCachedLoader<PptxPreviewModule>(async () =>
  unwrapModule<PptxPreviewModule>(await import("pptx-preview")),
);
