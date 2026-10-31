// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { IDLE_TURN, TurnStateTracker, reduceTurn, type TurnInput, type TurnPhase, type TurnState } from "./turn-state";

function run(inputs: TurnInput["type"][], from: TurnState = IDLE_TURN): TurnPhase[] {
  let state = from;
  return inputs.map((type, i) => {
    state = reduceTurn(state, { type } as TurnInput, i + 1);
    return state.phase;
  });
}

describe("reduceTurn 迁移表", () => {
  it("普通回答:思考 → 正文 → 结束", () => {
    expect(run(["run_start", "thinking", "text", "run_end"])).toEqual(["thinking", "thinking", "streaming", "idle"]);
  });

  it("工具回合:工具执行中 → 工具结束回到思考 → 再出正文", () => {
    expect(run(["run_start", "text", "tool_start", "tool_end", "text", "run_end"]))
      .toEqual(["thinking", "streaming", "tool_running", "thinking", "streaming", "idle"]);
  });

  it("并行工具:全部结束前保持 tool_running", () => {
    expect(run(["run_start", "tool_start", "tool_start", "tool_end", "tool_end"]))
      .toEqual(["thinking", "tool_running", "tool_running", "tool_running", "thinking"]);
  });

  it("工具内请求审批:等待确认 → 确认后回到 tool_running", () => {
    expect(run(["run_start", "tool_start", "approval_start", "approval_end", "tool_end"]))
      .toEqual(["thinking", "tool_running", "awaiting_approval", "tool_running", "thinking"]);
  });

  it("多个审批:全部判定后才离开 awaiting_approval", () => {
    expect(run(["run_start", "text", "approval_start", "approval_start", "approval_end", "approval_end"]))
      .toEqual(["thinking", "streaming", "awaiting_approval", "awaiting_approval", "awaiting_approval", "streaming"]);
  });

  it("等待审批期间到达的增量不抢走 awaiting_approval,但记住审批后的阶段", () => {
    expect(run(["run_start", "approval_start", "text", "approval_end"]))
      .toEqual(["thinking", "awaiting_approval", "awaiting_approval", "streaming"]);
  });

  it("任意阶段 run_end 都回到 idle(停止 / 出错时清掉挂起计数)", () => {
    for (const mid of ["text", "tool_start", "approval_start"] as const) {
      const phases = run(["run_start", mid, "run_end", "run_start"]);
      expect(phases[2]).toBe("idle");
      expect(phases[3]).toBe("thinking");
    }
  });

  it("idle 时的零散事件不会把状态拉起来(迟到的增量 / 工具结束)", () => {
    expect(run(["text", "tool_start", "tool_end", "approval_start", "approval_end", "run_end"]))
      .toEqual(["idle", "idle", "idle", "idle", "idle", "idle"]);
  });

  it("运行中再次 run_start(工具之后的下一轮)保持当前阶段", () => {
    expect(run(["run_start", "text", "run_start"])).toEqual(["thinking", "streaming", "streaming"]);
  });

  it("since 只在阶段变化时更新", () => {
    let state = reduceTurn(IDLE_TURN, { type: "run_start" }, 100);
    state = reduceTurn(state, { type: "thinking" }, 200);
    expect(state.since).toBe(100);
    state = reduceTurn(state, { type: "text" }, 300);
    expect(state.since).toBe(300);
  });
});

describe("TurnStateTracker", () => {
  it("只在阶段变化时返回新状态,并按会话隔离", () => {
    const tracker = new TurnStateTracker();
    expect(tracker.apply("a", { type: "run_start" }, 1)?.phase).toBe("thinking");
    expect(tracker.apply("a", { type: "thinking" }, 2)).toBeNull();
    expect(tracker.get("b").phase).toBe("idle");
    expect(tracker.apply("a", { type: "tool_start" }, 3)?.phase).toBe("tool_running");
    // 计数变化但阶段不变:不广播,但要记住。
    expect(tracker.apply("a", { type: "tool_start" }, 4)).toBeNull();
    expect(tracker.apply("a", { type: "tool_end" }, 5)).toBeNull();
    expect(tracker.apply("a", { type: "tool_end" }, 6)?.phase).toBe("thinking");
    expect(tracker.apply("a", { type: "run_end" }, 7)?.phase).toBe("idle");
    expect(tracker.get("a")).toBe(IDLE_TURN);
  });
});

describe("挂起审批的重发", () => {
  it("只重发仍在等待的请求,判定后不再重发", async () => {
    const { TurnTrackedRequestMap, rememberPendingUiEvent, replayPendingUiEvents } = await import("./turn-state");
    const map = new TurnTrackedRequestMap<{ sessionId: string }>();
    const replay = vi.fn();
    map.set("r1", { sessionId: "s1" });
    rememberPendingUiEvent("r1", "s1", replay);
    expect(replayPendingUiEvents("other")).toBe(0);
    expect(replayPendingUiEvents("s1")).toBe(1);
    expect(replay).toHaveBeenCalledTimes(1);
    map.delete("r1");
    expect(replayPendingUiEvents("s1")).toBe(0);
  });
});
