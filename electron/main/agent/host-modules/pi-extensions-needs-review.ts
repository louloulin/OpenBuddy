/**
 * pi-extensions-needs-review.ts — wires the `NeedsReviewGate` into
 * `resolvePiExtensions` (plan4.5 §B).
 *
 * ## Why this lives in its own module
 *
 * `resolvePiExtensions` is already a ~100-line function that walks
 * every spec, applies the adapter / builtin / source-path fallback,
 * and emits the consolidated policy report. Adding gate plumbing
 * inline would inflate it past the readability cliff, and the gate
 * would become entangled with Cordis service registration.
 *
 * Instead, the resolver still produces a `PiExtensionResolution` plus
 * a `decisions` list; this helper post-processes the resolution to:
 *
 *   1. Drop the factory for any needs-review spec the gate says is
 *      `pending` (the user has not signed off yet), and push a
 *      `{ state: "blocked", error }` diagnostic so the audit panel
 *      can surface "X is awaiting your approval".
 *   2. Drop the factory for any needs-review spec the gate says is
 *      `deny` (the user rejected), and push a `{ state: "denied" }`
 *      diagnostic so the audit panel can show "X was denied".
 *   3. Track every pending entry so the next resolve (after a
 *      profile reload) starts from the right state.
 *   4. Emit `pi/extension-needs-review-pending` once per call with
 *      the frozen summary so the renderer can pop the modal.
 *
 * The function is pure in the sense that it never reaches into
 * Electron / Cordis — `emit` is the only side-effect channel. The
 * caller (the agent-host) owns the gate singleton.
 */

import type { PiExtensionResolution } from "../pi-extensions";
import type { ExtensionPolicyDecision, ExtensionPolicyInput } from "./extension-policy";
import {
  type NeedsReviewEntry,
  type NeedsReviewGate,
  type NeedsReviewGateSnapshot,
  summarizeNeedsReviewState,
} from "./needs-review-gate";

export type NeedsReviewEmitFn = (type: "pi/extension-needs-review-pending", payload: NeedsReviewPendingPayload) => void;

export interface NeedsReviewPendingPayload {
  generatedAt: string;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  pending: NeedsReviewEntry[];
}

/**
 * Resolve the gate verdict for a single needs-review spec. Extracted
 * so the test can exercise the decision logic without a `gate`
 * dependency injected.
 */
function resolveVerdict(input: ExtensionPolicyInput, gate: NeedsReviewGate): "allow" | "deny" | "pending" {
  // Always go through `gate.gate()` — it returns "deny" for malformed
  // ids, "allow" for approved, "deny" for rejected, "pending" for
  // tracked-but-undecided AND for never-tracked ids.
  return gate.gate({ id: input.id });
}

function pushBlockedDiagnostic(
  resolution: PiExtensionResolution,
  specId: string,
  reason: string,
  state: "blocked" | "denied",
): void {
  resolution.diagnostics.push({ id: specId, state: state === "blocked" ? "disabled" : "failed", error: reason });
}

function dropFactory(resolution: PiExtensionResolution, specId: string): void {
  const index = resolution.factories.findIndex((entry) => entry.name === specId);
  if (index >= 0) resolution.factories.splice(index, 1);
}

/**
 * Post-process the resolver's output through the gate.
 *
 * Returns the (possibly mutated) resolution and a snapshot of the
 * gate state. The caller is expected to broadcast the snapshot via
 * `emit` so the renderer can update its modal.
 */
export function applyNeedsReviewGate(
  resolution: PiExtensionResolution,
  decisions: ReadonlyArray<{ input: ExtensionPolicyInput; decision: ExtensionPolicyDecision }> | null | undefined,
  gate: NeedsReviewGate,
  emit: NeedsReviewEmitFn,
): PiExtensionResolution {
  if (Array.isArray(decisions)) {
    for (const { input, decision } of decisions) {
      if (!input || typeof input.id !== "string" || input.id.length === 0) continue;
      if (decision?.action !== "needs-review") continue;

      const verdict = resolveVerdict(input, gate);

      if (verdict === "pending") {
        // Register the entry first so a fresh profile reload can keep
        // tracking the same id until the user approves / rejects.
        gate.track({
          id: input.id,
          ...(typeof input.packageName === "string" ? { packageName: input.packageName } : {}),
          reason: decision.reason,
          requestedAt: new Date().toISOString(),
        });
        dropFactory(resolution, input.id);
        pushBlockedDiagnostic(resolution, input.id, decision.reason, "blocked");
        continue;
      }

      if (verdict === "deny") {
        dropFactory(resolution, input.id);
        pushBlockedDiagnostic(resolution, input.id, decision.reason, "denied");
        continue;
      }

      // verdict === "allow" — leave the factory in place. The gate
      // already lifted the spec during the previous resolve; nothing
      // to do here. We still want a clean re-track so a renderer
      // re-mount doesn't lose the audit history.
    }
  }

  const snapshot: NeedsReviewGateSnapshot = gate.snapshot();
  const summary = summarizeNeedsReviewState(snapshot);
  const payload: NeedsReviewPendingPayload = Object.freeze({
    generatedAt: new Date().toISOString(),
    pendingCount: summary.pendingCount,
    approvedCount: summary.approvedCount,
    rejectedCount: summary.rejectedCount,
    pending: summary.pending,
  });
  emit("pi/extension-needs-review-pending", payload);
  return resolution;
}
