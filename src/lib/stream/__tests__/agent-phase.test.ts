import { describe, it, expect } from "vitest";
import { IDLE_PHASE, phaseReducer, phaseLabel, type AgentPhase } from "../agent-phase";

describe("phaseReducer", () => {
  it("'agent_start' transitions to waiting_model", () => {
    expect(phaseReducer(IDLE_PHASE, { type: "agent_start" })).toEqual({ kind: "waiting_model" });
  });

  it("'agent_end' transitions to idle", () => {
    const next = phaseReducer({ kind: "waiting_model" }, { type: "agent_end" });
    expect(next).toBe(IDLE_PHASE);
  });

  it("'tool_start' from idle seeds running_tools with one entry", () => {
    const next = phaseReducer(IDLE_PHASE, { type: "tool_start", toolCallId: "t1", toolName: "read" });
    expect(next).toEqual({ kind: "running_tools", tools: [{ id: "t1", name: "read" }] });
  });

  it("'tool_start' adds to existing running_tools list without duplicating", () => {
    const start: AgentPhase = { kind: "running_tools", tools: [{ id: "t1", name: "read" }] };
    const next = phaseReducer(start, { type: "tool_start", toolCallId: "t2", toolName: "bash" });
    expect(next.kind).toBe("running_tools");
    if (next.kind !== "running_tools") throw new Error("expected running_tools");
    expect(next.tools.length).toBe(2);
    expect(next.tools.find((t) => t.id === "t2")).toEqual({ id: "t2", name: "bash" });
  });

  it("'tool_update' mutates only the matching id", () => {
    const start: AgentPhase = {
      kind: "running_tools",
      tools: [
        { id: "t1", name: "read" },
        { id: "t2", name: "bash" },
      ],
    };
    const next = phaseReducer(start, { type: "tool_update", toolCallId: "t1", progress: "10%" });
    if (next.kind !== "running_tools") throw new Error("expected running_tools");
    expect(next.tools[0]).toEqual({ id: "t1", name: "read", progress: "10%" });
    expect(next.tools[1]).toEqual({ id: "t2", name: "bash" });
  });

  it("'tool_end' drops the matching id and falls back to waiting_model when empty", () => {
    const start: AgentPhase = { kind: "running_tools", tools: [{ id: "t1", name: "read" }] };
    const next = phaseReducer(start, { type: "tool_end", toolCallId: "t1", status: "completed" });
    expect(next).toEqual({ kind: "waiting_model" });
  });

  it("'bash_start' sets running_command; 'bash_end' returns to waiting_model when was running", () => {
    const started = phaseReducer({ kind: "waiting_model" }, { type: "bash_start", command: "ls" });
    expect(started).toEqual({ kind: "running_command", command: "ls" });
    const ended = phaseReducer(started, { type: "bash_end" });
    expect(ended).toEqual({ kind: "waiting_model" });
  });

  it("'reset' always lands at IDLE_PHASE with reference equality", () => {
    const start: AgentPhase = { kind: "running_tools", tools: [{ id: "t1", name: "read" }] };
    expect(phaseReducer(start, { type: "reset" })).toBe(IDLE_PHASE);
  });

  it("'agent_start' reference is stable across identical events", () => {
    const a = phaseReducer(IDLE_PHASE, { type: "agent_start" });
    const b = phaseReducer(IDLE_PHASE, { type: "agent_start" });
    expect(a).toEqual(b);
  });
});

describe("phaseLabel", () => {
  it("returns a stable human label per phase kind", () => {
    expect(phaseLabel(IDLE_PHASE)).toBe("空闲");
    expect(phaseLabel({ kind: "waiting_model" })).toBe("等待模型");
    expect(phaseLabel({ kind: "running_command", command: "ls" })).toBe("运行命令: ls");
    expect(phaseLabel({ kind: "running_tools", tools: [{ id: "t1", name: "read" }] })).toBe(
      "运行工具: read",
    );
    expect(
      phaseLabel({ kind: "running_tools", tools: [{ id: "t1", name: "a" }, { id: "t2", name: "b" }] }),
    ).toBe("运行 2 个工具");
  });

  it("truncates long command names", () => {
    const long = "x".repeat(80);
    expect(phaseLabel({ kind: "running_command", command: long })).toContain("…");
  });
});
