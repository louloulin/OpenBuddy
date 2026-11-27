/**
 * 应用平台（20261126-upup）对外出口。
 *
 * 其它 feature（home / sessions）只从这里取，不深入 AppSwitcher.tsx / state 等内部路径，
 * 以满足 feature-deep 边界门禁。
 */
export { AppSwitcher } from "./AppSwitcher";
export { AppsPanel } from "./AppsPanel";
export { useAppsStore } from "./state/apps-store";
export { useCurrentApp } from "./useCurrentApp";
