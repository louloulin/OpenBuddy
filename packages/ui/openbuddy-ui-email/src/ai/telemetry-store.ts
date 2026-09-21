/**
 * telemetry-store — 邮件 AI 闭环埋点 store(P3-5)。
 *
 * 设计目标:
 *   - 收集 `triage_shown / action_proposed / action_executed / action_undone
 *     / ai_summary_shown / command_prompt / provider_error` 等关键事件,
 *     用于后续 AI 决策优化(准确率、撤销率、执行成功率)。
 *   - 模块级 buffer,React 内/外都可调用(`email-store` 同款 `useSyncExternalStore`)。
 *   - 默认 console sink,设置开关后才落盘(留给未来的 sqlite IPC 桥)。
 *
 * 不依赖:
 *   - 不引 IPC 客户端 — 等 capability-telemetry 落地后再接。本期先在 renderer
 *     内存里聚合 + 可选 console 输出。
 *
 * 不变量:
 *   - 事件 buffer 上限 1000 条,超出后滚动窗口(旧事件丢弃,聚合数据保留)。
 *   - 聚合快照对外只读,setter 只能追加事件。
 */
import { useSyncExternalStore } from "react";

export type TelemetryEventName =
  | "triage_shown"
  | "triage_merged"
  | "action_proposed"
  | "action_executed"
  | "action_undone"
  | "action_failed"
  | "ai_summary_shown"
  | "ai_summary_stale_hit"
  | "command_prompt"
  | "provider_error"
  | "multiselect_batch_plan"
  | "smart_snooze_resolved";

export interface TelemetryEvent {
  name: TelemetryEventName;
  ts: number;
  accountId?: string;
  /** 事件属性 — 自由形式 key/value,数量控制在 8 个以内。 */
  props?: Record<string, string | number | boolean | null>;
}

export interface TelemetryAggregate {
  triageShown: number;
  triageMerged: number;
  actionProposed: number;
  actionExecuted: number;
  actionUndone: number;
  actionFailed: number;
  aiSummaryShown: number;
  aiSummaryStaleHit: number;
  commandPrompt: number;
  providerError: number;
  multiselectBatchPlan: number;
  smartSnoozeResolved: number;
  /** undo rate = undone / executed(0..1,NaN-safe)。 */
  undoRate: number;
  /** action success = executed / proposed。 */
  actionSuccessRate: number;
}

const EMPTY_AGGREGATE: TelemetryAggregate = {
  triageShown: 0,
  triageMerged: 0,
  actionProposed: 0,
  actionExecuted: 0,
  actionUndone: 0,
  actionFailed: 0,
  aiSummaryShown: 0,
  aiSummaryStaleHit: 0,
  commandPrompt: 0,
  providerError: 0,
  multiselectBatchPlan: 0,
  smartSnoozeResolved: 0,
  undoRate: 0,
  actionSuccessRate: 0,
};

const MAX_BUFFER = 1000;

interface State {
  events: TelemetryEvent[];
  aggregate: TelemetryAggregate;
  enabled: boolean;
  sink: ((event: TelemetryEvent) => void) | null;
}

const initialState: State = {
  events: [],
  aggregate: EMPTY_AGGREGATE,
  enabled: false,
  sink: null,
};

let state: State = initialState;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function bumpAggregate(event: TelemetryEvent, agg: TelemetryAggregate): TelemetryAggregate {
  const next = { ...agg };
  switch (event.name) {
    case "triage_shown": next.triageShown += 1; break;
    case "triage_merged": next.triageMerged += 1; break;
    case "action_proposed": next.actionProposed += 1; break;
    case "action_executed": next.actionExecuted += 1; break;
    case "action_undone": next.actionUndone += 1; break;
    case "action_failed": next.actionFailed += 1; break;
    case "ai_summary_shown": next.aiSummaryShown += 1; break;
    case "ai_summary_stale_hit": next.aiSummaryStaleHit += 1; break;
    case "command_prompt": next.commandPrompt += 1; break;
    case "provider_error": next.providerError += 1; break;
    case "multiselect_batch_plan": next.multiselectBatchPlan += 1; break;
    case "smart_snooze_resolved": next.smartSnoozeResolved += 1; break;
    default: break;
  }
  next.undoRate = next.actionExecuted > 0 ? next.actionUndone / next.actionExecuted : 0;
  next.actionSuccessRate = next.actionProposed > 0 ? next.actionExecuted / next.actionProposed : 0;
  return next;
}

export const telemetryStore = {
  getState(): Readonly<State> {
    return state;
  },
  subscribe,

  /**
   * 记录一个事件。若 enabled=true 且 sink 已注册,转发到 sink。
   * Buffer 超出 MAX_BUFFER 时丢弃最旧的(但聚合保留 — 不回退)。
   */
  record(event: TelemetryEvent): void {
    const events = state.events.length >= MAX_BUFFER
      ? [...state.events.slice(state.events.length - MAX_BUFFER + 1), event]
      : [...state.events, event];
    const aggregate = bumpAggregate(event, state.aggregate);
    state = { ...state, events, aggregate };
    if (state.enabled && state.sink) {
      try { state.sink(event); } catch { /* sink 抛错不影响主流程 */ }
    }
    notify();
  },

  /** 设置启用 + sink(默认 console.debug)。仅在值变化时 notify,避免 hook 死循环。 */
  setEnabled(enabled: boolean, sink: (event: TelemetryEvent) => void = defaultSink): void {
    if (state.enabled === enabled && state.sink === sink) return;
    state = { ...state, enabled, sink };
    notify();
  },

  /** 测试 / 卸载时使用 — 清空 buffer + 聚合。 */
  reset(): void {
    state = initialState;
    notify();
  },

  /** 测试辅助:获取当前 buffer 长度。 */
  size(): number {
    return state.events.length;
  },
};

function defaultSink(event: TelemetryEvent): void {
  // 默认只在 DEV 模式下输出;生产环境静默。
  if (typeof console !== "undefined") {
    // eslint-disable-next-line no-console
    console.debug("[email-telemetry]", event.name, event.props ?? {});
  }
}

export function useTelemetryAggregate(): TelemetryAggregate {
  return useSyncExternalStore(
    subscribe,
    () => state.aggregate,
    () => EMPTY_AGGREGATE,
  );
}

export function useTelemetryEvents(): ReadonlyArray<TelemetryEvent> {
  return useSyncExternalStore(
    subscribe,
    () => state.events,
    () => [],
  );
}

export function useTelemetryEnabled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.enabled,
    () => false,
  );
}

/** 模块级便捷记录 — 不依赖 React hooks,IPC / setTimeout 等都能用。 */
export function recordTelemetry(
  name: TelemetryEventName,
  props?: TelemetryEvent["props"],
  accountId?: string,
): void {
  telemetryStore.record({
    name,
    ts: Date.now(),
    accountId,
    props,
  });
}
