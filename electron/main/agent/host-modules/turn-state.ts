/**
 * host-modules/turn-state.ts — 回合状态机(计划 1.1)。
 *
 * 主进程是回合状态的唯一权威:渲染层只投影 `pi://turn-state`,不再从零散
 * 事件(增量到没到、complete 来没来)自行推断"是否在运行"。
 *
 *   idle ──run_start──▶ thinking ──text──▶ streaming
 *     ▲                    ▲  │                │
 *     │                    │  └──tool_start──▶ tool_running ──(全部 tool_end)──▶ thinking
 *     │                    │                       │
 *     │          approval_end(回到进入前的阶段)◀── awaiting_approval ◀── approval_start(任意运行阶段)
 *     └────────────────────────── run_end(任意阶段)
 *
 * 纯数据结构 + 纯函数,不 import electron / pi;handle-session-event 与审批
 * 通道把事件喂进来,变化时由调用方广播。
 */

import type { TurnPhase } from "@openbuddy/shared-types";

export type { TurnPhase };

export type TurnInput =
  | { type: "run_start" }
  | { type: "thinking" }
  | { type: "text" }
  | { type: "tool_start" }
  | { type: "tool_end" }
  | { type: "approval_start" }
  | { type: "approval_end" }
  | { type: "run_end" };

export interface TurnState {
  phase: TurnPhase;
  /** 进入当前阶段的时间(ms)。 */
  since: number;
  /** 正在执行的工具数(并行工具调用)。 */
  runningTools: number;
  /** 挂起的审批 / 提问数。 */
  pendingApprovals: number;
  /** 审批开始前的阶段,审批结束后回到这里。 */
  resumePhase: Exclude<TurnPhase, "idle" | "awaiting_approval">;
}

export const IDLE_TURN: TurnState = Object.freeze({
  phase: "idle",
  since: 0,
  runningTools: 0,
  pendingApprovals: 0,
  resumePhase: "thinking",
});

function enter(state: TurnState, phase: TurnPhase, now: number, patch: Partial<TurnState> = {}): TurnState {
  return { ...state, ...patch, phase, since: phase === state.phase ? state.since : now };
}

/** 运行中、未被审批挡住时的"活动"阶段。 */
function activePhase(state: TurnState): Exclude<TurnPhase, "idle" | "awaiting_approval"> {
  return state.runningTools > 0 ? "tool_running" : state.resumePhase;
}

export function reduceTurn(state: TurnState, input: TurnInput, now: number): TurnState {
  switch (input.type) {
    case "run_start":
      // 新回合(或工具之后模型开的下一轮):已在运行时保持阶段,只清掉"已结束"。
      return state.phase === "idle"
        ? { phase: "thinking", since: now, runningTools: 0, pendingApprovals: 0, resumePhase: "thinking" }
        : state;
    case "run_end":
      return state.phase === "idle" ? state : { ...IDLE_TURN, since: now };
    case "thinking":
    case "text": {
      if (state.phase === "idle") return state;
      const next = input.type === "text" ? "streaming" : "thinking";
      if (state.phase === "awaiting_approval" || state.runningTools > 0) return { ...state, resumePhase: next };
      return enter(state, next, now, { resumePhase: next });
    }
    case "tool_start": {
      if (state.phase === "idle") return state;
      const runningTools = state.runningTools + 1;
      if (state.phase === "awaiting_approval") return { ...state, runningTools };
      return enter(state, "tool_running", now, { runningTools });
    }
    case "tool_end": {
      if (state.phase === "idle") return state;
      const runningTools = Math.max(0, state.runningTools - 1);
      // 工具跑完,模型要接着思考下一步。
      const patch = { runningTools, resumePhase: "thinking" as const };
      if (state.phase === "awaiting_approval") return { ...state, ...patch };
      return enter(state, runningTools > 0 ? "tool_running" : "thinking", now, patch);
    }
    case "approval_start": {
      if (state.phase === "idle") return state;
      const pendingApprovals = state.pendingApprovals + 1;
      return enter(state, "awaiting_approval", now, { pendingApprovals });
    }
    case "approval_end": {
      if (state.phase === "idle" || state.pendingApprovals === 0) return state;
      const pendingApprovals = state.pendingApprovals - 1;
      if (pendingApprovals > 0) return { ...state, pendingApprovals };
      return enter(state, activePhase(state), now, { pendingApprovals });
    }
  }
}

