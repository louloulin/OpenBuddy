/**
 * abandon-stream.ts — single shared cleanup for every error / cancel path
 * that leaves the renderer with a half-streamed assistant message.
 *
 * Why this exists:
 *   Five places can fire `pi://*` events that should finalise the
 *   in-flight chat turn, and historically NONE of them called
 *   `setStreaming(false)` + `finishStreamingMessage()` + the session-status
 *   upsert together. The user-visible symptom is the "等待模型响应" row
 *   that never resolves — the screenshot showed a session stuck for 8+
 *   hours even though the backend had long since returned a final answer
 *   (events.jsonl confirmed `agent_end` fired at 23:15:27, but the
 *   renderer never cleared the orphan bubble because the streaming
 *   state machine had drifted between the streaming-id pointer and the
 *   message mirror).
 *
 * Contract:
 *   - Idempotent. Safe to call from any handler even if the streaming
 *     flag is already false and the message is already complete.
 *   - Does NOT log to console — the call sites already log via
 *     `reportEvent` / `appLogger.warn`, this layer just converges state.
 *
 * Caller map (after this lands):
 *   - pi://turn-error             → useAgentSession.ts:onTurnError
 *   - pi://agent-died             → App.tsx:handleAgentDied
 *   - 60s streaming watchdog      → main.tsx:fireWatchdog
 *   - user cancel                 → App.tsx:handleCancel
 *   - session switch race         → useAgentSession.ts:onComplete (early-return branch)
 */
import { useSessionStore } from "@/stores/session-store";
import { useSessionsStore } from "@/stores/sessions-store";

export interface AbandonInFlightStreamOptions {
  /** Session the failed/cancelled turn belongs to. */
  sessionId: string;
  /** Short human-readable reason used as the placeholder text when the
   *  assistant bubble had no streamed content yet. */
  reason: string;
  /** Final session status to write. Default "failed" (most callers are
   *  error paths); user-cancel uses "completed" because cancel is a
   *  user-initiated normal termination, not a backend failure. */
  status?: "failed" | "completed";
}

/**
 * Force-finalise the currently-streaming assistant message and clear the
 * streaming flag. Used by every error / cancel path; safe to call when
 * no streaming is in flight (idempotent no-op).
 *
 * @example
 *   abandonInFlightStream({ sessionId, reason: "turn-error: rate_limit" });
 */
export function abandonInFlightStream(
  opts: AbandonInFlightStreamOptions,
): void {
  const { sessionId, reason, status = "failed" } = opts;
  const session = useSessionStore.getState();

  // If the focus has already moved to a different session, only clean up
  // the global streaming flag — touching `sessionsStore` for an unfocused
  // id risks overwriting a fresher row.
  const focusedHere =
    !session.sessionId || !sessionId || session.sessionId === sessionId;
  if (focusedHere) {
    session.abandonStreamingMessage(reason);
    session.setStreaming(false);
  }

  useSessionsStore.getState().upsert({ sessionId, status });
}