/**
 * 会话 pause / yield 状态机 —— 对齐 WorkBuddy `session:requestYield` /
 * `session:pauseQueue`。yield 是「软暂停」:停止当前生成,但保留会话上下文
 * (区别于 cancel 终止;区别于 queue-pause 只暂停排队)。
 *
 * 纯函数状态机 + 按 sessionId 的容器,便于单测。前端标记 pending yield,
 * 收到下一次 `pi://complete` 时确认 yielded(resume-ready)。
 */

export type YieldState = "idle" | "yielding" | "yielded";

/** 单个会话的 yield 状态。 */
export interface SessionYield {
  state: YieldState;
  /** 发起 yield 的时间戳(ms)。 */
  requestedAt?: number;
  /** 确认 yielded 的时间戳(ms)。 */
  yieldedAt?: number;
}

/** 状态机:合法迁移。 */
export function nextYieldState(from: YieldState, action: "request" | "confirm" | "resume" | "cancel"): YieldState {
  switch (action) {
    case "request":
      // 仅 idle → yielding(yielding/yielded 时重复请求无副作用)。
      return from === "idle" ? "yielding" : from;
    case "confirm":
      // yielding → yielded(收到 complete 后确认)。
      return from === "yielding" ? "yielded" : from;
    case "resume":
    case "cancel":
      // 任意 → idle。
      return "idle";
  }
}

/** 创建会话 yield 状态容器(按 sessionId)。 */
export function createYieldStore(): Record<string, SessionYield> {
  return {};
}

/** 标记一个会话发起 yield(request)。返回新 store。 */
export function requestYield(
  store: Record<string, SessionYield>,
  sessionId: string,
  now: number = Date.now(),
): Record<string, SessionYield> {
  const cur = store[sessionId] ?? { state: "idle" as YieldState };
  const next = nextYieldState(cur.state, "request");
  return { ...store, [sessionId]: { state: next, requestedAt: next === "yielding" ? now : cur.requestedAt } };
}

/** 确认一个会话已 yielded(收到 complete)。返回新 store。 */
export function confirmYielded(
  store: Record<string, SessionYield>,
  sessionId: string,
  now: number = Date.now(),
): Record<string, SessionYield> {
  const cur = store[sessionId];
  if (!cur || cur.state !== "yielding") return store;
  return { ...store, [sessionId]: { state: "yielded", requestedAt: cur.requestedAt, yieldedAt: now } };
}

/** 恢复 / 取消(resume 或 cancel 都回到 idle)。返回新 store。 */
export function clearYield(
  store: Record<string, SessionYield>,
  sessionId: string,
): Record<string, SessionYield> {
  if (!store[sessionId]) return store;
  const next = { ...store };
  delete next[sessionId];
  return next;
}

/** 读取一个会话的 yield 状态(无则 idle)。 */
export function getYieldState(store: Record<string, SessionYield>, sessionId: string): SessionYield {
  return store[sessionId] ?? { state: "idle" };
}

/** 是否处于「等待确认 yield」(已请求但尚未 complete)。 */
export function isYielding(store: Record<string, SessionYield>, sessionId: string): boolean {
  return getYieldState(store, sessionId).state === "yielding";
}

/** 是否已暂停(yielded,等待 resume)。 */
export function isYielded(store: Record<string, SessionYield>, sessionId: string): boolean {
  return getYieldState(store, sessionId).state === "yielded";
}
