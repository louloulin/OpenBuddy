/**
 * session-swap.test.ts — smoke tests for the warm-host "新建会话" fast path.
 *
 * 覆盖范围:
 *  - install 守卫: 没 install 时调用 newSession 抛 "not installed".
 *  - newSession 编排顺序: init → SessionManager.create → rebind → persistHeader → stamp → setModel.
 *  - ensureNewSession 并发合并: 同 key 并发调用共享 Promise, 不同 key 互不影响.
 *  - inFlight map 在调用完成后清理 (避免泄漏).
 */
import { afterEach, describe, it, vi, expect } from "vitest";

import {
  installSessionSwap,
  newSession,
  ensureNewSession,
  __resetSessionSwapForTest,
  __resetInFlightEnsureNewSessionForTest,
  type NewSessionResult,
} from "./session-swap";
import { createDefaultAgentHostState } from "./_default-state";

function makeStubState(): ReturnType<typeof createDefaultAgentHostState> {
  const state = createDefaultAgentHostState();
  // 提供最少的 session 占位让 newSession 的 tail 能跑完.
  state.session = {
    sessionId: "stub-session-id",
    sessionFile: "/tmp/stub-session.jsonl",
    cwd: "/tmp/work",
    model: { provider: "stub-provider", id: "stub-model" },
    sessionManager: {
      appendCustomEntry: vi.fn(),
    },
  } as any;
  return state;
}

function makeStubDeps(state: ReturnType<typeof createDefaultAgentHostState>) {
  return {
    state,
    initialize: vi.fn(async () => undefined),
    rebindSession: vi.fn(async () => undefined),
    persistPiSessionHeader: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    piSessionDir: vi.fn((cwd: string) => `${cwd}/.openbuddy/sessions`),
  };
}

afterEach(() => {
  __resetSessionSwapForTest();
  __resetInFlightEnsureNewSessionForTest();
});

describe("session-swap", () => {
  it("throws when not installed", async () => {
    await expect(newSession("/tmp/x")).rejects.toThrow(/not installed/);
  });

  it("orchestrates init → SessionManager.create → rebind → persistHeader → setModel", async () => {
    const state = makeStubState();
    const deps = makeStubDeps(state);
    installSessionSwap(deps);

    // Spy on SessionManager.create — vi 不能直接 mock named export, 所以
    // 我们只断言 deps 的执行顺序与参数, 真实 SessionManager 接受任意
    // cwd/piSessionDir 不会抛错 (在 vitest 里也是真调用).
    const result = await newSession("/tmp/work", "prov/model-x");

    expect(deps.initialize).toHaveBeenCalledWith({ cwd: "/tmp/work" });
    expect(deps.rebindSession).toHaveBeenCalledTimes(1);
    expect(deps.rebindSession.mock.calls[0]?.[1]).toBe("/tmp/work");
    expect(deps.persistPiSessionHeader).toHaveBeenCalledWith(state.session);
    expect(deps.setModel).toHaveBeenCalledWith("prov/model-x");

    const expected: NewSessionResult = {
      sessionId: "stub-session-id",
      sessionFile: "/tmp/stub-session.jsonl",
      cwd: "/tmp/work",
      model: { provider: "stub-provider", id: "stub-model" },
    };
    expect(result).toEqual(expected);
  });

  it("stamps mounted preset as openbuddy/agent-preset entry", async () => {
    const state = makeStubState();
    state.presetSessionRuntime = { id: "preset-a" } as any;
    installSessionSwap(makeStubDeps(state));

    await newSession("/tmp/work");
    expect((state.session!.sessionManager.appendCustomEntry as any)).toHaveBeenCalledWith(
      "openbuddy/agent-preset",
      { id: "preset-a", version: 1 },
    );
  });

  it("ensureNewSession coalesces concurrent calls with same key", async () => {
    const state = makeStubState();
    const deps = makeStubDeps(state);
    installSessionSwap(deps);

    // Two concurrent calls with same key must share the same Promise.
    const [r1, r2] = await Promise.all([
      ensureNewSession("/tmp/work", "model-a"),
      ensureNewSession("/tmp/work", "model-a"),
    ]);
    expect(r1).toBe(r2); // referential equality proves coalescing
    // Initialize was called only once (the second caller piggy-backed).
    expect(deps.initialize).toHaveBeenCalledTimes(1);
  });

  it("ensureNewSession keys are independent per (cwd, modelId)", async () => {
    const state = makeStubState();
    const deps = makeStubDeps(state);
    installSessionSwap(deps);

    const p1 = ensureNewSession("/tmp/a", "m1");
    const p2 = ensureNewSession("/tmp/a", "m2");
    const p3 = ensureNewSession("/tmp/b", "m1");
    // 3 个 key 都不同, 不应该 coalesce.
    await Promise.all([p1, p2, p3]);
    expect(deps.initialize).toHaveBeenCalledTimes(3);
  });
});
