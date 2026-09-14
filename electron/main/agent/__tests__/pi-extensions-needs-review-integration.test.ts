/**
 * pi-extensions.test.ts — Round 17 integration spec for the
 * `needsReviewGate` option on `resolvePiExtensions`.
 *
 * The resolver already emits a `pi/extension-policy-report` per
 * resolve (Round 10 / plan4.4 §E). Round 17 wires the
 * `NeedsReviewGate` so that any needs-review spec the gate says is
 * `pending` is removed from `factories` and pushed into `diagnostics`
 * with `state: "blocked"`. When the gate lifts it (approve), the
 * factory stays.
 *
 * These tests pin down the contract at the resolver level so a
 * future refactor cannot silently regress to the audit-only
 * behaviour.
 */
import { describe, expect, it, vi } from "vitest";

import { resolvePiExtensions } from "../pi-extensions";
import { createNeedsReviewGate } from "../host-modules/needs-review-gate";

describe("resolvePiExtensions (plan4.5 §B — needs-review gate integration)", () => {
  function makeNeedsReviewGate() {
    const gate = createNeedsReviewGate();
    return gate;
  }

  it("keeps the audit report + adds the gate pending summary when a gate is provided", () => {
    const gate = makeNeedsReviewGate();
    const emit = vi.fn();
    // Specs that the policy classifies as needs-review need ids in
    // the gate's needsReviewIds set. Built-ins always classify as
    // allow, so to exercise the gate we use a passthrough adapter
    // package name plus a non-built-in source path. The simplest
    // path: feed a package that the resolver will emit as
    // needs-review via the extension-policy default — any third-
    // party source not in the allowlist.
    resolvePiExtensions(
      [{ id: "external-extension", source: "external-extension", config: {} }],
      {
        profileDir: "/tmp/profile",
        resolveSource: () => "/tmp/profile/node_modules/external-extension/index.js",
        emit,
        needsReviewGate: gate,
        needsReviewIds: ["external-extension"],
      },
    );
    const policy = emit.mock.calls.find(([type]) => type === "pi/extension-policy-report");
    expect(policy, "expected policy report event").toBeDefined();
    const pending = emit.mock.calls.find(([type]) => type === "pi/extension-needs-review-pending");
    expect(pending, "expected pending summary event").toBeDefined();
  });

  it("removes a pending factory from the resolution and pushes a 'blocked' diagnostic", () => {
    const gate = makeNeedsReviewGate();
    const emit = vi.fn();
    // We use a built-in id so the resolver pushes a real factory
    // entry; `needsReviewIds` then reclassifies it as needs-review,
    // and the gate (pending verdict) drops the factory.
    const result = resolvePiExtensions(
      [{ id: "openbuddy-pi-observability", config: { toolEvents: false } }],
      {
        profileDir: "/tmp/profile",
        resolveSource: () => "/tmp/profile/node_modules/never/index.js",
        emit,
        needsReviewGate: gate,
        needsReviewIds: ["openbuddy-pi-observability"],
      },
    );
    // The factory must NOT be registered — pending gate keeps it blocked.
    expect(result.factories.find((f) => f.name === "openbuddy-pi-observability")).toBeUndefined();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ id: "openbuddy-pi-observability", state: "blocked" }),
    ]);
  });

  it("lifts the factory once the gate says 'allow' (approve then re-resolve)", () => {
    const gate = makeNeedsReviewGate();
    const emit = vi.fn();
    // Track + approve so the gate returns 'allow' on the next resolve.
    gate.track({
      id: "openbuddy-pi-observability",
      packageName: "@openbuddy/builtin-pi-observability",
      reason: "requires manual review",
      requestedAt: "2026-09-13T00:00:00.000Z",
    });
    gate.approve("openbuddy-pi-observability");
    const result = resolvePiExtensions(
      [{ id: "openbuddy-pi-observability", config: { toolEvents: false } }],
      {
        profileDir: "/tmp/profile",
        resolveSource: () => "/tmp/profile/node_modules/never/index.js",
        emit,
        needsReviewGate: gate,
        needsReviewIds: ["openbuddy-pi-observability"],
      },
    );
    expect(result.factories.map((f) => f.name)).toEqual(["openbuddy-pi-observability"]);
    expect(result.diagnostics).toEqual([]);
  });

  it("omits the pending summary when no gate is provided (legacy audit-only)", () => {
    // No gate → resolver still emits the audit report, but the new
    // pending summary event must NOT be emitted (so a renderer
    // without the modal wiring does not see ghost events).
    const emit = vi.fn();
    resolvePiExtensions(
      [{ id: "external-extension", source: "external-extension", config: {} }],
      {
        profileDir: "/tmp/profile",
        resolveSource: () => "/tmp/profile/node_modules/external-extension/index.js",
        emit,
      },
    );
    const pending = emit.mock.calls.find(([type]) => type === "pi/extension-needs-review-pending");
    expect(pending, "expected no pending summary without a gate").toBeUndefined();
  });
});
