/**
 * AgentPhase — machine-readable lifecycle of an in-flight turn.
 *
 * Why this exists (Phase pi-web-alignment):
 *
 * The renderer used to derive `streaming` from a single boolean — true
 * while any prompt is in flight, false otherwise. That works for the
 * composer lock but says nothing about *what the agent is actually doing
 * right now*: waiting on the model, running a tool, processing bash output,
 * or simply emitting final tokens. pi-web exposes a three-state phase
 * (`waiting_model | running_command | running_tools`) so the UI can
 * surface "running 3 tools" / "awaiting model" badges without reading
 * dozens of fields.
 *
 * This module defines the type + a small reducer that the SSE bridge
 * drives from `agent_start` / `agent_end` / `tool_execution_start` /
 * `tool_execution_update` / `tool_execution_end` events. Consumers read
 * the phase via `useSessionStore.getState().phase` or via the helper
 * selector exported below.
 *
 * Phase changes are intentionally tiny and referentially stable so they
 * never invalidate React.memo siblings.
 */

import type { ToolCallStatus } from "@openbuddy/shared-types";

export type AgentPhase =
  | { kind: "idle" }
  | { kind: "waiting_model" }
  | { kind: "running_command"; command: string }
  | {
      kind: "running_tools";
      tools: Array<{ id: string; name: string; progress?: string }>;
    };

export const IDLE_PHASE: AgentPhase = { kind: "idle" };

/** Reducer for the AgentPhase state. Pure, no side effects, referentially
 *  stable: returning the same object reference when the input doesn't
 *  change lets React.memo skip the consuming component. */
export function phaseReducer(state: AgentPhase, event: AgentPhaseEvent): AgentPhase {
  switch (event.type) {
    case "agent_start":
      return { kind: "waiting_model" };
    case "agent_end":
      return IDLE_PHASE;
    case "tool_start": {
      const tools =
        state.kind === "running_tools"
          ? state.tools.filter((t) => t.id !== event.toolCallId).concat({ id: event.toolCallId, name: event.toolName })
          : [{ id: event.toolCallId, name: event.toolName }];
      return { kind: "running_tools", tools };
    }
    case "tool_update": {
      if (state.kind !== "running_tools") return state;
      const next = state.tools.map((t) =>
        t.id === event.toolCallId ? { ...t, name: event.toolName ?? t.name, progress: event.progress ?? t.progress } : t,
      );
      return { kind: "running_tools", tools: next };
    }
    case "tool_end": {
      if (state.kind !== "running_tools") return state;
      const tools = state.tools.filter((t) => t.id !== event.toolCallId);
      if (tools.length === 0) return { kind: "waiting_model" };
      return { kind: "running_tools", tools };
    }
    case "bash_start":
      return { kind: "running_command", command: event.command };
    case "bash_end":
      return state.kind === "running_command" ? { kind: "waiting_model" } : state;
    case "reset":
      return IDLE_PHASE;
  }
}

export type AgentPhaseEvent =
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "tool_start"; toolCallId: string; toolName: string }
  | { type: "tool_update"; toolCallId: string; toolName?: string; progress?: string }
  | { type: "tool_end"; toolCallId: string; status: ToolCallStatus }
  | { type: "bash_start"; command: string }
  | { type: "bash_end" }
  | { type: "reset" };

/** Human-readable label for badges; small + stable. */
export function phaseLabel(phase: AgentPhase): string {
  switch (phase.kind) {
    case "idle":
      return "空闲";
    case "waiting_model":
      return "等待模型";
    case "running_command":
      return `运行命令: ${truncate(phase.command, 40)}`;
    case "running_tools":
      if (phase.tools.length === 1) return `运行工具: ${phase.tools[0]?.name ?? "?"}`;
      return `运行 ${phase.tools.length} 个工具`;
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
