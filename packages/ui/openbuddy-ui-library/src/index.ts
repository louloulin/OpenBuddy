/**
 * @openbuddy/ui-library — 资料库(用户资料统一入口)。
 *
 * 公共 API 分类:
 *   - 公共类型 (Types)      → 分区契约 (`LibrarySectionProps` / `LibrarySectionMeta` …)
 *   - 公共组件 (Components) → `LibraryPage`(宿主可直接渲染,也可被插件替换)
 *   - 公共工具 (Utilities)  → `defineLibrarySection` / `readLibrarySectionMeta`
 *   - 槽位声明合并 (Slots)  → `placeholder.library`(整页)/ `library.section`(分区总线)
 *
 * 子路径:
 *   - ./client    → apply() 注册入口(ui-runtime 装配时调用)
 *   - ./invariant → 不变式同伴
 *
 * @see packages/ui/AGENTS.md 了解 ui-* 包协作约定
 */
import type { SlotMap } from "@openbuddy/ui-slots";
import type { LibraryPageProps, LibrarySectionProps } from "./section-contract";

export type { SlotMap };

export { LibraryPage } from "./LibraryPage";
export type { LibraryPageProps, LibrarySectionProps };
export {
  LIBRARY_SECTION_IDS,
  defineLibrarySection,
  readLibrarySectionMeta,
} from "./section-contract";
export type {
  LibrarySectionComponent,
  LibrarySectionIconId,
  LibrarySectionMeta,
} from "./section-contract";
export {
  CloudStorageSection,
  InspirationSection,
  KnowledgeSection,
  LIBRARY_SECTIONS,
  MyFilesSection,
} from "./sections";

declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    /**
     * 资料库整页(single)。消费者:`PlaceholderPage` 的「资料库 / 更多 / 灵感」路由。
     * 插件可以注册更高优先级实现整体替换这一页(例如换成企业知识门户)。
     */
    "placeholder.library": {
      kind: "single";
      scope: "root";
      owner: LibraryPageProps;
    };
    /**
     * 资料库分区(list)。消费者:`LibraryPage`。
     * 内置 4 个分区(我的文件 / 知识库 / 云存储 / 灵感)也走这条总线 ——
     * 插件追加分区只需 `ctx.slots.register`,不需要改页面代码。
     * 注册值必须是 `defineLibrarySection(meta, Component)` 的产物。
     */
    "library.section": {
      kind: "list";
      scope: "root";
      owner: LibrarySectionProps;
    };
  }
}
