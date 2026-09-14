/**
 * needs-review-singleton.ts — process-wide singleton wrapper around
 * `createNeedsReviewGate()` (plan4.5 §B).
 *
 * ## Why this lives in its own module
 *
 * The gate is a stateful object whose state must survive between
 * successive `configurePiExtensions()` calls (otherwise an
 * approve/reject would be lost on the next profile reload). The
 * agent-host module owns the instance and exposes a tiny facade
 * here so:
 *
 *   - `electron/main/ipc/plugin.ts` can call `getNeedsReviewGate()` to
 *     read/mutate the gate from `extension:approve-needs-review` /
 *     `extension:reject-needs-review` handlers.
 *   - `host-modules/pi-extension-configure.ts` can pass the same
 *     instance to `resolvePiExtensions` via `needsReviewGate` so the
 *     resolver blocks the right factories.
 *
 * Pure install pattern (matches `plugin-event-bus.ts`,
 * `pi-extension-configure.ts`) — the module-level variable starts as
 * a fresh gate and gets replaced by `installNeedsReviewGate()` once
 * the host has a profile to derive `needsReviewIds` from.
 */
import { createNeedsReviewGate, type NeedsReviewGate } from "./needs-review-gate";

let gate: NeedsReviewGate = createNeedsReviewGate();

/** Replace the singleton. Called once from agent-host:initialize(). */
export function installNeedsReviewGate(instance: NeedsReviewGate = createNeedsReviewGate()): void {
  gate = instance;
}

/** Read-only access for callers that must not mutate the gate. */
export function getNeedsReviewGate(): NeedsReviewGate {
  return gate;
}

/**
 * Test-only escape hatch: discard the singleton so the next call to
 * `getNeedsReviewGate()` returns a fresh gate. Mirrors the
 * `__reset*` helpers in the other install-pattern modules.
 */
export function __resetNeedsReviewGateForTest(): void {
  gate = createNeedsReviewGate();
}
