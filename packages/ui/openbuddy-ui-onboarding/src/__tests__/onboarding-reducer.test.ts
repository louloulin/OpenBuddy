import { describe, expect, it } from "vitest";

import {
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_STATE_VERSION,
  activeOnboardingStep,
  clearOnboardingState,
  completeOnboardingStep,
  createInitialOnboardingState,
  defaultOnboardingStorage,
  dismissOnboarding,
  gotoOnboardingStep,
  isOnboardingComplete,
  isOnboardingResumable,
  nextOnboardingStep,
  onboardingProgress,
  prevOnboardingStep,
  readOnboardingState,
  resetOnboarding,
  skipOnboardingStep,
  syncOnboardingSteps,
  writeOnboardingState,
  type OnboardingState,
  type OnboardingStorageLike,
} from "../lib/onboarding-reducer";

function memoryStorage(seed?: Record<string, string>): OnboardingStorageLike & {
  dump(): Record<string, string>;
} {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map.entries()),
  };
}

const IDS = ["welcome", "theme", "provider"] as const;
const T0 = 1_700_000_000_000;

describe("@openbuddy/ui-onboarding/onboarding-reducer", () => {
  it("createInitialOnboardingState 把第 0 步置为 active", () => {
    const state = createInitialOnboardingState([...IDS], T0);
    expect(state.version).toBe(ONBOARDING_STATE_VERSION);
    expect(state.status).toBe("idle");
    expect(state.index).toBe(0);
    expect(state.steps.map((s) => s.status)).toEqual(["active", "pending", "pending"]);
    expect(state.startedAt).toBe(T0);
    expect(state.completedAt).toBeUndefined();
  });

  it("createInitialOnboardingState 对空步骤列表直接判定完成", () => {
    const state = createInitialOnboardingState([], T0);
    expect(state.status).toBe("done");
    expect(state.completedAt).toBe(T0);
    expect(isOnboardingComplete(state)).toBe(true);
  });

  it("nextOnboardingStep 标记当前步 done 并前进", () => {
    const start = createInitialOnboardingState([...IDS], T0);
    const step1 = nextOnboardingStep(start, [...IDS], T0 + 1);
    expect(step1.index).toBe(1);
    expect(step1.status).toBe("in-progress");
    expect(step1.steps.map((s) => s.status)).toEqual(["done", "active", "pending"]);
    expect(activeOnboardingStep(step1)?.id).toBe("theme");
    expect(isOnboardingResumable(step1)).toBe(true);

    const step2 = nextOnboardingStep(step1, [...IDS], T0 + 2);
    expect(step2.steps.map((s) => s.status)).toEqual(["done", "done", "active"]);
  });

  it("nextOnboardingStep 在最后一步收敛为 done,index 不越界", () => {
    let state = createInitialOnboardingState([...IDS], T0);
    state = nextOnboardingStep(state, [...IDS], T0 + 1);
    state = nextOnboardingStep(state, [...IDS], T0 + 2);
    state = nextOnboardingStep(state, [...IDS], T0 + 3);
    expect(state.status).toBe("done");
    expect(state.index).toBe(2);
    expect(state.completedAt).toBe(T0 + 3);
    expect(state.steps.every((s) => s.status === "done")).toBe(true);
    expect(isOnboardingResumable(state)).toBe(false);
  });

  it("nextOnboardingStep 幂等:末尾再点一次不会改写 completedAt", () => {
    let state = createInitialOnboardingState(["only"], T0);
    state = nextOnboardingStep(state, ["only"], T0 + 5);
    const again = nextOnboardingStep(state, ["only"], T0 + 9);
    expect(again.completedAt).toBe(T0 + 5);
    expect(again.status).toBe("done");
  });

  it("prevOnboardingStep 回看时保留 done,但把离开的 active 退回 pending", () => {
    let state = createInitialOnboardingState([...IDS], T0);
    state = nextOnboardingStep(state, [...IDS], T0 + 1);
    state = nextOnboardingStep(state, [...IDS], T0 + 2);
    expect(state.steps.map((s) => s.status)).toEqual(["done", "done", "active"]);

    const back = prevOnboardingStep(state, [...IDS], T0 + 3);
    expect(back.index).toBe(1);
    // 第 0 步的 done 是用户的真实进度,回看不应该抹掉;
    // 第 2 步只是"游标到过",还没被解决,所以退回 pending。
    expect(back.steps.map((s) => s.status)).toEqual(["done", "active", "pending"]);

    const backTwice = prevOnboardingStep(back, [...IDS], T0 + 4);
    expect(backTwice.steps.map((s) => s.status)).toEqual(["active", "pending", "pending"]);
  });

  it("prevOnboardingStep 在第 0 步保持不动", () => {
    const start = createInitialOnboardingState([...IDS], T0);
    const back = prevOnboardingStep(start, [...IDS], T0 + 1);
    expect(back.index).toBe(0);
    expect(back.updatedAt).toBe(T0 + 1);
  });

  it("prevOnboardingStep 把 done 状态重新打开(用户回看后再继续)", () => {
    let state: OnboardingState = createInitialOnboardingState(["a", "b"], T0);
    state = nextOnboardingStep(state, ["a", "b"], T0 + 1);
    state = nextOnboardingStep(state, ["a", "b"], T0 + 2);
    expect(state.status).toBe("done");
    const back = prevOnboardingStep(state, ["a", "b"], T0 + 3);
    expect(back.status).toBe("in-progress");
    expect(back.completedAt).toBeUndefined();
  });

  it("skipOnboardingStep 标记 skipped 并前进", () => {
    const start = createInitialOnboardingState([...IDS], T0);
    const skipped = skipOnboardingStep(start, [...IDS], T0 + 1);
    expect(skipped.index).toBe(1);
    expect(skipped.steps[0].status).toBe("skipped");
    expect(skipped.steps[1].status).toBe("active");
  });

  it("skipOnboardingStep 跳过最后一步即完成", () => {
    let state = createInitialOnboardingState(["a", "b"], T0);
    state = nextOnboardingStep(state, ["a", "b"], T0 + 1);
    const done = skipOnboardingStep(state, ["a", "b"], T0 + 2);
    expect(done.status).toBe("done");
    expect(done.steps.map((s) => s.status)).toEqual(["done", "skipped"]);
  });

  it("completeOnboardingStep 只落状态不移动游标(异步步骤)", () => {
    let state = createInitialOnboardingState([...IDS], T0);
    state = nextOnboardingStep(state, [...IDS], T0 + 1);
    const marked = completeOnboardingStep(state, [...IDS], T0 + 2);
    expect(marked.index).toBe(1);
    expect(marked.steps[1].status).toBe("done");
    expect(marked.status).toBe("in-progress");
  });

  it("gotoOnboardingStep 夹紧越界下标", () => {
    const start = createInitialOnboardingState([...IDS], T0);
    expect(gotoOnboardingStep(start, 99, [...IDS], T0 + 1).index).toBe(2);
    expect(gotoOnboardingStep(start, -5, [...IDS], T0 + 2).index).toBe(0);
  });

  it("syncOnboardingSteps 按 id 保留进度、追加新步骤、丢弃消失的步骤", () => {
    let state = createInitialOnboardingState([...IDS], T0);
    state = nextOnboardingStep(state, [...IDS], T0 + 1);
    const changed = syncOnboardingSteps(state, ["welcome", "provider", "marketplace"], T0 + 2);
    expect(changed.steps.map((s) => s.id)).toEqual(["welcome", "provider", "marketplace"]);
    expect(changed.steps[0].status).toBe("done");
    // 只剩两步时 index=1 仍然合法(指到 provider)
    expect(changed.index).toBe(1);
    expect(changed.steps[1].status).toBe("active");
    expect(changed.steps[2].status).toBe("pending");
  });

  it("onboardingProgress 统计已解决(完成 / 跳过)步骤", () => {
    let state = createInitialOnboardingState([...IDS], T0);
    state = skipOnboardingStep(state, [...IDS], T0 + 1);
    const progress = onboardingProgress(state);
    expect(progress).toEqual({ resolved: 1, total: 3, percent: 33 });
    expect(onboardingProgress(createInitialOnboardingState([], T0)).percent).toBe(100);
  });

  it("dismissOnboarding 只改状态,保留步骤记录", () => {
    const start = createInitialOnboardingState([...IDS], T0);
    const dismissed = dismissOnboarding(start, T0 + 1);
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.steps).toHaveLength(3);
    expect(dismissed.updatedAt).toBe(T0 + 1);
  });

  it("resetOnboarding 回到全新状态", () => {
    let state = createInitialOnboardingState([...IDS], T0);
    state = nextOnboardingStep(state, [...IDS], T0 + 1);
    const fresh = resetOnboarding([...IDS], T0 + 9);
    expect(fresh).toEqual(createInitialOnboardingState([...IDS], T0 + 9));
  });

  it("write → read 往返保留进度", () => {
    const storage = memoryStorage();
    let state = createInitialOnboardingState([...IDS], T0);
    state = nextOnboardingStep(state, [...IDS], T0 + 1);
    expect(writeOnboardingState(storage, state)).toBe(true);
    const restored = readOnboardingState(storage, [...IDS], T0 + 2);
    expect(restored.index).toBe(1);
    expect(restored.steps.map((s) => s.status)).toEqual(["done", "active", "pending"]);
    expect(storage.dump()[ONBOARDING_STORAGE_KEY]).toContain('"index":1');
  });

  it("readOnboardingState 面对脏数据 / 版本不匹配 / 异常 storage 一律退化为全新状态", () => {
    const corrupt = memoryStorage({ [ONBOARDING_STORAGE_KEY]: "{" });
    expect(readOnboardingState(corrupt, [...IDS], T0).index).toBe(0);
    expect(readOnboardingState(corrupt, [...IDS], T0).steps[0].status).toBe("active");

    const oldVersion = memoryStorage({
      [ONBOARDING_STORAGE_KEY]: JSON.stringify({
        ...createInitialOnboardingState([...IDS], T0),
        version: 0,
      }),
    });
    expect(readOnboardingState(oldVersion, [...IDS], T0).updatedAt).toBe(T0);

    const throwing: OnboardingStorageLike = {
      getItem() {
        throw new Error("quota");
      },
      setItem() {
        throw new Error("quota");
      },
    };
    expect(readOnboardingState(throwing, [...IDS], T0).index).toBe(0);
    expect(writeOnboardingState(throwing, createInitialOnboardingState([...IDS], T0))).toBe(false);

    expect(readOnboardingState(null, [...IDS], T0).index).toBe(0);
    expect(writeOnboardingState(null, createInitialOnboardingState([...IDS], T0))).toBe(false);
  });

  it("readOnboardingState 与当前步骤列表对齐(宿主改了步骤)", () => {
    const storage = memoryStorage();
    let state = createInitialOnboardingState([...IDS], T0);
    state = nextOnboardingStep(state, [...IDS], T0 + 1);
    writeOnboardingState(storage, state);
    const restored = readOnboardingState(
      storage,
      ["welcome", "theme", "provider", "extra"],
      T0 + 3,
    );
    expect(restored.steps.map((s) => s.id)).toEqual(["welcome", "theme", "provider", "extra"]);
    expect(restored.steps[3].status).toBe("pending");
  });

  it("clearOnboardingState 清掉持久化痕迹", () => {
    const storage = memoryStorage();
    writeOnboardingState(storage, createInitialOnboardingState([...IDS], T0));
    expect(Object.keys(storage.dump())).toHaveLength(1);
    clearOnboardingState(storage);
    expect(Object.keys(storage.dump())).toHaveLength(0);
  });

  it("defaultOnboardingStorage 在 jsdom 下返回 localStorage", () => {
    expect(defaultOnboardingStorage()).toBe(window.localStorage);
  });
});
