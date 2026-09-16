/**
 * @openbuddy/ui-onboarding/onboarding-reducer — 首启引导的纯状态机
 *
 * 为什么把它独立成一组纯函数:引导流程是全应用最"脏"的一段交互 —— 可中断、
 * 可恢复、可跳过、跨版本升级后步骤集合还会变。把它压成
 * `storage → state → state` 的纯函数之后,UI 只负责渲染,宿主只负责注入
 * 步骤内容与副作用,两者都不需要理解对方的内部结构。
 *
 * 契约:
 *   - 所有函数无副作用(除 `read*` / `write*` / `clear*` 显式操作注入的 storage);
 *   - 所有函数都接受可选 `stepIds`,缺省时沿用 state 里已有的 id 序列,
 *     因此宿主换步骤列表时只需传入新列表,历史进度按 id 保留。
 *   - 任何解析失败都退化为"全新状态",绝不抛异常(引导崩了比引导没跑更糟)。
 */

/** storage key —— 宿主如需自定义命名空间,直接改这个常量的消费方式即可。 */
export const ONBOARDING_STORAGE_KEY = "openbuddy.onboarding.state";

/** 状态结构版本;版本不匹配视为历史脏数据,直接重置。 */
export const ONBOARDING_STATE_VERSION = 1;

/** 最小 storage 契约(localStorage / sessionStorage / 内存实现均可注入)。 */
export interface OnboardingStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** 单个步骤的状态。`active` 只应出现在 `state.index` 指向的那一步。 */
export type OnboardingStepStatus = "pending" | "active" | "done" | "skipped";

/** 整个引导流程的状态。 */
export type OnboardingStatus = "idle" | "in-progress" | "done" | "dismissed";

export interface OnboardingStepRecord {
  id: string;
  status: OnboardingStepStatus;
}

export interface OnboardingState {
  version: number;
  status: OnboardingStatus;
  /** 当前步骤下标;始终落在 `[0, steps.length - 1]`。 */
  index: number;
  steps: OnboardingStepRecord[];
  startedAt?: number;
  updatedAt: number;
  completedAt?: number;
}

/** 浏览器环境下的默认 storage;非浏览器环境返回 null(组件据此退化为纯内存)。 */
export function defaultOnboardingStorage(): OnboardingStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function idsOf(state: OnboardingState): string[] {
  return state.steps.map((step) => step.id);
}

function idsFromState(state: OnboardingState, stepIds?: readonly string[]): string[] {
  return stepIds ? [...stepIds] : idsOf(state);
}

function clampIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.trunc(index), total - 1));
}

/**
 * 把 state 的步骤记录与最新的 `stepIds` 对齐:
 *   - 已消失的 id 丢弃(进度不再有意义);
 *   - 新增的 id 以 `pending` 追加;
 *   - 已存在的 id 保留原状态;
 *   - `index` 重新夹紧,并把 `active` 标记移到当前下标。
 */
export function syncOnboardingSteps(
  state: OnboardingState,
  stepIds: readonly string[],
  now: number = Date.now(),
): OnboardingState {
  const previous = new Map(state.steps.map((step) => [step.id, step.status]));
  const index = clampIndex(state.index, stepIds.length);
  const steps: OnboardingStepRecord[] = stepIds.map((id, i) => {
    const kept = previous.get(id);
    if (kept === "done" || kept === "skipped") return { id, status: kept };
    return { id, status: i === index ? "active" : "pending" };
  });
  // 只有一个步骤允许是 active;若当前下标被更早的 done 占住,仍强制标 active。
  if (steps.length > 0) steps[index] = { id: steps[index].id, status: "active" };
  return { ...state, steps, index, updatedAt: now };
}

/** 全新状态:第 0 步 active,其余 pending。 */
export function createInitialOnboardingState(
  stepIds: readonly string[],
  now: number = Date.now(),
): OnboardingState {
  const steps = stepIds.map((id, i) => ({
    id,
    status: (i === 0 ? "active" : "pending") as OnboardingStepStatus,
  }));
  return {
    version: ONBOARDING_STATE_VERSION,
    status: stepIds.length === 0 ? "done" : "idle",
    index: 0,
    steps,
    startedAt: now,
    updatedAt: now,
    completedAt: stepIds.length === 0 ? now : undefined,
  };
}

