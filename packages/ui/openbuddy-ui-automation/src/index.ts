/**
 * @openbuddy/ui-automation — 统一对外入口
 *
 * 自动化任务层。包含自动化面板、调度工具、模板配置、灵感面板等。支持 Cron 表达式、循环调度、单次触发三种模式。
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
import type { SlotMap } from "@openbuddy/ui-slots";

export type { SlotMap };

// -------- panels --------
export { AutomationPanel } from "./AutomationPanel";
export type { AutomationPanelProps } from "./AutomationPanel";
export { TasksPanel } from "./TasksPanel";
export type { TasksPanelProps } from "./TasksPanel";
export { PlanPanel } from "./PlanPanel";
export type { PlanPanelProps } from "./PlanPanel";
export { QueuePanel } from "./QueuePanel";
export type { QueuePanelProps } from "./QueuePanel";
// Stage G-1c restoration: InspirationPanel was previously removed during the
// openbuddy-inspiration Cordis backend deletion (Stage B-2). It references
// `inspirationGenerate` from pi-client and `InspirationRichCard` from
// shared-types, both of which were deleted with that backend. The rest of
// the openbuddy-ui-automation UI shells (AutomationPanel, TasksPanel,
// PlanPanel, QueuePanel, AutomationEditPage, templates) are preserved
// per user directive "自动化ui保留不要删除 / 保留auto".

// -------- edit / template sub-views --------
export { AutomationEditPage } from "./AutomationEditPage";
export type { ModelOption } from "./AutomationEditPage";
export { AutomationTemplateGrid } from "./AutomationTemplateGrid";
export { AutomationPermissionConfirmDialog } from "./AutomationPermissionConfirmDialog";
export { AutomationPermissionPicker } from "./AutomationPermissionPicker";
export { ConnectorSelector } from "./ConnectorSelector";
export type { ConnectorOption } from "./ConnectorSelector";

// -------- shared controls --------
export { Checkbox, Switch, Segmented } from "./controls";
export type { CustomSelectOption } from "./controls";

// -------- schedule config & helpers --------
export {
  AUTOMATION_TEMPLATES,
  ALL_DAYS,
  type AutomationTemplate,
  type WeekdayCode,
} from "./template-config";
export {
  DAY_LABELS,
  automationFromDraft,
  buildDraft,
  describeSchedule,
  describeValidity,
  draftFromAutomation,
  formatRunTime,
  scheduledAtIso,
  startsInLabel,
  validateDraft,
  type AutomationDraft,
} from "./schedule-utils";

// -------- permission confirm hook --------
export { usePermissionConfirm } from "./usePermissionConfirm";
