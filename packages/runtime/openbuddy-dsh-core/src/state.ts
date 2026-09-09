/**
 * @openbuddy/dsh-core/state — Shared DSH goal + message-feedback state machines.
 *
 * Phase B.3 step 2b of docs/OPENBUDDY_PI_NATIVE_PLAN.md (v13 §33.2):
 *   Extracts the goal + message-feedback state machines formerly inlined
 *   in `electron/main/agent/host-modules/bootstrap/wire-dsh-services.ts`
 *   into a standalone module that BOTH the Cordis-bound shim and the
 *   PI-native extensions can consume.
 *
 * Why a shared module (instead of duplicating the state maps)?
 *   The previous design had `wire-dsh-services.ts` own closure-captured
 *   state maps. The PI extensions registered under B.3 step 1/2a would
 *   have owned their own parallel maps, leading to state divergence
 *   between the Cordis `ctx.get("dshRemotes")` API and the PI
 *   `api.registerCommand("goals.*")` API.
 *
 *   By moving the state maps to module-scope constants and exposing
 *   pure helpers (`createGoal`, `transitionGoal`, `putFeedback`, ...),
 *   BOTH surfaces read and write the same data, so a goal created via
 *   `ctx.dshRemotes.goalsCreate(...)` is visible to a subsequent
 *   `pi.registerCommand("goals.get")` invocation.
 *
 * Reverse-dep invariant:
 *   This module imports nothing from electron/main/. All deps are
 *   plain data types. The shared maps live at module scope so every
 *   importer (Cordis shim + PI extension) sees the same data; this is
 *   the entire point of extracting the state machine.
 *
 * Phase B.3 step 3 will switch the keyed maps from `string` keys
 * derived from a runtime carrier to direct session-bound state held by
 * the live ExtensionRunner (see `§33.4`). Until then, the per-session
 * Map<sessionId, …> semantics are preserved.
 */

export interface DshGoalRecord {
  id: string;
  revision: number;
  objective: string;
  phase: "active" | "paused" | "blocked" | "complete";
  roundsStarted: number;
  maxGoalRounds: number;
  activation: "armed" | "disarmed";
  blockedReason?: { code: string; message: string };
}

export interface DshFeedbackEntry {
  rating: string;
  note?: string;
  version: number;
}

/**
 * Per-session goal records. Keyed by session id; one record per session.
 * Mutated in place by `transitionGoal`. Module-scope so both the Cordis
 * shim and PI extensions share the same data.
 */
export const dshGoalState = new Map<string, DshGoalRecord>();

/**
 * Per-session feedback entry maps. Outer key = session id; inner key =
 * message id. Module-scope so both the Cordis shim and PI extensions
 * share the same data.
 */
export const dshFeedbackState = new Map<string, Map<string, DshFeedbackEntry>>();

/**
 * Derive a session-scoped key from a runtime carrier.
 *
 * Accepts: a string session id, `{ id }`, `{ sessionId }`, or anything
 * else (returns the provided fallback).
 */
export function sessionKey(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const v = value as { id?: unknown; sessionId?: unknown };
    if (typeof v.id === "string") return v.id;
    if (typeof v.sessionId === "string") return v.sessionId;
  }
  return fallback;
}

/**
 * Look up the goal for the given carrier. Returns a *copy* so callers
 * that mutate the result don't accidentally mutate the canonical state.
 */
export function getGoal(carrier: unknown, fallback: string): DshGoalRecord | undefined {
  const goal = dshGoalState.get(sessionKey(carrier, fallback));
  return goal ? { ...goal } : undefined;
}

/**
 * Create a new goal for the given carrier. Throws if a non-complete
 * goal already exists for that session. Returns the goal ref.
 */
export function createGoal(
  carrier: unknown,
  fallback: string,
  request: { objective?: string; maxGoalRounds?: number } = {},
): { ref: { id: string; revision: number } } {
  const key = sessionKey(carrier, fallback);
  const current = dshGoalState.get(key);
  if (current && current.phase !== "complete") throw new Error("goal already exists");
  const objective = String(request.objective ?? "").trim();
  if (!objective) throw new Error("goal objective must be non-empty");
  const maxGoalRounds =
    Number.isSafeInteger(request.maxGoalRounds) && (request.maxGoalRounds ?? 0) > 0
      ? (request.maxGoalRounds as number)
      : 3;
  const goal: DshGoalRecord = {
    id: `goal-${Date.now()}`,
    revision: 1,
    objective,
    phase: "active",
    roundsStarted: 0,
    maxGoalRounds,
    activation: "armed",
  };
  dshGoalState.set(key, goal);
  return { ref: { id: goal.id, revision: goal.revision } };
}

/**
 * Edit an existing goal's objective. Throws on revision conflict or
 * empty objective.
 */
