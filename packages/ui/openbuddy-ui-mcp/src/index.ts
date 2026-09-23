/**
 * @openbuddy/ui-mcp — 统一对外入口
 *
 * MCP 客户端 UI 层。承载 MCP 服务发现、连接、工具调用与诊断面板。
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
 *
 * @see packages/ui/AGENTS.md 了解 ui-* 包协作约定
 */
export { DiscoverPanel } from "./DiscoverPanel";
export { MarketplacePanel } from "./MarketplacePanel";
// R41 — 安装预检:纯逻辑 + 确认框,第三方插件可以注册更高优先级实现整体替换。
export { buildInstallPreflight, resolvePreflightAction } from "./install-preflight";
export type { InstallPreflight, PreflightItem, PreflightLevel, PreflightAction } from "./install-preflight";
export { InstallPreflightDialog } from "./InstallPreflightDialog";
export { NotifyChannelsPanel } from "./NotifyChannelsPanel";
export { OpenBuddyPluginPanel } from "./OpenBuddyPluginPanel";
export { PiExtensionsSection } from "./PiExtensionsSection";
// R83: pi.dev 风格市场 section。R84 之后是 MarketplacePanel 顶层唯一路径,
// PiExtensionsSection 仅保留给旧测试和独立使用,不在这里并列。
export { PiMarketSection } from "./PiMarketSection";
export {
  toPiPackageEntry,
  toPiPackageEntries,
  inferPrimaryKind,
  piSourceKind,
  downloadsFromMirrors,
} from "./pi-package-bridge";
export {
  describePiMarketError,
  groupPiMarketEntries,
  installStateOf,
  mirrorLabel,
  sourceChips,
  sourceLabel,
  summarizeSources,
  toMarketplaceEntry,
  type PiExtensionsGroups,
  type PiMarketErrorAction,
  type PiMarketSourceSummary,
  type PiSourceChip,
} from "./pi-extensions-model";
export { PluginsPanel } from "./PluginsPanel";
export { ResourceCatalogPanel } from "./ResourceCatalogPanel";


declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    /**
     * 发现面板(single)。
     * 消费者:PlaceholderPage「发现」路由。
     */
    "placeholder.discover": { kind: "single"; scope: "root" };
    /**
     * 插件市场面板(single)。
     * 消费者:ExpertsPanel 的「插件·市场」tab。
     */
    "placeholder.marketplace": { kind: "single"; scope: "root" };
    /**
     * 通知渠道面板(single)。
     * 消费者:PlaceholderPage「通知渠道」路由。
     */
    "placeholder.notify-channels": { kind: "single"; scope: "root" };
    /**
     * OpenBuddy 自家插件管理面板(single)。
     * 消费者:SettingsPanel「OpenBuddy 插件」路由。
     */
    "placeholder.openbuddy-plugin": { kind: "single"; scope: "root" };
    /**
     * Pi x.ai/plugins 兼容面板(single)。
     * 消费者:SettingsPanel「Pi 插件」路由。
     */
    "placeholder.plugins": { kind: "single"; scope: "root" };
    /**
     * 资源目录面板(single)。
     * 消费者:SettingsPanel「资源目录」路由。
     */
    "placeholder.resource-catalog": { kind: "single"; scope: "root" };
  }
}
