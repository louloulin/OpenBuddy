/**
 * @openbuddy/ui-modules — 统一对外入口
 *
 * 模块管理 UI 层。负责第三方插件模块的浏览、启用、停用与配置编辑,与 OpenBuddy 的插件加载器协作展示模块状态;
 * 同时承载「插件 / 扩展市场」的表现层(MarketplaceTab + 卡片 + 安装对话框 + 版本徽标)。
 *
 * 公共 API 分类:
 *   - 公共类型 (Types)        → 跨包消费的类型契约,运行时无副作用
 *   - 公共组件 (Components)   → 可直接在 React 树中渲染
 *   - 公共工具 (Utilities)    → 函数 / 常量 / hooks,无 JSX 输出
 *   - 槽位声明合并 (Slots)    → 通过 declare module 扩展 @openbuddy/ui-slots
 *
 * 子路径:
 *   - ./client        → apply() 槽位注册入口(由 ui-runtime 在 SlotProvider 挂载时调用)
 *   - ./invariant     → 不变式同伴(debug 模式下激活)
 *   - ./components    → 组件与纯函数模型(供宿主 / 第三方面板复用)
 *
 * @see packages/ui/AGENTS.md 了解 ui-* 包协作约定
 */
export {
  ClientModuleSystem,
  loadRendererPlugin,
  type ClientModuleRegistrationTarget,
  type ClientBundleRegistration,
  type ClientModuleEntry,
  type ClientModuleBootEntry,
  type ClientModuleBootGraph,
  type ClientModuleFactory,
  type ClientModuleRecord,
  type ClientModuleSystemOptions,
} from "@openbuddy/renderer-host";

import type { MarketplaceCardProps, MarketplaceTabProps } from "./components";

export {
  MarketplaceTab,
  MarketplaceCard,
  primaryActionFor,
  InstallDialog,
  CapabilityVersionBadge,
  resolveBadgeRelation,
  type MarketplaceTabProps,
  type MarketplaceCardProps,
  type MarketplaceMenuItem,
  type InstallDialogProps,
  type InstallProgress,
  type CapabilityVersionBadgeProps,
} from "./components";

export {
  MARKETPLACE_KINDS,
  MARKETPLACE_KIND_LABELS,
  MARKETPLACE_SORT_LABELS,
  INSTALL_STATE_LABELS,
  VERSION_RELATION_LABELS,
  CAPABILITY_RISK_LABELS,
  parseSemver,
  compareSemver,
  classifyVersion,
  isMajorUpgrade,
  sortVersionsDesc,
  resolveInstallState,
  summarizeCapabilities,
  capabilityRisk,
  collectCapabilityIds,
  collectKindFacets,
  filterMarketplaceEntries,
  sortMarketplaceEntries,
  selectMarketplaceEntries,
  scoreRelevance,
  highlightSegments,
  formatBytes,
  type MarketplaceKind,
  type MarketplaceEntry,
  type MarketplaceCapability,
  type MarketplaceFilter,
  type MarketplaceFacet,
  type MarketplaceSortKey,
  type InstallState,
  type VersionRelation,
  type CapabilityRisk,
  type CapabilitySummary,
  type SemverParts,
  type ResolveInstallStateInput,
} from "./components/marketplace-model";

declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    /** 市场整版面。宿主提供数据与动作,注册方可整体替换(例如云端市场)。
     *  scope 为 session-maybe:市场是 profile 级资源,不强制要求活跃会话。 */
    "modules.marketplace": {
      kind: "single";
      scope: "session-maybe";
      owner: MarketplaceTabProps;
    };
    /** 市场单条目的卡片渲染。list 语义:所有注册项都会渲染,
     *  宿主可以追加自定义卡片(例如「企业内部分发」卡片)。 */
    "modules.marketplace.item": {
      kind: "list";
      scope: "session-maybe";
      owner: MarketplaceCardProps;
    };
  }
}
