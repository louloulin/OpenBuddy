/**
 * pi-extensions-needs-review.test.ts — integration spec for the
 * `resolvePiExtensions` ↔ `NeedsReviewGate` wiring (plan4.5 §B).
 *
 * The helper `applyNeedsReviewGate(resolution, decisions, gate, emit)`
 * is the bridge between the existing audit-only `policy.decide(...)`
 * path and the actual blocking behaviour. After the audit decides,
 * the helper walks each `needs-review` decision and:
 *
 *   - `pending` → remove the factory from `factories`, push a
 *     `{ state: "blocked" }` diagnostic, track the entry in the gate.
 *   - `allow` → keep the factory, mark the spec approved (no-op if
 *     the spec wasn't tracked — defensive).
 *   - `deny` → remove the factory, push a `{ state: "denied" }`
 *     diagnostic.
 *
 * It also emits `pi/extension-needs-review-pending` with the summary
 * so the renderer can pop the approval modal.
 */
import { describe, expect, it, vi } from "vitest";

import { createNeedsReviewGate } from "./needs-review-gate";
import { applyNeedsReviewGate } from "./pi-extensions-needs-review";
import type { PiExtensionResolution } from "../pi-extensions";
import type { ExtensionPolicyInput, ExtensionPolicyDecision } from "./extension-policy";

interface Fixtures {
  resolution: PiExtensionResolution;
  decisions: Array<{ input: ExtensionPolicyInput; decision: ExtensionPolicyDecision }>;
}

function buildFixtures(specs: Array<{ id: string; action: ExtensionPolicyDecision["action"]; reason: string }>): Fixtures {
  const resolution: PiExtensionResolution = {
    factories: [],
    paths: [],
    resolved: [],
    diagnostics: [],
  };
  const decisions: Fixtures["decisions"] = [];
  for (const spec of specs) {
    resolution.factories.push({ name: spec.id, factory: () => undefined as never, hidden: true });
    resolution.resolved.push({ id: spec.id, source: `<inline:${spec.id}>`, builtIn: false });
    decisions.push({
      input: { id: spec.id, packageName: `pkg-${spec.id}`, builtIn: false },
      decision: { action: spec.action, reason: spec.reason },
    });
  }
  return { resolution, decisions };
}

