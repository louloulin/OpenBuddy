
import type { Plan, PlanEntry, PlanEntryPriority, PlanEntryStatus } from "@openbuddy/protocol/dto";
import type { PlanItem, TodoDetails } from "@openbuddy/protocol/plan";

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

// ---------------------------------------------------------------------------
// ob_todo plan (20261116-pii W3.1–W3.3): the engine's `agent://plan` items.
// ---------------------------------------------------------------------------

const ITEM_MARK: Record<PlanItem["status"], string> = { done: "✓", in_progress: "▶", pending: "○" };

/** The plan as editable text for the composer (修改计划…): one numbered line per step. */
export function planItemsToText(items: readonly PlanItem[]): string {
  return items.map((item, i) => `${i + 1}. ${item.status === "pending" ? "" : `${ITEM_MARK[item.status]} `}${item.text}${item.note ? `（${item.note}）` : ""}`).join("\n");
}

/** The engine plan as a legacy `Plan`, so the step editor (PlanEditor) can work on a draft. */
export function itemsToPlan(items: readonly PlanItem[]): Plan {
  return {
    entries: items.map((item) => ({
      content: item.text,
      priority: "medium" as PlanEntryPriority,
      status: (item.status === "done" ? "completed" : item.status) as PlanEntryStatus,
    })),
  };
}

/** A drafted plan as composer text: numbered steps, priority noted when not the default. */
export function planToText(plan: Plan): string {
  const mark: Record<PlanEntryPriority, string> = { high: "（优先）", medium: "", low: "（可选）" };
  return plan.entries.map((e, i) => `${i + 1}. ${e.status === "completed" ? "✓ " : ""}${e.content}${mark[e.priority]}`).join("\n");
}

const quote = (text: string, max = 24) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * One `ob_todo` call as a transcript row: what changed (from the result details once the call
 * finished, otherwise from its arguments) and the plan's progress after it.
 */
export function todoCallSummary(rawInput: unknown, details?: unknown): { subject: string; progress?: string } {
  const args = rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};
  const result = details && typeof details === "object" && Array.isArray((details as TodoDetails).items) ? (details as TodoDetails) : undefined;
  const items = result?.items ?? [];
  const byId = (id: unknown) => items.find((item) => item.id === Number(id));
  const id = args.id !== undefined ? `#${String(args.id)}` : "";
  const named = () => { const item = byId(args.id); return item ? `${id} ${quote(item.text)}` : id; };
  let subject: string;
  switch (args.action) {
    case "add": {
      const added = result
        ? (result.changed ?? []).map(byId).filter((x): x is PlanItem => !!x).map((x) => x.text)
        : [...(Array.isArray(args.items) ? args.items : []), ...(typeof args.text === "string" ? [args.text] : [])].map(String);
      subject = added.length ? `新增 ${added.length} 个步骤：${added.map((t) => quote(t, 16)).join("、")}` : "新增步骤";
      break;
    }
    case "complete":
      subject = `完成 ${named()}`;
      break;
    case "remove":
      subject = `删除 ${result?.removed?.[0] ? `${id} ${quote(result.removed[0].text)}` : id}`;
      break;
    case "update": {
      const verb = args.status === "in_progress" ? "开始" : args.status === "done" ? "完成" : args.status === "pending" ? "改回待办" : typeof args.text === "string" ? "改写" : "备注";
      subject = `${verb} ${named()}`;
      break;
    }
    default:
      subject = "查看计划";
  }
  const done = items.filter((item) => item.status === "done").length;
  return { subject: subject.trim(), ...(result && items.length ? { progress: `${done}/${items.length}` } : {}) };
}
