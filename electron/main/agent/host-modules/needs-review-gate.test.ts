/**
 * needs-review-gate.test.ts — vitest contract spec for the needs-review
 * approval gate (plan4.5 §B).
 *
 * The gate is a pure state machine that tracks every Pi extension whose
 * policy decision was `needs-review`. While a spec sits in the gate, the
 * resolver must NOT register its factory — the user has to explicitly
 * approve or reject the load.
 *
 * Test scope:
 *   1. Fresh gate has no pending entries.
 *   2. `track()` adds pending entries (idempotent).
 *   3. `gate()` returns `pending` for untracked, `allow` for approved,
 *      `deny` for rejected.
 *   4. `approve()` moves pending → approved (no longer blocks).
 *   5. `reject()` moves pending → rejected (no longer blocks).
 *   6. `approve()` / `reject()` on an unknown id is a no-op (defensive).
 *   7. `subscribe()` fires on every state mutation, with a stable shape.
 *   8. `summarizeNeedsReviewState()` returns a frozen object that lists
 *      pending entries only.
 */
import { describe, expect, it, vi } from "vitest";

import {
  createNeedsReviewGate,
  summarizeNeedsReviewState,
  type NeedsReviewEntry,
} from "./needs-review-gate";

const entry = (overrides: Partial<NeedsReviewEntry> = {}): NeedsReviewEntry => ({
  id: "pi-foo",
  packageName: "pi-foo",
  reason: "package \"pi-foo\" requires manual review",
  requestedAt: "2026-09-13T02:00:00.000Z",
  ...overrides,
});

describe("createNeedsReviewGate (plan4.5 §B — needs-review approval gate)", () => {
  it("starts with an empty snapshot", () => {
    const gate = createNeedsReviewGate();
    const state = gate.snapshot();
    expect(state.pending).toEqual([]);
    expect(state.approvedIds).toEqual([]);
    expect(state.rejectedIds).toEqual([]);
  });

  it("track() adds pending entries and is idempotent", () => {
    const gate = createNeedsReviewGate();
    const first = gate.track(entry({ id: "pi-foo" }));
    expect(first.pending).toHaveLength(1);
    expect(first.pending[0].id).toBe("pi-foo");

    // Re-tracking the same id must not create a duplicate — the
    // original requestedAt is preserved (this is the audit anchor).
    const second = gate.track(entry({ id: "pi-foo", requestedAt: "2026-09-13T03:00:00.000Z" }));
    expect(second.pending).toHaveLength(1);
    expect(second.pending[0].requestedAt).toBe("2026-09-13T02:00:00.000Z");
  });

  it("canonicalizes ids consistently across track, gate, approve, and reject", () => {
    const gate = createNeedsReviewGate();
    gate.track(entry({ id: "  pi-canonical  " }));

    expect(gate.gate({ id: "pi-canonical" })).toBe("pending");
    expect(gate.approve("  pi-canonical  ").approvedIds).toEqual(["pi-canonical"]);
    expect(gate.gate({ id: "pi-canonical" })).toBe("allow");

    gate.track(entry({ id: "pi-reject" }));
    expect(gate.reject("  pi-reject  ").rejectedIds).toEqual(["pi-reject"]);
    expect(gate.gate({ id: "pi-reject" })).toBe("deny");
  });

  it("gate() classifies tracked/approved/rejected/unknown correctly", () => {
    const gate = createNeedsReviewGate();
    gate.track(entry({ id: "pi-pending" }));
    // Track first, then approve/reject — the gate deliberately refuses
    // to lift a never-tracked id into the allow list (defensive against
    // a renderer typo sneaking a forbidden id past the policy).
    gate.track(entry({ id: "pi-approved" }));
    gate.approve("pi-approved");
    gate.track(entry({ id: "pi-rejected" }));
    gate.reject("pi-rejected");

    expect(gate.gate({ id: "pi-pending" })).toBe("pending");
    expect(gate.gate({ id: "pi-approved" })).toBe("allow");
    expect(gate.gate({ id: "pi-rejected" })).toBe("deny");
    // Never seen — gate returns "pending" so the policy report's
    // needs-review classification still surfaces it; the resolver
    // will then call `track()` on the same id to register the block.
    expect(gate.gate({ id: "pi-unknown" })).toBe("pending");
    // Empty / malformed input is treated as deny-by-default (fail-closed).
    expect(gate.gate({ id: "" })).toBe("deny");
  });

  it("approve() moves pending → approved (no longer blocks)", () => {
    const gate = createNeedsReviewGate();
    gate.track(entry({ id: "pi-foo" }));
    expect(gate.gate({ id: "pi-foo" })).toBe("pending");
    gate.approve("pi-foo");
    expect(gate.gate({ id: "pi-foo" })).toBe("allow");
    const snapshot = gate.snapshot();
    expect(snapshot.pending).toEqual([]);
    expect(snapshot.approvedIds).toEqual(["pi-foo"]);
  });

  it("reject() moves pending → rejected (no longer blocks)", () => {
    const gate = createNeedsReviewGate();
    gate.track(entry({ id: "pi-foo" }));
    gate.reject("pi-foo");
    expect(gate.gate({ id: "pi-foo" })).toBe("deny");
    const snapshot = gate.snapshot();
    expect(snapshot.pending).toEqual([]);
    expect(snapshot.rejectedIds).toEqual(["pi-foo"]);
  });

  it("approve() / reject() on an unknown id is a no-op", () => {
    const gate = createNeedsReviewGate();
    // Must not throw, must not emit a snapshot mutation.
    const listener = vi.fn();
    const unlisten = gate.subscribe(listener);
    gate.approve("pi-unknown");
    gate.reject("pi-unknown");
    unlisten();
    expect(listener).not.toHaveBeenCalled();
    expect(gate.snapshot().pending).toEqual([]);
  });

  it("subscribe() fires on every state mutation, with a stable shape", () => {
    const gate = createNeedsReviewGate();
    const listener = vi.fn();
    const unlisten = gate.subscribe(listener);
    gate.track(entry({ id: "pi-foo" }));
    gate.track(entry({ id: "pi-bar" }));
    gate.approve("pi-foo");
    gate.reject("pi-bar");
    unlisten();

    expect(listener).toHaveBeenCalledTimes(4);
    const first = listener.mock.calls[0][0];
    expect(first.pending).toHaveLength(1);
    expect(first.pending[0].id).toBe("pi-foo");
    const last = listener.mock.calls[3][0];
    expect(last.pending).toEqual([]);
    expect(last.approvedIds).toEqual(["pi-foo"]);
    expect(last.rejectedIds).toEqual(["pi-bar"]);
  });

  it("summarizeNeedsReviewState() returns a frozen projection with pending only", () => {
    const gate = createNeedsReviewGate();
    gate.track(entry({ id: "pi-foo" }));
    gate.track(entry({ id: "pi-bar" }));
    gate.approve("pi-foo");
    const summary = summarizeNeedsReviewState(gate.snapshot());
    expect(Object.isFrozen(summary)).toBe(true);
    expect(summary.pending.map((e) => e.id)).toEqual(["pi-bar"]);
    expect(summary.pendingCount).toBe(1);
    expect(summary.approvedCount).toBe(1);
    expect(summary.rejectedCount).toBe(0);
  });
});
