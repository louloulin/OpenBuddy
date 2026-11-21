import { PLAN_TOOL, type PlanItem, type PlanItemStatus, type TodoAction, type TodoDetails } from "@openbuddy/protocol/plan";
import type { BranchReader } from "./session-state.js";

/**
 * Plan state for the built-in `ob_todo` tool (20261116-pii W3.1), pure functions only.
 * The state lives in tool-result `details` (the pattern of Pi's `todo.ts` example): the plan of
 * a branch is the `details` of the last `ob_todo` result on it.
 */
export interface PlanState {
  items: PlanItem[];
  nextId: number;
}
export const EMPTY_PLAN: PlanState = { items: [], nextId: 1 };
/** Bounds that keep the plan readable and the event small. */
export const MAX_STEPS = 50;
export const MAX_TEXT = 200;

const STATUSES: readonly PlanItemStatus[] = ["pending", "in_progress", "done"];
const ACTIONS: readonly TodoAction[] = ["add", "update", "complete", "remove", "list"];

function clip(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

/** Items as they cross IPC: exactly id / text / status / note, malformed entries dropped. */
export function slimPlan(items: unknown): PlanItem[] {
  if (!Array.isArray(items)) return [];
  const out: PlanItem[] = [];
  for (const raw of items.slice(0, MAX_STEPS)) {
    if (!raw || typeof raw !== "object") continue;
    const { id, text, status, note } = raw as Record<string, unknown>;
    if (typeof id !== "number" || !Number.isInteger(id) || typeof text !== "string" || !STATUSES.includes(status as PlanItemStatus)) continue;
    out.push({ id, text: clip(text), status: status as PlanItemStatus, ...(typeof note === "string" && note.trim() ? { note: clip(note) } : {}) });
  }
  return out;
}

/** Plan state carried by one `ob_todo` result's details, if well-formed. */
export function stateFromDetails(details: unknown): PlanState | undefined {
  if (!details || typeof details !== "object" || !Array.isArray((details as TodoDetails).items)) return undefined;
  const items = slimPlan((details as TodoDetails).items);
  const nextId = (details as TodoDetails).nextId;
  const floor = items.reduce((max, item) => Math.max(max, item.id + 1), 1);
  return { items, nextId: typeof nextId === "number" && Number.isInteger(nextId) && nextId >= floor ? nextId : floor };
}

/** The plan of the current branch (or of the branch ending at `fromId`). */
export function planFromBranch(sm: BranchReader, fromId?: string): PlanState {
  let state = EMPTY_PLAN;
  for (const entry of sm.getBranch(fromId)) {
    if (entry.type !== "message") continue;
    const message = entry.message as { role?: string; toolName?: string; details?: unknown };
    if (message.role !== "toolResult" || message.toolName !== PLAN_TOOL) continue;
    state = stateFromDetails(message.details) ?? state;
  }
  return state;
}

export interface TodoParams {
  action: TodoAction;
  items?: string[];
  text?: string;
  id?: number;
  status?: PlanItemStatus;
  note?: string;
}

/** Validate raw tool arguments (Pi already checked them against the schema; this narrows the type). */
export function parseTodoParams(raw: unknown): TodoParams {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (!ACTIONS.includes(value.action as TodoAction)) throw Error(`未知操作：${String(value.action)}（可用：${ACTIONS.join(" / ")}）`);
  const id = typeof value.id === "number" ? value.id : typeof value.id === "string" && /^\d+$/.test(value.id) ? Number(value.id) : undefined;
  return {
    action: value.action as TodoAction,
    ...(Array.isArray(value.items) ? { items: value.items.filter((s): s is string => typeof s === "string") } : {}),
    ...(typeof value.text === "string" ? { text: value.text } : {}),
    ...(id !== undefined ? { id } : {}),
    ...(STATUSES.includes(value.status as PlanItemStatus) ? { status: value.status as PlanItemStatus } : {}),
    ...(typeof value.note === "string" ? { note: value.note } : {}),
  };
}

const MARK: Record<PlanItemStatus, string> = { done: "✓", in_progress: "▶", pending: "○" };

/** The whole plan as the model reads it back. */
export function planText(items: readonly PlanItem[]): string {
  if (!items.length) return "计划为空。";
  const done = items.filter((item) => item.status === "done").length;
  return [`当前计划（完成 ${done}/${items.length}）：`, ...items.map((item) => `${MARK[item.status]} #${item.id} ${item.text}${item.note ? `（${item.note}）` : ""}`)].join("\n");
}

/**
 * Apply one `ob_todo` call. Invalid calls throw (Pi turns that into an error result without
 * details, so the plan stays as it was); valid ones return the new state as details.
 */
export function applyTodo(state: PlanState, params: TodoParams): { details: TodoDetails; text: string } {
  let items = state.items.map((item) => ({ ...item }));
  let nextId = state.nextId;
  const changed: number[] = [];
  let removed: PlanItem[] | undefined;
  let head: string;
  const find = () => {
    if (params.id === undefined) throw Error(`${params.action} 需要 id（步骤编号）`);
    const item = items.find((i) => i.id === params.id);
    if (!item) throw Error(`没有编号为 #${params.id} 的步骤。${planText(items)}`);
    return item;
  };
  switch (params.action) {
    case "add": {
      const texts = [...(params.items ?? []), ...(params.text !== undefined ? [params.text] : [])].map(clip).filter(Boolean);
      if (!texts.length) throw Error("add 需要 items（步骤列表）或 text");
      if (items.length + texts.length > MAX_STEPS) throw Error(`计划最多 ${MAX_STEPS} 个步骤`);
      for (const text of texts) {
        items.push({ id: nextId, text, status: "pending" });
        changed.push(nextId++);
      }
      head = `已新增 ${changed.map((id) => `#${id}`).join("、")}。`;
      break;
    }
    case "update": {
      const item = find();
      if (params.text === undefined && params.status === undefined && params.note === undefined) throw Error("update 需要 text、status 或 note 之一");
      if (params.text !== undefined) {
        const text = clip(params.text);
        if (!text) throw Error("步骤内容不能为空");
        item.text = text;
      }
      if (params.status) item.status = params.status;
      if (params.note !== undefined) {
        const note = clip(params.note);
        if (note) item.note = note;
        else delete item.note;
      }
      changed.push(item.id);
      head = `已更新 #${item.id}。`;
      break;
    }
    case "complete": {
      const item = find();
      item.status = "done";
      if (params.note !== undefined && clip(params.note)) item.note = clip(params.note);
      changed.push(item.id);
      head = `#${item.id} 已完成。`;
      break;
    }
    case "remove": {
      const item = find();
      items = items.filter((i) => i.id !== item.id);
      removed = [item];
      head = `已删除 #${item.id}。`;
      break;
    }
    default:
      head = "";
  }
  const details: TodoDetails = { action: params.action, items, nextId, changed, ...(removed ? { removed } : {}) };
  return { details, text: `${head}${head ? "\n" : ""}${planText(items)}` };
}
