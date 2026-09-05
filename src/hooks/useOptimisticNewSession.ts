/**
 * useOptimisticNewSession — extract the "pending-id → real-id" plumbing out
 * of App.tsx so the optimistic-UI dance lives in one cohesive place.
 *
 * ## Why a hook (and not a plain class / module singleton)?
 *
 * The pending state is per-React-tree. Putting it on a `useRef` keeps it
 * stable across re-renders (unlike `useState`) and survives React
 * StrictMode's double-effect-invocation (unlike module-level state). This
 * is the same pattern pi-web's `useAgentSession` uses for its in-flight
 * promise ref (`hooks/useAgentSession.ts:346`).
 *
 * ## What it owns
 *
 * - **`pendingNewSessionRef`** — the in-flight fan-out record. When a second
 *   `ensureNewSession` arrives before the first settles, it appends to the
 *   existing record's resolvers list and shares the same backend IPC
 *   round-trip. Every caller gets the same `realId`.
 * - **`draftKeyAliasesRef`** — provisional key → real id. Used by the
 *   downstream `migrateSession` calls (test-pinned in
 *   `src/stores/__tests__/sessions-store.test.ts:107–158`) to atomically
 *   rekey the draft text and the sidebar row. Exposed so the orchestrator
 *   layer (Phase 2's `newSessionFlow`) can ask "what's the real id for the
 *   pending I just minted?" without poking at the ref directly.
 * - **synchronous `setCurrent(pendingId)` + `setSession(pendingId)`** —
 *   the flip that lets `App.tsx`'s conditional render mount `<ChatView/>`
 *   *before* the IPC returns. Without this the user keeps staring at the
 *   HomePage composer even though we already pushed the optimistic user
 *   bubble + streaming flag.
 *
 * ## What it does NOT own
 *
 * - `pushOptimisticUser` / `setStreaming` / `upsert({sessionId: pendingId, ...})`
 *   — those are caller-side responsibilities (the orchestrator composes the
 *   full set of optimistic mutations).
 * - `migrateSession` after the real id lands — also caller-side.
 * - rollback on error — caller-side (`popOptimistic` + `setSession(null)` + `remove(pendingId)`).
 *   The hook only rejects the in-flight promise; it does NOT mutate the
 *   stores on its own.
 */
import { useCallback, useRef } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { piNewSession } from "@/lib/agent/pi-client";

type Resolver = {
  resolve: (id: string) => void;
  reject: (e: unknown) => void;
};

interface PendingRecord {
  /** Discriminator for the supersede-guard — the most recent pendingId wins. */
  nonce: string;
  pendingId: string;
  resolvers: Resolver[];
  promise: Promise<string>;
}

/**
 * Pluggable backend factory. Defaults to `piNewSession`. Tests can inject
 * a stub to avoid the IPC round-trip and exercise fan-out semantics
 * deterministically.
 */
export type EnsureNewSessionFactory = (
  cwd: string,
  modelId?: string,
) => Promise<string>;

export interface OptimisticNewSessionApi {
  /**
   * Mint a `__pending_<timestamp>_<6-digit-random>` id, flip both stores
   * synchronously, and return the pending id + a Promise that resolves to
   * the real session id when the backend settles.
   *
   * Concurrent callers share the in-flight Promise (fan-out via the
   * resolvers list) — they all get the same real id. The backend is
   * also server-side coalesced (Phase 0: `agentHost.ensureNewSession`),
   * so two parallel IPCs from this hook collapse to one pipeline run.
   */
  ensureNewSession: (cwd: string, modelId?: string) => {
    pendingId: string;
    promise: Promise<string>;
  };

  /**
   * Wait for an in-flight pending new-session to settle, if any. Returns
   * `null` when there is no pending record. Used by the orchestrator
   * (Phase 2) to recover the real id when the supersede path triggers
   * (first caller's promise resolves to a *later* pending id).
   */
  awaitPendingNewSession: () => Promise<string | null>;

