/**
 * needs-review-gate.ts — pure approval gate for `needs-review` policy
 * decisions (plan4.5 §B).
 *
 * ## Why this module exists
 *
 * `extension-policy.ts` already classifies every Pi extension candidate
 * as `allow` | `deny` | `needs-review`. The audit panel in
 * `src/components/ExtensionAuditPanel.tsx` already paints the
 * `needs-review` count in amber so the user can see it. But the
 * classification is purely informational — `resolvePiExtensions` still
 * registers the extension's factory if the adapter branch matches, and
 * there is no path for the user to actually block the load.
 *
 * This module factors the blocking behaviour into a single pure state
 * machine so:
 *
 *   1. `resolvePiExtensions` can ask `gate.gate(spec)` per spec and
 *      drop blocked factories into `diagnostics` instead of
 *      `factories`.
 *   2. The renderer can list pending entries (via IPC) and call
 *      `approve(id)` / `reject(id)` to release or hard-deny them.
 *   3. Subscribers receive a snapshot mutation on every transition so
 *      the main process can re-broadcast
 *      `pi/extension-needs-review-pending` after an approve/reject.
 *
 * Pure: no IPC, no Electron deps, no side effects on import. The state
 * lives inside the closure returned by `createNeedsReviewGate()`; the
 * `electron/main/agent/host-modules/agent-host.ts` module owns the
 * singleton instance.
 */

export interface NeedsReviewEntry {
  /** Pi extension id (e.g. `pi-mcp-adapter`). */
  id: string;
  /** npm package name when the spec came from a third-party package. */
  packageName?: string;
  /** Rationale from the policy decision (e.g. `id "pi-foo" requires manual review`). */
  reason: string;
  /** ISO-8601 timestamp when the entry was first registered. */
  requestedAt: string;
}

export type NeedsReviewGateVerdict = "allow" | "deny" | "pending";

export interface NeedsReviewGateSnapshot {
  pending: NeedsReviewEntry[];
  approvedIds: string[];
  rejectedIds: string[];
}

export type NeedsReviewGateListener = (snapshot: NeedsReviewGateSnapshot) => void;

export interface NeedsReviewGate {
  /** Read-only view of the current gate state. */
  snapshot(): NeedsReviewGateSnapshot;
  /**
   * Classify a spec by id. Returns `pending` for untracked ids so a
   * never-seen-before needs-review spec is treated as blocked until
   * the resolver calls `track()` to register it. Empty / malformed
   * input returns `deny` (fail-closed).
   */
  gate(input: { id?: unknown }): NeedsReviewGateVerdict;
  /**
   * Register a pending entry. Idempotent — re-tracking the same id
   * preserves the original `requestedAt` so the audit trail keeps its
   * first-seen timestamp.
   */
  track(entry: NeedsReviewEntry): NeedsReviewGateSnapshot;
  /** Approve a pending id (moves to approved; future `gate()` calls return `allow`). No-op on unknown ids. */
  approve(id: string): NeedsReviewGateSnapshot;
  /** Reject a pending id (moves to rejected; future `gate()` calls return `deny`). No-op on unknown ids. */
  reject(id: string): NeedsReviewGateSnapshot;
  /** Subscribe to snapshot mutations. Returns an unsubscribe function. */
  subscribe(listener: NeedsReviewGateListener): () => void;
}

export function createNeedsReviewGate(): NeedsReviewGate {
  const pending = new Map<string, NeedsReviewEntry>();
  const approved = new Set<string>();
  const rejected = new Set<string>();
  const listeners = new Set<NeedsReviewGateListener>();

  const normalizeId = (value: unknown): string =>
    typeof value === "string" ? value.trim() : "";

  const currentSnapshot = (): NeedsReviewGateSnapshot => ({
    pending: [...pending.values()],
    approvedIds: [...approved],
    rejectedIds: [...rejected],
  });

  const emit = (): NeedsReviewGateSnapshot => {
    const snapshot = currentSnapshot();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn("[openbuddy] needs-review gate listener failed", error);
      }
    }
    return snapshot;
  };

  return {
    snapshot() {
      return currentSnapshot();
    },
    gate(input) {
      const id = normalizeId(input?.id);
      if (id.length === 0) return "deny";
      if (approved.has(id)) return "allow";
      if (rejected.has(id)) return "deny";
      // Both pending entries AND never-seen ids classify as `pending`
      // so the resolver knows to register a pending entry before
      // deciding whether to register the factory.
      return "pending";
    },
    track(entry) {
      const id = normalizeId(entry?.id);
      if (id.length === 0) return currentSnapshot();
      if (!pending.has(id) && !approved.has(id) && !rejected.has(id)) {
        pending.set(id, { ...entry, id });
      }
      return emit();
    },
    approve(id) {
      const normalizedId = normalizeId(id);
      if (normalizedId.length === 0) return currentSnapshot();
      if (!pending.has(normalizedId)) {
        // Defensive: approve/reject on an unknown id is a no-op so a
        // misbehaving renderer cannot accidentally lift a never-tracked
        // spec into the allow list.
        return {
          pending: [...pending.values()],
          approvedIds: [...approved],
          rejectedIds: [...rejected],
        };
      }
      pending.delete(normalizedId);
      approved.add(normalizedId);
      rejected.delete(normalizedId);
      return emit();
    },
    reject(id) {
      const normalizedId = normalizeId(id);
      if (normalizedId.length === 0) return currentSnapshot();
      if (!pending.has(normalizedId)) {
        return {
          pending: [...pending.values()],
          approvedIds: [...approved],
          rejectedIds: [...rejected],
        };
      }
      pending.delete(normalizedId);
      rejected.add(normalizedId);
      approved.delete(normalizedId);
      return emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface NeedsReviewStateSummary {
  pending: NeedsReviewEntry[];
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
}

/**
 * Render-friendly projection of the gate snapshot — pending entries
 * only, plus counters so a renderer can render summary tiles without
 * re-counting. The returned object is frozen so consumers can't mutate
 * it after passing it into React state.
 */
export function summarizeNeedsReviewState(snapshot: NeedsReviewGateSnapshot): NeedsReviewStateSummary {
  return Object.freeze({
    pending: snapshot.pending.map((entry) => Object.freeze({ ...entry })),
    pendingCount: snapshot.pending.length,
    approvedCount: snapshot.approvedIds.length,
    rejectedCount: snapshot.rejectedIds.length,
  });
}
