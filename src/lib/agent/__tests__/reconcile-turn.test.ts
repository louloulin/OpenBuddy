/**
 * 计划 1.1 — 加载会话后按主进程回合状态把"运行中"接回来。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const piTurnState = vi.fn();
vi.mock("@/lib/agent/pi-client", () => ({ piTurnState: (id: string) => piTurnState(id) }));
vi.mock("@/stores/session-store", () => ({ useSessionStore: { getState: () => store } }));

import { reconcileTurnState } from "../reconcile-turn";

let store: any;

beforeEach(() => {
  piTurnState.mockReset();
  store = {
    sessionId: "s1",
    streaming: false,
    streamingMessageId: null,
    setTurnPhase: vi.fn(),
    setStreaming: vi.fn(),
    beginStreamingMessage: vi.fn(),
    appendStreamingDelta: vi.fn(),
  };
});

describe("reconcileTurnState", () => {
  it("主进程仍在运行而界面空闲:接回流式并开新气泡", async () => {
    piTurnState.mockResolvedValue({ sessionId: "s1", phase: "tool_running", since: 1 });
    await reconcileTurnState("s1");
    expect(store.setTurnPhase).toHaveBeenCalledWith("tool_running");
    expect(store.setStreaming).toHaveBeenCalledWith(true);
    expect(store.beginStreamingMessage).toHaveBeenCalledTimes(1);
  });

  it("切回后台跑着的会话:补回正在生成的那条回复", async () => {
    piTurnState.mockResolvedValue({ sessionId: "s1", phase: "streaming", since: 1, partial: { text: "已经写了一半", thinking: "想" } });
    await reconcileTurnState("s1");
    expect(store.appendStreamingDelta.mock.calls).toEqual([["想", "thought"], ["已经写了一半", "text"]]);
  });

  it("主进程空闲:只同步阶段,不动流式", async () => {
    piTurnState.mockResolvedValue({ sessionId: "s1", phase: "idle", since: 0 });
    await reconcileTurnState("s1");
    expect(store.setTurnPhase).toHaveBeenCalledWith("idle");
    expect(store.setStreaming).not.toHaveBeenCalled();
  });

  it("查询期间切走了会话:丢弃结果", async () => {
    piTurnState.mockResolvedValue({ sessionId: "s1", phase: "thinking", since: 1 });
    store.sessionId = "s2";
    await reconcileTurnState("s1");
    expect(store.setTurnPhase).not.toHaveBeenCalled();
  });

  it("通道不可用:保持现状", async () => {
    piTurnState.mockRejectedValue(new Error("no handler"));
    await expect(reconcileTurnState("s1")).resolves.toBeUndefined();
    expect(store.setTurnPhase).not.toHaveBeenCalled();
  });
});
