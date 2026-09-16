/**
 * @openbuddy/ui-modules/components — 组件与模型层聚合出口。
 *
 * 组件全部为纯 props 组件(不直接调用 IPC / 不读写全局 store),便于宿主
 * 或第三方面板在自己的数据层之上复用。
 */
export { MarketplaceTab } from "./MarketplaceTab";
export type { MarketplaceTabProps } from "./MarketplaceTab";
export { MarketplaceCard, primaryActionFor } from "./MarketplaceCard";
export type { MarketplaceCardProps, MarketplaceMenuItem } from "./MarketplaceCard";
export { InstallDialog } from "./InstallDialog";
export type { InstallDialogProps, InstallProgress } from "./InstallDialog";
export { CapabilityVersionBadge, resolveBadgeRelation } from "./CapabilityVersionBadge";
export type { CapabilityVersionBadgeProps } from "./CapabilityVersionBadge";
export * from "./marketplace-model";