  /**
   * Resolve a provisional key (e.g. a draft sentinel or a pending id) to
   * its corresponding real id. Returns the input unchanged if there is no
   * alias recorded for it. This is the read-only window into
   * `draftKeyAliasesRef` for the orchestrator's `migrateSession` step.
   */
  resolveAlias: (key: string) => string;

  /**
   * Record a provisional → real id alias. Called by the orchestrator once
   * the backend has returned the real id, so subsequent reads from
   * `resolveAlias` and downstream migration see the real id.
   */
  recordAlias: (provisionalKey: string, realId: string) => void;

  /** True while a pending session is in flight (any caller). */
  hasPending: () => boolean;
}

export function useOptimisticNewSession(
  factory: EnsureNewSessionFactory = piNewSession,
): OptimisticNewSessionApi {
  const pendingNewSessionRef = useRef<PendingRecord | null>(null);
  const draftKeyAliasesRef = useRef<Map<string, string>>(new Map());

  const ensureNewSession = useCallback(
    (cwd: string, modelId?: string) => {
      const pendingId = `__pending_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const existing = pendingNewSessionRef.current;

      // Flip both stores to the pending id NOW so App's conditional render
      // (`placeholderView ? PlaceholderPage : currentSessionId ? ChatView :
      // HomePage`) leaves HomePage and mounts ChatView before the IPC returns.
      // Without this the user keeps seeing HomePage even though we have
      // already pushed the optimistic user bubble + streaming flag.
      useSessionsStore.getState().setCurrent(pendingId);
      useSessionStore.getState().setSession(pendingId);

      if (existing) {
        // Piggy-back on the in-flight IPC. Append a new resolver so the
        // promise we hand back resolves when the IPC settles, alongside
        // any earlier waiters. Note we OVERWRITE `existing.pendingId` —
        // the supersede-guard in the caller will re-await the new
        // in-flight record to avoid an orphan placeholder.
        const promise = new Promise<string>((resolve, reject) => {
          existing.resolvers.push({ resolve, reject });
        });
        existing.pendingId = pendingId;
        return { pendingId, promise };
      }

      const resolvers: Resolver[] = [];
      const promise = new Promise<string>((resolve, reject) => {
        resolvers.push({ resolve, reject });
      });
      const record: PendingRecord = {
        nonce: pendingId,
        pendingId,
        resolvers,
        promise,
      };
      pendingNewSessionRef.current = record;
      void factory(cwd, modelId)
        .then((realId) => {
          const current = pendingNewSessionRef.current;
          pendingNewSessionRef.current = null;
          // Fan-out to every waiter, then clear the list so a late
          // supersede doesn't re-resolve a settled promise.
          if (current) {
            const waiters = current.resolvers.splice(0);
            for (const r of waiters) r.resolve(realId);
          }
        })
        .catch((e) => {
          const current = pendingNewSessionRef.current;
          pendingNewSessionRef.current = null;
          if (current) {
            const waiters = current.resolvers.splice(0);
            for (const r of waiters) r.reject(e);
          }
        });
      return { pendingId, promise };
    },
    [factory],
  );

  const awaitPendingNewSession = useCallback(async (): Promise<string | null> => {
    const record = pendingNewSessionRef.current;
    if (!record) return null;
    try {
      return await record.promise;
    } catch {
      return null;
    }
  }, []);

  const resolveAlias = useCallback((key: string) => {
    return draftKeyAliasesRef.current.get(key) ?? key;
  }, []);

  const recordAlias = useCallback((provisionalKey: string, realId: string) => {
    draftKeyAliasesRef.current.set(provisionalKey, realId);
  }, []);

  const hasPending = useCallback(() => {
    return pendingNewSessionRef.current !== null;
  }, []);

  return {
    ensureNewSession,
    awaitPendingNewSession,
    resolveAlias,
    recordAlias,
    hasPending,
  };
}