import { describe, expect, it } from "vitest";
import {
  parseExtensionAuditReport,
  isExtensionAuditReport,
  summarizeExtensionAuditReports,
  type ExtensionAuditDecision,
  type ExtensionAuditReport,
} from "./extension-audit-event-parser";

const sampleDecision: ExtensionAuditDecision = {
  id: "openbuddy-apply-patch",
  packageName: undefined,
  builtIn: true,
  action: "allow",
  reason: "OpenBuddy builtin extension",
};

const sampleReport: ExtensionAuditReport = {
  generatedAt: "2026-09-13T02:00:00.000Z",
  total: 3,
  allowed: 2,
  denied: 1,
  needsReview: 0,
  decisions: [
    sampleDecision,
    {
      id: "pi-mcp-adapter",
      packageName: "pi-mcp-adapter",
      builtIn: false,
      action: "allow",
      reason: 'package "pi-mcp-adapter" is allowlisted',
    },
    {
      id: "pi-sketchy",
      packageName: "pi-sketchy",
      builtIn: false,
      action: "deny",
      reason: "extension is not allowlisted",
    },
  ],
};

describe("extension-audit-event-parser (plan4.5 §A — renderer subscription for pi/extension-policy-report)", () => {
  describe("isExtensionAuditReport", () => {
    it("accepts a well-formed payload", () => {
      expect(isExtensionAuditReport(sampleReport)).toBe(true);
    });

    it("rejects payloads missing required top-level fields", () => {
      expect(isExtensionAuditReport(null)).toBe(false);
      expect(isExtensionAuditReport(undefined)).toBe(false);
      expect(isExtensionAuditReport({})).toBe(false);
      expect(isExtensionAuditReport({ generatedAt: "x", total: 1, allowed: 1, denied: 0, needsReview: 0 })).toBe(false);
    });

    it("rejects payloads with wrong field types", () => {
      expect(
        isExtensionAuditReport({
          generatedAt: 1,
          total: 1,
          allowed: 1,
          denied: 0,
          needsReview: 0,
          decisions: [],
        }),
      ).toBe(false);
      expect(
        isExtensionAuditReport({
          generatedAt: "2026-09-13T02:00:00.000Z",
          total: "1",
          allowed: 1,
          denied: 0,
          needsReview: 0,
          decisions: [],
        }),
      ).toBe(false);
      expect(
        isExtensionAuditReport({
          generatedAt: "2026-09-13T02:00:00.000Z",
          total: 1,
          allowed: 1,
          denied: 0,
          needsReview: 0,
          decisions: "nope",
        }),
      ).toBe(false);
    });

    it("rejects decisions with invalid action literals", () => {
      expect(
        isExtensionAuditReport({
          ...sampleReport,
          decisions: [{ id: "x", action: "banana", reason: "nope" }],
        }),
      ).toBe(false);
    });
  });

  describe("parseExtensionAuditReport", () => {
    it("returns a normalised ExtensionAuditReport for a valid payload", () => {
      const parsed = parseExtensionAuditReport(sampleReport);
      expect(parsed).toEqual(sampleReport);
    });

    it("returns null for malformed payloads (defensive)", () => {
      expect(parseExtensionAuditReport(null)).toBeNull();
      expect(parseExtensionAuditReport({})).toBeNull();
      expect(
        parseExtensionAuditReport({ ...sampleReport, total: -1 }),
      ).toBeNull();
      expect(
        parseExtensionAuditReport({
          ...sampleReport,
          allowed: sampleReport.allowed + sampleReport.denied + sampleReport.needsReview + 1,
        }),
      ).toBeNull();
    });

    it("accepts an empty decisions array (zero-state report)", () => {
      const parsed = parseExtensionAuditReport({
        generatedAt: "2026-09-13T02:00:00.000Z",
        total: 0,
        allowed: 0,
        denied: 0,
        needsReview: 0,
        decisions: [],
      });
      expect(parsed).toEqual({
        generatedAt: "2026-09-13T02:00:00.000Z",
        total: 0,
        allowed: 0,
        denied: 0,
        needsReview: 0,
        decisions: [],
      });
    });

    it("skips malformed decisions but keeps well-formed ones", () => {
      const parsed = parseExtensionAuditReport({
        ...sampleReport,
        decisions: [
          sampleDecision,
          { id: "x" }, // missing action/reason
          {
            id: "pi-other",
            packageName: "pi-other",
            builtIn: false,
            action: "needs-review",
            reason: "manual review required",
          },
        ],
      });
      expect(parsed).not.toBeNull();
      expect(parsed!.decisions).toHaveLength(2);
      expect(parsed!.decisions[0]).toEqual(sampleDecision);
      expect(parsed!.decisions[1].action).toBe("needs-review");
    });
  });

  describe("summarizeExtensionAuditReports", () => {
    it("aggregates counts across multiple reports (latest report wins)", () => {
      const older: ExtensionAuditReport = {
        ...sampleReport,
        total: 3,
        allowed: 2,
        denied: 1,
        needsReview: 0,
      };
      const newer: ExtensionAuditReport = {
        ...sampleReport,
        total: 5,
        allowed: 4,
        denied: 0,
        needsReview: 1,
        generatedAt: "2026-09-13T02:30:00.000Z",
      };
      const summary = summarizeExtensionAuditReports([older, newer]);
      // The renderer surfaces the LATEST report (a re-resolve supersedes),
      // so we expect newest counters + decisions.length.
      expect(summary.latest).toBe(newer.generatedAt);
      expect(summary.reports).toBe(2);
      expect(summary.totalAllowed).toBe(4);
      expect(summary.totalDenied).toBe(0);
      expect(summary.totalNeedsReview).toBe(1);
      expect(summary.lastDecisionCount).toBe(5);
    });

    it("returns a zero-state summary for an empty list", () => {
      const summary = summarizeExtensionAuditReports([]);
      expect(summary).toEqual({
        latest: null,
        reports: 0,
        totalAllowed: 0,
        totalDenied: 0,
        totalNeedsReview: 0,
        lastDecisionCount: 0,
      });
    });

    it("ignores malformed reports silently (defensive)", () => {
      const summary = summarizeExtensionAuditReports([
        null as unknown as ExtensionAuditReport,
        sampleReport,
      ]);
      expect(summary.reports).toBe(1);
      expect(summary.totalAllowed).toBe(2);
    });
  });
});
