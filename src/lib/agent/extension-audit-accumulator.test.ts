import { describe, expect, it } from "vitest";
import {
  createExtensionAuditAccumulator,
  type ExtensionAuditPluginEvent,
} from "./extension-audit-accumulator";

describe("extension-audit-accumulator (plan4.5 §A — pure subscriber for pi/extension-policy-report)", () => {
  describe("handle()", () => {
    it("accepts a well-formed pi/extension-policy-report payload", () => {
      const acc = createExtensionAuditAccumulator();
      const event: ExtensionAuditPluginEvent = {
        type: "pi/extension-policy-report",
        timestamp: "2026-09-13T02:00:00.000Z",
        payload: {
          generatedAt: "2026-09-13T02:00:00.000Z",
          total: 2,
          allowed: 1,
          denied: 1,
          needsReview: 0,
          decisions: [
            {
              id: "openbuddy-apply-patch",
              builtIn: true,
              action: "allow",
              reason: "OpenBuddy builtin extension",
            },
            {
              id: "pi-sketchy",
              packageName: "pi-sketchy",
              builtIn: false,
              action: "deny",
              reason: "extension is not allowlisted",
            },
          ],
        },
      };
      expect(acc.handle(event)).toBe(true);
      expect(acc.snapshot()).toHaveLength(1);
      expect(acc.summary().totalAllowed).toBe(1);
      expect(acc.summary().totalDenied).toBe(1);
      expect(acc.summary().latest).toBe("2026-09-13T02:00:00.000Z");
    });

    it("ignores events with a different type (defensive)", () => {
      const acc = createExtensionAuditAccumulator();
      expect(
        acc.handle({
          type: "session/input-truncated",
          payload: { sessionId: "x", dropped: 0, totalChars: 0, budget: { maxChars: 1, keepFirst: 0, keepLast: 0 } },
        }),
      ).toBe(false);
      expect(acc.snapshot()).toHaveLength(0);
    });

    it("ignores malformed payloads (defensive)", () => {
      const acc = createExtensionAuditAccumulator();
      expect(acc.handle({ type: "pi/extension-policy-report", payload: null })).toBe(false);
      expect(acc.handle({ type: "pi/extension-policy-report", payload: {} })).toBe(false);
      expect(acc.handle(null as unknown as ExtensionAuditPluginEvent)).toBe(false);
      expect(acc.snapshot()).toHaveLength(0);
    });
  });

  describe("snapshot()", () => {
    it("returns a defensive copy (caller mutation doesn't poison the log)", () => {
      const acc = createExtensionAuditAccumulator();
      acc.handle({
        type: "pi/extension-policy-report",
        payload: {
          generatedAt: "2026-09-13T02:00:00.000Z",
          total: 0,
          allowed: 0,
          denied: 0,
          needsReview: 0,
          decisions: [],
        },
      });
      const snap = acc.snapshot();
      snap.length = 0;
      expect(acc.snapshot()).toHaveLength(1);
    });
  });

  describe("subscribe()", () => {
    it("notifies listeners on parsed events", () => {
      const acc = createExtensionAuditAccumulator();
      const calls: number[] = [];
      const unlisten = acc.subscribe(() => calls.push(Date.now()));
      acc.handle({
        type: "pi/extension-policy-report",
        payload: {
          generatedAt: "2026-09-13T02:00:00.000Z",
          total: 0,
          allowed: 0,
          denied: 0,
          needsReview: 0,
          decisions: [],
        },
      });
      acc.handle({
        type: "session/input-truncated",
        payload: {},
      });
      expect(calls).toHaveLength(1);
      unlisten();
      acc.handle({
        type: "pi/extension-policy-report",
        payload: {
          generatedAt: "2026-09-13T02:00:01.000Z",
          total: 0,
          allowed: 0,
          denied: 0,
          needsReview: 0,
          decisions: [],
        },
      });
      expect(calls).toHaveLength(1);
    });

    it("swallows listener exceptions (defensive)", () => {
      const acc = createExtensionAuditAccumulator();
      acc.subscribe(() => {
        throw new Error("boom");
      });
      expect(() =>
        acc.handle({
          type: "pi/extension-policy-report",
          payload: {
            generatedAt: "2026-09-13T02:00:00.000Z",
            total: 0,
            allowed: 0,
            denied: 0,
            needsReview: 0,
            decisions: [],
          },
        }),
      ).not.toThrow();
    });
  });

  describe("clear()", () => {
    it("resets the log and summary", () => {
      const acc = createExtensionAuditAccumulator();
      acc.handle({
        type: "pi/extension-policy-report",
        payload: {
          generatedAt: "2026-09-13T02:00:00.000Z",
          total: 1,
          allowed: 1,
          denied: 0,
          needsReview: 0,
          decisions: [
            { id: "x", action: "allow", reason: "ok" },
          ],
        },
      });
      acc.clear();
      expect(acc.snapshot()).toHaveLength(0);
      expect(acc.summary().latest).toBeNull();
    });
  });
});
