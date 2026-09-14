import { describe, expect, it } from "vitest";
import {
  createExtensionPolicy,
  describeExtensionPolicyReport,
  type ExtensionPolicyDecision,
  type ExtensionPolicyInput,
} from "./extension-policy";

const sampleInput: ExtensionPolicyInput = {
  id: "pi-mcp-adapter",
  packageName: "pi-mcp-adapter",
  builtIn: false,
};

describe("extension-policy (plan4.4 §E — audit trail for pi extension resolution)", () => {
  describe("createExtensionPolicy", () => {
    it("allows built-in extensions by default", () => {
      const policy = createExtensionPolicy();
      const decision = policy.decide({ id: "openbuddy-apply-patch", builtIn: true });
      expect(decision.action).toBe("allow");
      expect(decision.reason).toMatch(/builtin/i);
    });

    it("denies unknown extensions when no allowlist is configured", () => {
      const policy = createExtensionPolicy();
      const decision = policy.decide(sampleInput);
      expect(decision.action).toBe("deny");
      expect(decision.reason).toMatch(/no allowlist|not allowlisted/i);
    });

    it("allows extensions whose package name is in the allowlist", () => {
      const policy = createExtensionPolicy({ allowlistPackageNames: ["pi-mcp-adapter"] });
      const decision = policy.decide(sampleInput);
      expect(decision.action).toBe("allow");
      expect(decision.reason).toMatch(/allowlist/i);
    });

    it("denies extensions whose package name is in the denylist (overrides allowlist)", () => {
      const policy = createExtensionPolicy({
        allowlistPackageNames: ["pi-mcp-adapter"],
        denylistPackageNames: ["pi-mcp-adapter"],
      });
      const decision = policy.decide(sampleInput);
      expect(decision.action).toBe("deny");
      expect(decision.reason).toMatch(/denylist/i);
    });

    it("flags extensions whose id is in needsReview for manual approval", () => {
      const policy = createExtensionPolicy({
        allowlistPackageNames: ["pi-mcp-adapter"],
        needsReviewIds: ["pi-mcp-adapter"],
      });
      const decision = policy.decide(sampleInput);
      expect(decision.action).toBe("needs-review");
      expect(decision.reason).toMatch(/needs.?review|review/i);
    });

    it("flags extensions whose package name is in needsReviewPackageNames", () => {
      const policy = createExtensionPolicy({
        needsReviewPackageNames: ["pi-mcp-adapter"],
      });
      const decision = policy.decide(sampleInput);
      expect(decision.action).toBe("needs-review");
    });

    it("decide() is total — never throws on missing fields", () => {
      const policy = createExtensionPolicy();
      const empty = policy.decide({ id: "x" });
      expect(empty.action).toMatch(/allow|deny|needs-review/);
      const noId = policy.decide({});
      expect(noId.action).toBe("deny");
      expect(noId.reason).toMatch(/missing id/i);
    });

    it("rejects options with invalid shapes (defensive)", () => {
      const policy = createExtensionPolicy({
        allowlistPackageNames: undefined as unknown as readonly string[],
        denylistPackageNames: null as unknown as readonly string[],
        needsReviewIds: "not-an-array" as unknown as readonly string[],
      });
      const decision = policy.decide(sampleInput);
      expect(decision.action).toBe("deny");
    });
  });

  describe("describeExtensionPolicyReport", () => {
    const decisions: Array<{ input: ExtensionPolicyInput; decision: ExtensionPolicyDecision }> = [
      {
        input: { id: "openbuddy-apply-patch", builtIn: true },
        decision: { action: "allow", reason: "OpenBuddy built-in extension" },
      },
      {
        input: { id: "pi-mcp-adapter", packageName: "pi-mcp-adapter" },
        decision: { action: "allow", reason: "package allowlisted" },
      },
      {
        input: { id: "pi-sketchy", packageName: "pi-sketchy" },
        decision: { action: "deny", reason: "package not in allowlist" },
      },
      {
        input: { id: "pi-untested", packageName: "pi-untested" },
        decision: { action: "needs-review", reason: "manual review required" },
      },
    ];

    it("aggregates counts by action", () => {
      const report = describeExtensionPolicyReport(decisions);
      expect(report.total).toBe(4);
      expect(report.allowed).toBe(2);
      expect(report.denied).toBe(1);
      expect(report.needsReview).toBe(1);
    });

    it("returns a frozen report shape (defensive)", () => {
      const report = describeExtensionPolicyReport(decisions);
      expect(Object.isFrozen(report)).toBe(true);
    });

    it("returns zeroes for empty input", () => {
      const report = describeExtensionPolicyReport([]);
      expect(report).toEqual({
        total: 0,
        allowed: 0,
        denied: 0,
        needsReview: 0,
        entries: [],
      });
    });

    it("preserves per-extension entries with id + reason", () => {
      const report = describeExtensionPolicyReport(decisions);
      expect(report.entries).toEqual(decisions);
    });
  });
});