/** 当前步骤记录(可能为空 —— 空步骤列表是合法输入)。 */
export function activeOnboardingStep(state: OnboardingState): OnboardingStepRecord | undefined {
  return state.steps[state.index];
}

export function isOnboardingComplete(state: OnboardingState): boolean {
  return state.status === "done";
}

/** 是否值得恢复:用户已经走过至少一步且还没结束。 */
export function isOnboardingResumable(state: OnboardingState): boolean {
  return state.status === "in-progress" && state.index > 0;
}

/** 进度(`percent` 为 0–100 的整数,便于直接喂给进度条)。 */
export function onboardingProgress(state: OnboardingState): {
  resolved: number;
  total: number;
  percent: number;
} {
  const total = state.steps.length;
  const resolved = state.steps.filter(
    (step) => step.status === "done" || step.status === "skipped",
  ).length;
  const percent = total === 0 ? 100 : Math.round((resolved / total) * 100);
  return { resolved, total, percent };
}

function withActive(state: OnboardingState, index: number, now: number): OnboardingState {
  const steps = state.steps.map((step, i) => ({
    id: step.id,
    status: (i === index
      ? "active"
      : step.status === "active"
        ? "pending"
        : step.status) as OnboardingStepStatus,
  }));
  return { ...state, index, steps, updatedAt: now };
}

function markCurrent(state: OnboardingState, status: OnboardingStepStatus): OnboardingStepRecord[] {
  return state.steps.map((step, i) => (i === state.index ? { ...step, status } : { ...step }));
}

/**
 * 下一步:当前步骤标记 done 并前进。已经是最后一步时收敛为
 * `status: "done"` + `completedAt`,index 停在最后一步(而不是越界)。
 */
export function nextOnboardingStep(
  state: OnboardingState,
  stepIds?: readonly string[],
  now: number = Date.now(),
): OnboardingState {
  const synced = syncOnboardingSteps(state, idsFromState(state, stepIds), now);
  const steps = markCurrent(synced, "done");
  const isLast = synced.index >= synced.steps.length - 1;
  if (synced.steps.length === 0 || isLast) {
    return {
      ...synced,
      status: "done",
      steps,
      updatedAt: now,
      completedAt: synced.completedAt ?? now,
    };
  }
  const advanced: OnboardingState = { ...synced, status: "in-progress", steps };
  return withActive(advanced, synced.index + 1, now);
}

/** 上一步:只移动游标,不回滚已完成状态(用户回看不应丢失进度)。 */
export function prevOnboardingStep(
  state: OnboardingState,
  stepIds?: readonly string[],
  now: number = Date.now(),
): OnboardingState {
  const synced = syncOnboardingSteps(state, idsFromState(state, stepIds), now);
  if (synced.index <= 0) return withActive(synced, 0, now);
  const reopened: OnboardingState =
    synced.status === "done"
      ? { ...synced, status: "in-progress", completedAt: undefined }
      : synced;
  return withActive(reopened, synced.index - 1, now);
}

/** 跳过当前步骤:标记 skipped 并前进(语义与 next 一致,只是标记不同)。 */
export function skipOnboardingStep(
  state: OnboardingState,
  stepIds?: readonly string[],
  now: number = Date.now(),
): OnboardingState {
  const synced = syncOnboardingSteps(state, idsFromState(state, stepIds), now);
  const steps = markCurrent(synced, "skipped");
  const isLast = synced.index >= synced.steps.length - 1;
  if (synced.steps.length === 0 || isLast) {
    return {
      ...synced,
      status: "done",
      steps,
      updatedAt: now,
      completedAt: synced.completedAt ?? now,
    };
  }
  const advanced: OnboardingState = { ...synced, status: "in-progress", steps };
  return withActive(advanced, synced.index + 1, now);
}

