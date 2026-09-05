import { describe, it, expect } from "vitest";
import { toPhaseEvent } from "../useAgentPhase";
import type { AgentPhaseEvent } from "@/lib/stream/agent-phase";

describe("toPhaseEvent", () => {
  it("returns null for unknown event types", () => {
    expect(toPhaseEvent({ type: "agent_message_chunk" })).toBeNull();
    expect(toPhaseEvent({ type: "plan" })).toBeNull();
    expect(toPhaseEvent({})).toBeNull();
  });

  it("maps agent_start to a phase agent_start", () => {
    const event = toPhaseEvent({ type: "agent_start" });
    expect(event).toEqual<AgentPhaseEvent>({ type: "agent_start" });
  });

  it("maps tool_call to a phase tool_start with id + name", () => {
    const event = toPhaseEvent({ type: "tool_call", toolCallId: "t1", title: "read" });
    expect(event).toEqual<AgentPhaseEvent>({ type: "tool_start", toolCallId: "t1", toolName: "read" });
  });

  it("maps tool_call_update to a phase tool_update with progress", () => {
    const event = toPhaseEvent({
      type: "tool_call_update",
      toolCallId: "t1",
      update: { progress: "50%" },
    });
    expect(event).toEqual<AgentPhaseEvent>({
      type: "tool_update",
      toolCallId: "t1",
      progress: "50%",
    });
  });

  it("maps tool_call_end to a phase tool_end", () => {
    const event = toPhaseEvent({ type: "tool_call_end", toolCallId: "t1" });
    expect(event).toEqual<AgentPhaseEvent>({
      type: "tool_end",
      toolCallId: "t1",
      status: "completed",
    });
  });

  it("maps bash_start / bash_end to their phase events", () => {
    expect(toPhaseEvent({ type: "bash_start", command: "ls" })).toEqual<AgentPhaseEvent>({
      type: "bash_start",
      command: "ls",
    });
    expect(toPhaseEvent({ type: "bash_end" })).toEqual<AgentPhaseEvent>({ type: "bash_end" });
  });

  it("tool_call without title defaults to 'tool' so the badge never crashes", () => {
    const event = toPhaseEvent({ type: "tool_call", toolCallId: "t1" });
    expect(event).toMatchObject({ type: "tool_start", toolCallId: "t1", toolName: "tool" });
  });

  it("tool_call_update with non-string progress omits the field", () => {
    const event = toPhaseEvent({
      type: "tool_call_update",
      toolCallId: "t1",
      update: { progress: 5 },
    });
    expect(event).toEqual<AgentPhaseEvent>({ type: "tool_update", toolCallId: "t1" });
  });

  // Phase R3.0 (pi-web-alignment) — terminal status on tool_call_update must
  // emit `tool_end` so running_tools rows actually leave the chip. Without
  // this the chip accumulates forever ("运行 12 个工具") until agent_end.
  it("tool_call_update with status=completed emits tool_end", () => {
    const event = toPhaseEvent({
      type: "tool_call_update",
      toolCallId: "t1",
      status: "completed",
    });
    expect(event).toEqual<AgentPhaseEvent>({ type: "tool_end", toolCallId: "t1", status: "completed" });
  });

  it("tool_call_update with status=failed emits tool_end with failed status", () => {
    const event = toPhaseEvent({
      type: "tool_call_update",
      toolCallId: "t1",
      status: "failed",
    });
    expect(event).toEqual<AgentPhaseEvent>({ type: "tool_end", toolCallId: "t1", status: "failed" });
  });

  // Phase R3.0 — provider errors surfacing through usage_update (we added the
  // errorMessage field in handle-session-event.ts) reset the phase so the chip
  // returns to idle and the abandon-stream flow takes over.
  it("usage_update with errorMessage resets the phase", () => {
    const event = toPhaseEvent({
      type: "usage_update",
      errorMessage: "rate limit exceeded",
    });
    expect(event).toEqual<AgentPhaseEvent>({ type: "reset" });
  });

  it("usage_update without errorMessage is phase-irrelevant (returns null)", () => {
    expect(toPhaseEvent({ type: "usage_update", usage: { totalTokens: 150 } })).toBeNull();
  });
});