/** 按会话保存状态;`apply` 返回变化后的状态(没变返回 null,调用方据此决定是否广播)。 */
export class TurnStateTracker {
  private readonly bySession = new Map<string, TurnState>();

  get(sessionId: string): TurnState {
    return this.bySession.get(sessionId) ?? IDLE_TURN;
  }

  apply(sessionId: string, input: TurnInput, now = Date.now()): TurnState | null {
    const previous = this.get(sessionId);
    const next = reduceTurn(previous, input, now);
    if (next.phase === previous.phase) {
      if (next !== previous) this.store(sessionId, next);
      return null;
    }
    this.store(sessionId, next);
    return next;
  }

  private store(sessionId: string, state: TurnState): void {
    if (state.phase === "idle") this.bySession.delete(sessionId);
    else this.bySession.set(sessionId, state);
  }
}

/** 主进程单例:handle-session-event、审批通道和 IPC 查询共用。 */
export const turnStates = new TurnStateTracker();

type TurnStateListener = (sessionId: string, state: TurnState) => void;
let listener: TurnStateListener | null = null;

/** 宿主装配时注入广播(→ `pi://turn-state`);未注入时只记录不广播(测试 / 早期启动)。 */
export function setTurnStateListener(next: TurnStateListener | null): void {
  listener = next;
}

/** 喂一个输入;阶段变化时广播。 */
export function applyTurnInput(sessionId: string | undefined, input: TurnInput): void {
  if (!sessionId) return;
  const changed = turnStates.apply(sessionId, input);
  if (changed) listener?.(sessionId, changed);
}

/**
 * 挂起审批 / 提问发给渲染层的事件,按 requestId 记住:窗口重新加载后渲染层的
 * 卡片队列是空的,而主进程还在等用户判定 —— 以前回合就此卡死。渲染层查询
 * `agent:turn-state` 时据此重发(带 `replayed: true`,渲染层按 requestId 去重)。
 */
const pendingUiEvents = new Map<string, { sessionId: string; replay: () => void }>();

export function rememberPendingUiEvent(requestId: string, sessionId: string, replay: () => void): void {
  pendingUiEvents.set(requestId, { sessionId, replay });
}

/** 重发该会话仍在等待的审批 / 提问;返回重发条数。 */
export function replayPendingUiEvents(sessionId: string): number {
  let count = 0;
  for (const event of pendingUiEvents.values()) {
    if (event.sessionId !== sessionId) continue;
    event.replay();
    count += 1;
  }
  return count;
}

/**
 * 挂起的审批 / 提问表:增删时同步驱动状态机(approval_start / approval_end)。
 * 5 处创建、3 处判定的调用点都只认 Map 接口,这里集中处理,避免逐个改漏。
 */
export class TurnTrackedRequestMap<V extends { sessionId?: string }> extends Map<string, V> {
  override set(key: string, value: V): this {
    const isNew = !this.has(key);
    super.set(key, value);
    if (isNew) applyTurnInput(value.sessionId, { type: "approval_start" });
    return this;
  }

  override delete(key: string): boolean {
    const existing = this.get(key);
    const removed = super.delete(key);
    pendingUiEvents.delete(key);
    if (removed) applyTurnInput(existing?.sessionId, { type: "approval_end" });
    return removed;
  }

  override clear(): void {
    for (const key of [...this.keys()]) this.delete(key);
  }
}
