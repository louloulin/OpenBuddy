/**
 * @openbuddy/ui-modules/components — 组件与模型层聚合出口。
 *
 * 组件全部为纯 props 组件(不直接调用 IPC / 不读写全局 store),便于宿主
 * 或第三方面板在自己的数据层之上复用。
 *
 * `MarketplaceTab` 仍是默认的市场面板;`PiMarketTab`(pi.dev 风格)是
 * R83 引入的镜像目录式布局,由宿主通过 `usePiMarketLayout` 配置开关。
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

// R83: pi.dev 风格市场(目录 + 命令复制 + 类型徽章 + 分页)
export * from "./pi-market";
