/**
 * 计划编辑器纯函数 —— 对齐 WorkBuddy `cb-chat-ui/plan-editor` 的可编辑能力
 * (reorder / add / remove / set status / set priority)。
 *
 * 全部以不可变方式返回新 plan,便于单测与 React 状态更新。pi 的 ACP Plan
 * 每次 update 整体替换,本地编辑后由 PlanPanel setPlan 写回 session-store。
 */
import type { Plan, PlanEntry, PlanEntryPriority, PlanEntryStatus } from "@openbuddy/shared-types";

/** 移动一条 entry 到新位置(0-based,越界 clamp)。返回新 plan。 */
export function reorderPlan(plan: Plan, from: number, to: number): Plan {
  const entries = [...plan.entries];
  if (from < 0 || from >= entries.length) return plan;
  const clampedTo = Math.max(0, Math.min(to, entries.length - 1));
  if (from === clampedTo) return plan;
  const [moved] = entries.splice(from, 1);
  entries.splice(clampedTo, 0, moved);
  return { ...plan, entries };
}

/** 在末尾追加一条 entry。空内容不追加。返回新 plan。 */
export function addPlanEntry(
  plan: Plan,
  content: string,
  priority: PlanEntryPriority = "medium",
): Plan {
  const text = content.trim();
  if (!text) return plan;
  const entry: PlanEntry = { content: text, priority, status: "pending" };
  return { ...plan, entries: [...plan.entries, entry] };
}

/** 删除指定 index 的 entry。返回新 plan。 */
export function removePlanEntry(plan: Plan, index: number): Plan {
  if (index < 0 || index >= plan.entries.length) return plan;
  return { ...plan, entries: plan.entries.filter((_, i) => i !== index) };
}

/** 设置指定 index 的状态。返回新 plan。 */
export function setEntryStatus(plan: Plan, index: number, status: PlanEntryStatus): Plan {
  if (index < 0 || index >= plan.entries.length) return plan;
  return {
    ...plan,
    entries: plan.entries.map((e, i) => (i === index ? { ...e, status } : e)),
  };
}

/** 设置指定 index 的优先级。返回新 plan。 */
export function setEntryPriority(plan: Plan, index: number, priority: PlanEntryPriority): Plan {
  if (index < 0 || index >= plan.entries.length) return plan;
  return {
    ...plan,
    entries: plan.entries.map((e, i) => (i === index ? { ...e, priority } : e)),
  };
}

/** 编辑指定 index 的内容。空内容不修改。返回新 plan。 */
export function setEntryContent(plan: Plan, index: number, content: string): Plan {
  const text = content.trim();
  if (!text || index < 0 || index >= plan.entries.length) return plan;
  return {
    ...plan,
    entries: plan.entries.map((e, i) => (i === index ? { ...e, content: text } : e)),
  };
}

/** 状态循环:pending → in_progress → completed → pending。 */
export function cycleEntryStatus(plan: Plan, index: number): Plan {
  if (index < 0 || index >= plan.entries.length) return plan;
  const cur = plan.entries[index].status;
  const next: PlanEntryStatus =
    cur === "pending" ? "in_progress" : cur === "in_progress" ? "completed" : "pending";
  return setEntryStatus(plan, index, next);
}

/** 统计:返回 { total, completed, inProgress, pending, progressPct }。 */
export function planStats(plan: Plan): {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  progressPct: number;
} {
  const total = plan.entries.length;
  const completed = plan.entries.filter((e) => e.status === "completed").length;
  const inProgress = plan.entries.filter((e) => e.status === "in_progress").length;
  const pending = plan.entries.filter((e) => e.status === "pending").length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, inProgress, pending, progressPct };
}
