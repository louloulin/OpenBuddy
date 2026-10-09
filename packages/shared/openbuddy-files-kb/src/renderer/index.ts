// packages/shared/openbuddy-files-kb/src/renderer/index.ts
//
// Tier 2 入口:ui-* 包只允许通过 `./renderer` 子路径访问 files-kb 的运行时 API。
// 主入口 `./` 仍暴露 Cordis service / Node-only fs 模块,供 main 进程使用。
export {
  extractDocxFromZip,
  extractPptxFromZip,
  extractSheetFromZip,
  readZipFromBase64,
  makeDocZipReader,
  searchKb,
  listKbProvidersWithStats,
  registerKbProvider,
  unregisterKbProvider,
  rebuildAllKbProviders,
  createLocalKbProvider,
} from "../index";

export type {
  ZipReader,
  KbEntry,
  KbIndexStats,
} from "../index";
