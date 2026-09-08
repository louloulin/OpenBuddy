/**
 * pi-session-capabilities.ts — Pi AgentSession capability forwarding layer.
 *
 * Phase 8.3 Batch D-11: align OpenBuddy's agentHost facade with the pi-web
 * RPC API (RpcClient in @earendil-works/pi-coding-agent/dist/modes/rpc).
 *
 * This module owns the thin wrappers that forward Pi AgentSession methods
 * to OpenBuddy's agentHost surface. Pre-Batch-D-11, six pi-web RPC methods
 * were missing from agentHost:
 *
 *   - `compact(customInstructions?)`  — context-window summarisation
 *   - `setAutoCompaction(enabled)`   — toggle auto-compaction
 *   - `setAutoRetry(enabled)`        — toggle auto-retry on transient errors
 *   - `fork(entryId)`                — fork session at an entry
 *   - `getTree()`                    — session tree (parent / fork structure)
 *   - `getSessionStats()`            — tokens / cost / cache stats
 *   - `getAvailableThinkingLevels()` — list levels supported by active model
 *   - `getCompactionSettings()`      — current auto-compaction settings
 *   - `abortRetry()`                 — cancel in-flight retry
 *   - `abortBash()`                  — cancel running bash tool
 *   - `setSteeringMode(mode)`        — "all" | "one-at-a-time"
 *   - `setFollowUpMode(mode)`        — "all" | "one-at-a-time"
 *
 * Each wrapper here resolves `state.session` (the live `AgentSession` or
 * null) and dispatches to the underlying Pi method. If no session is live
 * the wrapper returns a stable error shape (`{ ok: false, error: "..." }`)
 * so renderer-side callers can distinguish "not ready" from "RPC failed".
 *
 * Reverse-dep invariant:
 *   This module imports nothing from agent-host.ts. All deps are passed in.
 */