describe("applyNeedsReviewGate (plan4.5 §B — resolver ↔ gate wiring)", () => {
  it("keeps every factory when no decision is needs-review", () => {
    const fixtures = buildFixtures([
      { id: "pi-allow", action: "allow", reason: "allowlisted" },
      { id: "pi-deny", action: "deny", reason: "denylisted" },
    ]);
    const gate = createNeedsReviewGate();
    const emit = vi.fn();

    applyNeedsReviewGate(fixtures.resolution, fixtures.decisions, gate, emit);

    expect(fixtures.resolution.factories.map((f) => f.name)).toEqual(["pi-allow", "pi-deny"]);
    expect(fixtures.resolution.diagnostics).toEqual([]);
    // We still emit the pending summary even when there are zero
    // needs-review specs so the renderer can confirm "no pending"
    // and close any open approval modal.
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      "pi/extension-needs-review-pending",
      expect.objectContaining({ pendingCount: 0, approvedCount: 0, rejectedCount: 0, pending: [] }),
    );
  });

  it("blocks a needs-review spec and pushes a 'blocked' diagnostic", () => {
    const fixtures = buildFixtures([
      { id: "pi-allow", action: "allow", reason: "allowlisted" },
      { id: "pi-flagged", action: "needs-review", reason: "requires manual review" },
    ]);
    const gate = createNeedsReviewGate();
    const emit = vi.fn();

    applyNeedsReviewGate(fixtures.resolution, fixtures.decisions, gate, emit);

    expect(fixtures.resolution.factories.map((f) => f.name)).toEqual(["pi-allow"]);
    expect(fixtures.resolution.diagnostics).toEqual([
      { id: "pi-flagged", state: "blocked", error: "requires manual review" },
    ]);
    expect(gate.snapshot().pending.map((e) => e.id)).toEqual(["pi-flagged"]);
    // pending summary was emitted.
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      "pi/extension-needs-review-pending",
      expect.objectContaining({
        generatedAt: expect.any(String),
        pendingCount: 1,
        approvedCount: 0,
        rejectedCount: 0,
        pending: [
          expect.objectContaining({ id: "pi-flagged", packageName: "pkg-pi-flagged" }),
        ],
      }),
    );
  });

  it("'allow' verdict keeps the factory and lifts the gate", () => {
    const fixtures = buildFixtures([
      { id: "pi-flagged", action: "needs-review", reason: "requires manual review" },
    ]);
    const gate = createNeedsReviewGate();
    const emit = vi.fn();

    // Pre-track + approve so the gate returns "allow" for this spec.
    gate.track({
      id: "pi-flagged",
      packageName: "pkg-pi-flagged",
      reason: "requires manual review",
      requestedAt: "2026-09-13T00:00:00.000Z",
    });
    gate.approve("pi-flagged");

    applyNeedsReviewGate(fixtures.resolution, fixtures.decisions, gate, emit);

    expect(fixtures.resolution.factories.map((f) => f.name)).toEqual(["pi-flagged"]);
    expect(fixtures.resolution.diagnostics).toEqual([]);
    expect(gate.snapshot().approvedIds).toEqual(["pi-flagged"]);
    expect(gate.snapshot().pending).toEqual([]);
  });

  it("'deny' verdict removes the factory and pushes a 'denied' diagnostic", () => {
    const fixtures = buildFixtures([
      { id: "pi-flagged", action: "needs-review", reason: "requires manual review" },
    ]);
    const gate = createNeedsReviewGate();
    const emit = vi.fn();

    gate.track({
      id: "pi-flagged",
      packageName: "pkg-pi-flagged",
      reason: "requires manual review",
      requestedAt: "2026-09-13T00:00:00.000Z",
    });
    gate.reject("pi-flagged");

    applyNeedsReviewGate(fixtures.resolution, fixtures.decisions, gate, emit);

    expect(fixtures.resolution.factories).toEqual([]);
    expect(fixtures.resolution.diagnostics).toEqual([
      { id: "pi-flagged", state: "denied", error: "requires manual review" },
    ]);
  });

  it("handles multiple needs-review specs in one resolve", () => {
    const fixtures = buildFixtures([
      { id: "pi-allow", action: "allow", reason: "allowlisted" },
      { id: "pi-flag-a", action: "needs-review", reason: "review-a" },
      { id: "pi-flag-b", action: "needs-review", reason: "review-b" },
    ]);
    const gate = createNeedsReviewGate();
    // Pre-approve pi-flag-b so the resolver lifts it.
    gate.track({ id: "pi-flag-b", packageName: "pkg-pi-flag-b", reason: "review-b", requestedAt: "2026-09-13T00:00:00.000Z" });
    gate.approve("pi-flag-b");
    const emit = vi.fn();

    applyNeedsReviewGate(fixtures.resolution, fixtures.decisions, gate, emit);

    expect(fixtures.resolution.factories.map((f) => f.name).sort()).toEqual(["pi-allow", "pi-flag-b"]);
    expect(fixtures.resolution.diagnostics).toEqual([
      { id: "pi-flag-a", state: "blocked", error: "review-a" },
    ]);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][1].pendingCount).toBe(1);
    expect(emit.mock.calls[0][1].pending[0].id).toBe("pi-flag-a");
  });

  it("ignores specs without an id and survives a null decisions list (defensive)", () => {
    const resolution: PiExtensionResolution = {
      factories: [{ name: "pi-keep", factory: () => undefined as never, hidden: true }],
      paths: [],
      resolved: [],
      diagnostics: [],
    };
    const gate = createNeedsReviewGate();
    const emit = vi.fn();
    // No throw on a malformed decisions array.
    applyNeedsReviewGate(resolution, null as unknown as Fixtures["decisions"], gate, emit);
    expect(resolution.factories).toHaveLength(1);
    // Null decisions: still emit the empty summary so renderer state
    // is honest.
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      "pi/extension-needs-review-pending",
      expect.objectContaining({ pendingCount: 0, approvedCount: 0, rejectedCount: 0 }),
    );
  });
});
