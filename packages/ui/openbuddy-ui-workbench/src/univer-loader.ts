/**
 * Univer 懒加载器 —— office1 阶段 1。
 *
 * 最佳实践(2026,见 office1.md §10):
 * - preset 模式(官方 React 推荐路径),不手工拼 plugin 列表;
 * - 每个 format 一个 dynamic import 入口,Univer 的 ~5MB 落在子 chunk,
 *   主包零增量 —— 只有用户真的打开 xlsx/docx 才付这个代价;
 * - 所有 `@univerjs/*` 必须精确同版本(0.25.1),混版本是最常见的运行时
 *   崩溃来源;
 * - CSS 必须显式 import,preset 不会自动注入。
 */

/** createUniver 返回的最小契约(只用到我们真正调用的部分)。 */
export interface UniverHandle {
  univer: { dispose(): void };
  univerAPI: {
    createWorkbook?: (data: unknown) => unknown;
    createUniverDoc?: (data: unknown) => unknown;
    dispose?: () => void;
  };
}

export interface UniverSheetRuntime {
  create(container: HTMLElement, workbookData: unknown): UniverHandle;
}

export interface UniverDocRuntime {
  create(container: HTMLElement, documentData: unknown): UniverHandle;
}

let sheetRuntime: Promise<UniverSheetRuntime> | null = null;
let docRuntime: Promise<UniverDocRuntime> | null = null;

/** 懒加载 Univer spreadsheet preset。多次调用复用同一 Promise。 */
export function loadUniverSheet(): Promise<UniverSheetRuntime> {
  if (!sheetRuntime) {
    sheetRuntime = (async () => {
      const [{ createUniver, LocaleType, mergeLocales }, { UniverSheetsCorePreset }, zhCN] =
        await Promise.all([
          import("@univerjs/presets"),
          import("@univerjs/preset-sheets-core"),
          import("@univerjs/preset-sheets-core/locales/zh-CN"),
          import("@univerjs/preset-sheets-core/lib/index.css"),
        ]);
      return {
        create(container, workbookData) {
          const handle = createUniver({
            locale: LocaleType.ZH_CN,
            locales: { [LocaleType.ZH_CN]: mergeLocales(zhCN.default ?? zhCN) },
            presets: [UniverSheetsCorePreset({ container })],
          }) as unknown as UniverHandle;
          handle.univerAPI.createWorkbook?.(workbookData);
          return handle;
        },
      };
    })();
  }
  return sheetRuntime;
}

/** 懒加载 Univer document preset。 */
export function loadUniverDoc(): Promise<UniverDocRuntime> {
  if (!docRuntime) {
    docRuntime = (async () => {
      const [{ createUniver, LocaleType, mergeLocales }, { UniverDocsCorePreset }, zhCN] =
        await Promise.all([
          import("@univerjs/presets"),
          import("@univerjs/preset-docs-core"),
          import("@univerjs/preset-docs-core/locales/zh-CN"),
          import("@univerjs/preset-docs-core/lib/index.css"),
        ]);
      return {
        create(container, documentData) {
          const handle = createUniver({
            locale: LocaleType.ZH_CN,
            locales: { [LocaleType.ZH_CN]: mergeLocales(zhCN.default ?? zhCN) },
            presets: [UniverDocsCorePreset({ container })],
          }) as unknown as UniverHandle;
          handle.univerAPI.createUniverDoc?.(documentData);
          return handle;
        },
      };
    })();
  }
  return docRuntime;
}