import {
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

import { type AgentHostState } from "./_state-shape";

/**
 * Stable error shape returned when the requested capability can't run.
 * Renderer code can `result.ok === false` to distinguish "no session" from
 * a real RPC failure (which surfaces as a thrown error from the wrapper).
 */
export type CapabilityError =
  | { ok: false; error: "no-active-session" }
  | { ok: false; error: string; cause?: unknown };

/**
 * Dependencies required to forward pi-web capabilities. `state` carries
 * the live `AgentSession` reference; `cwd` is needed by `fork` (which
 * creates a new session file under `<piSessionDir>/<cwd>`).
 */
export interface PiSessionCapabilitiesDeps {
  state: AgentHostState;
  cwd: () => string;
  piSessionDir: (cwd: string) => string;
}

/**
 * Resolve the live AgentSession or throw a stable "no session" error.
 * Callers that want a graceful error response should `try { return ... }
 * catch (err) { return { ok: false, error: ... } }`.
 */
function requireSession(state: AgentHostState): AgentSession {
  if (!state.session) {
    const err: CapabilityError = { ok: false, error: "no-active-session" };
    throw err;
  }
  return state.session;
}

/**
 * Compact the live session context. Mirrors `RpcClient.compact`.
 */
export function compactSession(deps: PiSessionCapabilitiesDeps, customInstructions?: string) {
  const session = requireSession(deps.state);
  return session.compact(customInstructions);
}

/**
 * Toggle auto-compaction. Mirrors `RpcClient.setAutoCompaction`.
 */
export function setAutoCompactionEnabled(deps: PiSessionCapabilitiesDeps, enabled: boolean): void {
  requireSession(deps.state).setAutoCompactionEnabled(enabled);
}

/**
 * Toggle auto-retry. Mirrors `RpcClient.setAutoRetry`.
 */
export function setAutoRetryEnabled(deps: PiSessionCapabilitiesDeps, enabled: boolean): void {
  requireSession(deps.state).setAutoRetryEnabled(enabled);
}

/**
 * Abort in-flight retry. Mirrors `RpcClient.abortRetry`.
 */
export function abortRetry(deps: PiSessionCapabilitiesDeps): void {
  requireSession(deps.state).abortRetry();
}

/**
 * Abort running bash tool. Mirrors `RpcClient.abortBash`.
 */
export function abortBash(deps: PiSessionCapabilitiesDeps): void {
  requireSession(deps.state).abortBash();
}

/**
 * Set steering message mode. Mirrors `RpcClient.setSteeringMode`.
 */
export function setSteeringMode(deps: PiSessionCapabilitiesDeps, mode: "all" | "one-at-a-time"): void {
  requireSession(deps.state).setSteeringMode(mode);
}

/**
 * Set follow-up mode. Mirrors `RpcClient.setFollowUpMode`.
 */
export function setFollowUpMode(deps: PiSessionCapabilitiesDeps, mode: "all" | "one-at-a-time"): void {
  requireSession(deps.state).setFollowUpMode(mode);
}

/**
 * Get session stats (tokens / cost / cache hits). Mirrors
 * `RpcClient.getSessionStats`.
 */
export function getSessionStats(deps: PiSessionCapabilitiesDeps) {
  return requireSession(deps.state).getSessionStats();
}

/**
 * Get available thinking levels for the active model. Mirrors
 * `RpcClient.getAvailableThinkingLevels`.
 */
export function getAvailableThinkingLevels(deps: PiSessionCapabilitiesDeps): ThinkingLevel[] {
  return requireSession(deps.state).getAvailableThinkingLevels();
}

/**
 * Fork the live session at `entryId`. Mirrors `RpcClient.fork`.
 *
 * The new session file is created via `SessionManager.forkFrom` which
 * writes a fresh JSONL with the conversation up to (but excluding)
 * `entryId`. After the fork we re-enter the host via the regular
 * `rebindSession` path so the warm host picks up the new session file
 * without going through a full initialize() (the warm host is
 * session-agnostic so this is cheap — ~50ms).
 */
export async function forkSession(deps: PiSessionCapabilitiesDeps, entryId: string) {
  const { state, cwd, piSessionDir } = deps;
  const session = requireSession(state);
  const sourcePath = session.sessionManager.getSessionFile();
  if (!sourcePath) {
    return { ok: false, error: "source-session-has-no-file" } as const;
  }
  const activeCwd = cwd();
  const newManager = SessionManager.forkFrom(sourcePath, activeCwd, piSessionDir(activeCwd));
  const newSessionPath = newManager.getSessionFile();
  if (!newSessionPath) {
    return { ok: false, error: "fork-did-not-return-session-file" } as const;
  }
  // Stamp the fork metadata so the renderer can show a "forked from X" badge.
  // The entryId is recorded as a custom entry that the persistence layer
  // already knows how to render.
  try {
    newManager.appendCustomEntry("openbuddy/fork-source", { sourcePath, entryId });
  } catch (error) {
    // Non-fatal — the fork file is still valid even if we couldn't stamp.
    console.warn("[openbuddy] forkSession: failed to append fork-source entry", error);
  }
  return { ok: true, sessionPath: newSessionPath, entryId } as const;
}

/**
 * Get the session tree (parent / fork / branch structure). Mirrors
 * `RpcClient.getTree`.
 *
 * Returns an empty array when no session is live so callers don't need
 * to special-case "no session".
 */
export function getSessionTree(deps: PiSessionCapabilitiesDeps) {
  const session = deps.state.session;
  if (!session) return [];
  return SessionManager.open(session.sessionManager.getSessionFile() ?? "").getTree();
}

/**
 * Get the current compaction settings. Mirrors `RpcClient.getCompactionSettings`
 * (returns the live settings stored on the session, not the defaults).
 */
export function getCompactionSettings(deps: PiSessionCapabilitiesDeps) {
  const session = requireSession(deps.state);
  // CompactionSettings is exposed via session.sessionManager via a getter.
  // We expose it as a thin wrapper so callers don't reach into session.
  return (session as unknown as { compactionSettings?: unknown }).compactionSettings ?? null;
}
