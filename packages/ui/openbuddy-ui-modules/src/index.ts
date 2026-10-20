/**
 * @openbuddy/ui-modules — 统一对外入口
 *
 * 模块管理 UI 层。承载第三方插件「客户端模块」的加载与注册契约
 * (`ClientModuleSystem` / `loadRendererPlugin`),与 OpenBuddy 的插件加载器协作。
 *
 * R97 — 移除历史 marketplace 表现层导出:那套组件(MarketplaceTab /
 * MarketplaceCard / InstallDialog / CapabilityVersionBadge / marketplace-model)
 * 只导出、无宿主装配,与 `@openbuddy/ui-mcp` 的 `MarketplacePanel` 形成两份
 * 实现。R97 删除孤儿实现,「插件·市场」面板的事实来源收敛到 ui-mcp 一处。
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
