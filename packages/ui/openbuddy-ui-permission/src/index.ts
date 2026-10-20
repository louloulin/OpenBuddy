/**
 * @openbuddy/ui-permission — 权限管理 UI 三件套 (P1.2)
 *
 *   - PermissionPanel:「权限管理」主面板(规则 CRUD + 模式选择 + 视图筛选)
 *   - PermissionOverrideDialog:per-session 临时覆盖
 *   - FolderTrustPanel:文件夹信任列表 + 授权/撤销
 *
 * 与 auth-policy 包解耦:这些组件不直接调 AuthorizationPipeline,
 * 由调用方在 onXxx callback 中调用 pipeline.decide(...) → 写入 → 刷新 props。
 * 这样组件本身保持纯展示,便于单测。
 */

export { PermissionPanel } from "./PermissionPanel.js";
export { PermissionOverrideDialog } from "./PermissionOverrideDialog.js";
export { FolderTrustPanel } from "./FolderTrustPanel.js";

export {
  PERMISSION_ACTIONS,
  PERMISSION_MODES,
  filterRules,
  formatRule,
} from "./types.js";

export type {
  PermissionPanelProps,
  PermissionOverrideDialogProps,
  FolderTrustPanelProps,
  PermissionViewMode,
} from "./types.js";
