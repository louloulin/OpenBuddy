/**
 * useAgentPhase — derive the machine-readable AgentPhase from pi
 * events. Extracted from `useAgentSession` so the chat-window component
 * can subscribe to phase changes via a tiny selector.
 *
 * The phase state already lives on `useSessionStore.phase` (driven by
 * `applyPhaseEvent`). This hook is the bridge-side dispatcher that
 * maps each `pi://update` event variant to the right phase event.
 */

import { useSessionStore } from "@/stores/session-store";
import type { AgentPhaseEvent } from "@/lib/stream/agent-phase";

/** Map a session-update variant to a phase event. Returns null when the
 *  event is not phase-relevant (most `agent_message_chunk` and
 *  `agent_thought_chunk` deltas). */
export function toPhaseEvent(
  update: { type?: string } & Record<string, unknown>,
): AgentPhaseEvent | null {
  const type = update.type;
  switch (type) {
    case "agent_start":
      return { type: "agent_start" };
    case "agent_end":
      return { type: "agent_end" };
    case "tool_call":
      return {
        type: "tool_start",
        toolCallId: String((update as { toolCallId?: unknown }).toolCallId ?? ""),
        toolName: String((update as { title?: unknown }).title ?? "tool"),
      };
    case "tool_call_update": {
      // Phase R3.0 — A `tool_call_update` may carry:
      //   1. partial progress streaming → `tool_update` (keeps the row alive)
      //   2. terminal status (completed/failed) → `tool_end` (removes from
      //      running_tools so the chip can transition back to waiting_model)
      // Phase R2 had only path (1), which meant `running_tools` accumulated
      // every tool across the session and never went back to waiting_model
      // until `agent_end` — the user saw "运行 12 个工具" forever.
      const statusRaw = (update as { status?: unknown }).status;
      const toolCallId = String((update as { toolCallId?: unknown }).toolCallId ?? "");
      if (statusRaw === "completed" || statusRaw === "failed") {
        return {
          type: "tool_end",
          toolCallId,
          status: statusRaw === "failed" ? "failed" : "completed",
        };
      }
      // Always emit tool_update on tool_call_update — even when progress is
      // absent or non-string — so the existing R2 test contract is honored
      // and the running_tools row stays consistent across all updates.
      const progressRaw = (update as { update?: { progress?: unknown } }).update?.progress;
      return {
        type: "tool_update",
        toolCallId,
        progress: typeof progressRaw === "string" ? progressRaw : undefined,
      };
    }
    case "tool_call_end":
      return {
        type: "tool_end",
        toolCallId: String((update as { toolCallId?: unknown }).toolCallId ?? ""),
        status: "completed",
      };
    case "bash_start":
      return {
        type: "bash_start",
        command: String((update as { command?: unknown }).command ?? ""),
      };
    case "bash_end":
      return { type: "bash_end" };
    // Phase R3.0 — usage_update with errorMessage signals a provider failure.
    // We surface it as a phase reset so the chip returns to idle and the
    // abandon-stream flow takes over (see useAgentSession.ts usage_update branch).
    case "usage_update": {
      const errMsg = (update as { errorMessage?: unknown }).errorMessage;
      if (typeof errMsg === "string" && errMsg.length > 0) {
        return { type: "reset" };
      }
      return null;
    }
    default:
      return null;
  }
}

/** Dispatch a single phase event to the store. Convenience wrapper used
 *  by both the bridge hook and tests. */
export function dispatchPhaseEvent(event: AgentPhaseEvent): void {
  useSessionStore.getState().applyPhaseEvent(event);
}
