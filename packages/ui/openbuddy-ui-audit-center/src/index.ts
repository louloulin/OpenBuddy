/**
 * @openbuddy/ui-audit-center — 授权审计日志面板 (P1.4)
 *
 *   - AuditCenter: 主面板(标题 + 操作 + 统计 + 过滤 + 表格 + 分页)
 *   - AuditFiltersBar: 多维过滤条
 *   - AuditStats: 顶部统计条
 *
 * 与 audit-client 解耦:这些组件不直接调 `auditList / auditClear / auditExport`,
 * 由调用方在 onLoad / onExport / onClear 回调里调用 IPC。
 * 纯过滤/统计函数可被任意 UI 包复用。
 */

export { AuditCenter } from "./AuditCenter.js";
export { AuditFiltersBar } from "./AuditFiltersBar.js";
export { AuditStats } from "./AuditStats.js";

export {
  AUDIT_OUTCOMES,
  AUDIT_SOURCES,
  EMPTY_FILTERS,
  OUTCOME_LABEL,
  SOURCE_LABEL,
  filterAuditEvents,
  formatAuditAt,
  formatAuditDetail,
  isFiltersEmpty,
  summarizeAuditEvents,
  toggleOutcome,
  toggleSource,
} from "./types.js";

export type {
  AuditCenterProps,
} from "./AuditCenter.js";
export type {
  AuditFiltersBarProps,
} from "./AuditFiltersBar.js";
export type {
  AuditStatsProps,
} from "./AuditStats.js";
export type {
  AuditEvent,
  AuditFilters,
  AuditOutcome,
  AuditSource,
  AuditSummary,
} from "./types.js";