export function editGoal(
  carrier: unknown,
  fallback: string,
  ref: { id?: string; revision?: number } | undefined,
  patch: { objective?: string } = {},
): DshGoalRecord {
  const key = sessionKey(carrier, fallback);
  const goal = dshGoalState.get(key);
  if (!goal || goal.id !== ref?.id || goal.revision !== ref?.revision) {
    throw new Error("goal revision conflict");
  }
  if (patch.objective !== undefined) {
    const objective = patch.objective.trim();
    if (!objective) throw new Error("goal objective must be non-empty");
    goal.objective = objective;
  }
  goal.revision += 1;
  return { ...goal };
}

/**
 * Transition a goal to a new phase (active / paused / complete).
 *
 * Throws on revision conflict. Mutates the goal in place AND returns a
 * fresh copy; the copy is what legacy DSH callers (and Phase B.3 step
 * 2c) expect. Blocked-reason cleanup matches the legacy semantics:
 * cleared on non-blocked transitions, preserved on blocked.
 */
export function transitionGoal(
  carrier: unknown,
  fallback: string,
  ref: { id?: string; revision?: number } | undefined,
  phase: DshGoalRecord["phase"],
): DshGoalRecord {
  const key = sessionKey(carrier, fallback);
  const goal = dshGoalState.get(key);
  if (!goal || goal.id !== ref?.id || goal.revision !== ref?.revision) {
    throw new Error("goal revision conflict");
  }
  goal.revision += 1;
  goal.phase = phase;
  goal.activation = phase === "active" ? "armed" : "disarmed";
  if (phase !== "blocked") delete goal.blockedReason;
  return { ...goal };
}

/**
 * Mark a goal as blocked with a structured reason. Mirrors the legacy
 * `goalsBlocked(agent, ref, reason)` semantics: the transition goes
 * through `transitionGoal(..., "blocked")` so the activation flips to
 * disarmed and the revision bumps; then we attach the structured
 * blockedReason on the canonical record so future `getGoal` calls
 * surface it. (Legacy `wire-dsh-services.ts` had a latent bug here:
 * the reason was attached to the returned copy and lost on subsequent
 * reads. B.3 step 2b fixes that.)
 */
export function blockGoal(
  carrier: unknown,
  fallback: string,
  ref: { id?: string; revision?: number } | undefined,
  reason: string,
): DshGoalRecord {
  const key = sessionKey(carrier, fallback);
  const goal = dshGoalState.get(key);
  if (!goal || goal.id !== ref?.id || goal.revision !== ref?.revision) {
    throw new Error("goal revision conflict");
  }
  const next: DshGoalRecord = transitionGoal(carrier, fallback, ref, "blocked");
  // transitionGoal returns a copy; mutate the canonical record so the
  // blocked reason survives subsequent reads.
  goal.blockedReason = { code: "MODEL_REPORTED_BLOCKED", message: String(reason).trim() };
  return next;
}

/**
 * Clear (delete) a goal for the given carrier. Throws on revision
 * conflict. Returns the cleared goal's id and the *new* revision (the
 * would-have-been revision if a new goal was created next).
 */
export function clearGoal(
  carrier: unknown,
  fallback: string,
  ref: { id?: string; revision?: number } | undefined,
): { id: string; revision: number } {
  const key = sessionKey(carrier, fallback);
  const goal = dshGoalState.get(key);
  if (!goal || goal.id !== ref?.id || goal.revision !== ref?.revision) {
    throw new Error("goal revision conflict");
  }
  dshGoalState.delete(key);
  return { id: goal.id, revision: goal.revision + 1 };
}

/**
 * Get (and lazily create) the per-session feedback entries map.
 */
export function entriesFor(carrier: unknown, fallback: string): Map<string, DshFeedbackEntry> {
  const key = sessionKey(carrier, fallback);
  const entries = dshFeedbackState.get(key) ?? new Map<string, DshFeedbackEntry>();
  dshFeedbackState.set(key, entries);
  return entries;
}

/**
 * List feedback entries for the given carrier (or the explicit
 * sessionId in the request).
 */
export function listFeedbackEntries(
  request: { sessionId?: string } = {},
  fallback: string,
): Array<{ messageId: string } & DshFeedbackEntry> {
  const target = request.sessionId ?? fallback;
  const entries = dshFeedbackState.get(target) ?? new Map<string, DshFeedbackEntry>();
  return [...entries.entries()].map(([messageId, value]) => ({ messageId, ...value }));
}

/**
 * Upsert a feedback entry. Performs optimistic concurrency via
 * `ifVersion` and throws on version conflict.
 */
export function putFeedbackEntry(
  request: {
    sessionId?: string;
    messageId: string;
    rating: string;
    note?: string;
    ifVersion?: number | null;
  },
  fallback: string,
): { messageId: string } & DshFeedbackEntry {
  const target = request.sessionId ?? fallback;
  const entries = entriesFor(target, target);
  const previous = entries.get(request.messageId);
  if ((request.ifVersion ?? null) !== (previous?.version ?? null)) {
    throw new Error("feedback version conflict");
  }
  const value: DshFeedbackEntry = {
    rating: request.rating,
    ...(request.note ? { note: request.note } : {}),
    version: (previous?.version ?? 0) + 1,
  };
  entries.set(request.messageId, value);
  return { ...value, messageId: request.messageId };
}

