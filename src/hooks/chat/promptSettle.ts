/**
 * promptSettle.ts — Phase R3.0 (pi-web-alignment).
 *
 * After `agent:prompt` returns success, the user-visible streaming state
 * lags the round-trip by 200-1500 ms (network → IPC → Pi AgentSession →
 * first event). Without a settle guard the UI flickers:
 *   - spinner disappears (we marked streaming=false locally on prompt return)
 *   - reappears a few hundred ms later (first pi://update arrives)
 *
 * The settle guard delays `streaming=false` for up to `PROMPT_SETTLE_MAX_MS`,
 * polling the agent's actual state every `PROMPT_SETTLE_POLL_MS` and exiting
 * early as soon as the agent reports a real streaming event
 * (`agent_start` / `tool_call` / `message_start`).
 *
 * Mirrors pi-web `hooks/useAgentSession.ts:158-160` constants exactly.
 * Single-purpose hook — consumed by `useAgentSession.ts` from the
 * `onComplete` and on-prompt paths.
 */

import { useEffect, useRef } from "react";

export const PROMPT_SETTLE_INITIAL_DELAY_MS = 800;
export const PROMPT_SETTLE_POLL_MS = 600;
export const PROMPT_SETTLE_MAX_MS = 20_000;

export interface PromptSettleOptions {
  /** True while we should be settling (i.e. user just sent a prompt). */
  active: boolean;
  /** Called on each tick to read the canonical agent state. */
  readAgentState: () => { isStreaming?: boolean; isPromptRunning?: boolean; isBashRunning?: boolean };
  /** Called when the settle completes (success or timeout). */
  onComplete: (settled: { reason: "agent-streaming" | "timeout" }) => void;
}

/**
 * usePromptSettle — drives the settle loop. Safe to call from any hook;
 * the timers are cleaned up on unmount or when `active` flips false.
 */
export function usePromptSettle({
  active,
  readAgentState,
  onComplete,
}: PromptSettleOptions): void {
  const onCompleteRef = useRef(onComplete);
  const readAgentStateRef = useRef(readAgentState);
  onCompleteRef.current = onComplete;
  readAgentStateRef.current = readAgentState;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let initialTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const startedAt = Date.now();

    const tick = () => {
      if (cancelled) return;
      const state = readAgentStateRef.current();
      if (state.isStreaming || state.isPromptRunning || state.isBashRunning) {
        onCompleteRef.current({ reason: "agent-streaming" });
        cleanup();
        return;
      }
      if (Date.now() - startedAt >= PROMPT_SETTLE_MAX_MS) {
        onCompleteRef.current({ reason: "timeout" });
        cleanup();
        return;
      }
    };

    const cleanup = () => {
      if (initialTimer) clearTimeout(initialTimer);
      if (pollTimer) clearInterval(pollTimer);
      initialTimer = null;
      pollTimer = null;
    };

    initialTimer = setTimeout(() => {
      // First tick fires after the initial delay; subsequent ticks on the
      // poll interval.
      tick();
      pollTimer = setInterval(tick, PROMPT_SETTLE_POLL_MS);
    }, PROMPT_SETTLE_INITIAL_DELAY_MS);

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [active]);
}