/**
 * 标记当前步骤完成但不前进。
 *
 * 用于异步步骤(例如"输入 API Key 并校验通过"),校验回调落地时用户可能已经
 * 手动点了下一步 —— 这时只更新状态,不移动游标,避免把用户拽回去。
 */
export function completeOnboardingStep(
  state: OnboardingState,
  stepIds?: readonly string[],
  now: number = Date.now(),
): OnboardingState {
  const synced = syncOnboardingSteps(state, idsFromState(state, stepIds), now);
  return {
    ...synced,
    status: synced.status === "idle" ? "in-progress" : synced.status,
    steps: markCurrent(synced, "done"),
    updatedAt: now,
  };
}

/** 跳到指定步骤(越界自动夹紧)。 */
export function gotoOnboardingStep(
  state: OnboardingState,
  index: number,
  stepIds?: readonly string[],
  now: number = Date.now(),
): OnboardingState {
  const synced = syncOnboardingSteps(state, idsFromState(state, stepIds), now);
  const target = clampIndex(index, synced.steps.length);
  const reopened: OnboardingState =
    synced.status === "done" && target < synced.steps.length - 1
      ? { ...synced, status: "in-progress", completedAt: undefined }
      : synced;
  return withActive(reopened, target, now);
}

/** 整段跳过 / 用户关掉引导:保留步骤记录,状态置 dismissed。 */
export function dismissOnboarding(
  state: OnboardingState,
  now: number = Date.now(),
): OnboardingState {
  return { ...state, status: "dismissed", updatedAt: now };
}

/** 重置:回到全新状态(宿主可同时调用 `clear*` 抹掉持久化痕迹)。 */
export function resetOnboarding(
  stepIds: readonly string[],
  now: number = Date.now(),
): OnboardingState {
  return createInitialOnboardingState(stepIds, now);
}

function isStorageLike(value: unknown): value is OnboardingStorageLike {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as OnboardingStorageLike).getItem === "function" &&
    typeof (value as OnboardingStorageLike).setItem === "function"
  );
}

function isValidState(value: unknown): value is OnboardingState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as OnboardingState;
  return (
    candidate.version === ONBOARDING_STATE_VERSION &&
    Array.isArray(candidate.steps) &&
    candidate.steps.every(
      (step) =>
        !!step &&
        typeof step.id === "string" &&
        (step.status === "pending" ||
          step.status === "active" ||
          step.status === "done" ||
          step.status === "skipped"),
    ) &&
    typeof candidate.index === "number" &&
    (candidate.status === "idle" ||
      candidate.status === "in-progress" ||
      candidate.status === "done" ||
      candidate.status === "dismissed")
  );
}

/**
 * 读取持久化状态并与当前步骤列表对齐。任何异常 / 脏数据 → 全新状态。
 * 传 `null` storage 时同样返回全新状态,调用方无需分叉。
 */
export function readOnboardingState(
  storage: OnboardingStorageLike | null | undefined,
  stepIds: readonly string[],
  now: number = Date.now(),
): OnboardingState {
  if (!isStorageLike(storage)) return createInitialOnboardingState(stepIds, now);
  let raw: string | null = null;
  try {
    raw = storage.getItem(ONBOARDING_STORAGE_KEY);
  } catch {
    return createInitialOnboardingState(stepIds, now);
  }
  if (!raw) return createInitialOnboardingState(stepIds, now);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return createInitialOnboardingState(stepIds, now);
  }
  if (!isValidState(parsed)) return createInitialOnboardingState(stepIds, now);
  return syncOnboardingSteps({ ...parsed }, stepIds, now);
}

/** 写入持久化状态;失败(配额 / 权限)返回 false,绝不抛出。 */
export function writeOnboardingState(
  storage: OnboardingStorageLike | null | undefined,
  state: OnboardingState,
): boolean {
  if (!isStorageLike(storage)) return false;
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** 清掉持久化痕迹(重置引导用)。 */
export function clearOnboardingState(storage: OnboardingStorageLike | null | undefined): void {
  if (!isStorageLike(storage) || typeof storage.removeItem !== "function") return;
  try {
    storage.removeItem(ONBOARDING_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