/**
 * Delete a feedback entry. Returns `{ absent: true }` if no entry
 * existed, throws on version conflict.
 */
export function deleteFeedbackEntry(
  request: { sessionId?: string; messageId: string; ifVersion?: number | null },
  fallback: string,
): { absent: boolean } {
  const target = request.sessionId ?? fallback;
  const entries = entriesFor(target, target);
  const previous = entries.get(request.messageId);
  if (!previous) return { absent: true };
  if (request.ifVersion !== previous.version) throw new Error("feedback version conflict");
  entries.delete(request.messageId);
  return { absent: false };
}

/**
 * Test-only: clear both maps. Used by the vitest `beforeEach` hook so
 * state does not leak between cases.
 */
export function __resetDshCoreStateForTests(): void {
  dshGoalState.clear();
  dshFeedbackState.clear();
}

// ─── Cross-session diagnostic helpers (Phase C.2 follow-up) ──────────

/**
 * List all active goals across every session, optionally filtered by
 * phase. Returns a copy so callers cannot mutate the canonical state.
 *
 * Useful for the `/goals.list` slash command — a renderer-side
 * diagnostic that surfaces every in-flight goal at once, not just the
 * one bound to the current session's `sessionFallbackKey`.
 */
export function listAllGoals(
  filter?: { phase?: DshGoalRecord["phase"] },
): Array<{ sessionId: string; goal: DshGoalRecord }> {
  const out: Array<{ sessionId: string; goal: DshGoalRecord }> = [];
  for (const [sessionId, goal] of dshGoalState) {
    if (filter?.phase && goal.phase !== filter.phase) continue;
    out.push({ sessionId, goal: { ...goal } });
  }
  return out;
}

/**
 * Count of sessions that have at least one feedback entry. Useful for
 * the `/feedback.stats` slash command — a renderer-side diagnostic
 * showing how many sessions are using the message-feedback surface.
 */
export function feedbackSessionCount(): number {
  return dshFeedbackState.size;
}

/**
 * Count of total feedback entries across every session. Counts each
 * messageId within each session as one entry.
 */
export function feedbackEntryCount(): number {
  let total = 0;
  for (const entries of dshFeedbackState.values()) total += entries.size;
  return total;
}

/**
 * Search goals by case-insensitive substring match on the objective.
 * Returns goals whose objective contains the query (after trimming).
 * Phase C.3 — useful for renderer-side goal browsers / quick filters
 * without the caller having to walk `listAllGoals()`.
 */
export function searchGoalsByObjective(
  query: string,
  filter?: { phase?: DshGoalRecord["phase"] },
): Array<{ sessionId: string; goal: DshGoalRecord }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const out: Array<{ sessionId: string; goal: DshGoalRecord }> = [];
  for (const [sessionId, goal] of dshGoalState) {
    if (filter?.phase && goal.phase !== filter.phase) continue;
    if (goal.objective.toLowerCase().includes(needle)) {
      out.push({ sessionId, goal: { ...goal } });
    }
  }
  return out;
}

/**
 * Search feedback entries by case-insensitive substring match on
 * either the rating or the note. Returns matching entries across
 * every session. Phase C.3 — pairs with `searchGoalsByObjective` so
 * the renderer can offer a unified cross-session diagnostic search.
 */
export function searchFeedbackEntries(
  query: string,
  options?: { sessionId?: string },
): Array<{ sessionId: string; messageId: string } & DshFeedbackEntry> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const out: Array<{ sessionId: string; messageId: string } & DshFeedbackEntry> = [];
  for (const [sessionId, entries] of dshFeedbackState) {
    if (options?.sessionId && sessionId !== options.sessionId) continue;
    for (const [messageId, entry] of entries) {
      const haystack = `${entry.rating}\n${entry.note ?? ""}`.toLowerCase();
      if (haystack.includes(needle)) {
        out.push({ sessionId, messageId, ...entry });
      }
    }
  }
  return out;
}

/**
 * Per-session aggregate summary. Returns the goal (if any) and the
 * feedback entries (if any) for the given session in a single call.
 * Phase C.3 — the renderer uses this for a per-session diagnostic
 * panel that doesn't need to walk `listAllGoals` + `listFeedbackEntries`
 * separately.
 */
export function sessionSummary(
  carrier: unknown,
  fallback: string,
): {
  sessionId: string;
  goal: DshGoalRecord | undefined;
  feedbackEntries: Array<{ messageId: string } & DshFeedbackEntry>;
} {
  const key = sessionKey(carrier, fallback);
  const goal = dshGoalState.get(key);
  const entries = dshFeedbackState.get(key) ?? new Map<string, DshFeedbackEntry>();
  return {
    sessionId: key,
    goal: goal ? { ...goal } : undefined,
    feedbackEntries: [...entries.entries()].map(([messageId, value]) => ({ messageId, ...value })),
  };
}