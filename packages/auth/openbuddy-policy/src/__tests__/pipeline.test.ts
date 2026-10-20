/**
 * pipeline.test.ts — AuthorizationPipeline 单元测试
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthorizationPipeline } from "../pipeline";
import type {
  AuthorizationDecision,
  AuthorizationEvaluator,
  AuthorizationRequest,
  AuditWriter,
} from "../types";

// ---- helpers ---------------------------------------------------------------

function makeEvaluator(
  name: "pi" | "casdoor" | "folder_trust" | "plugin_capability" | "default",
  priority: number,
  outcome: (req: AuthorizationRequest) => AuthorizationDecision | null | Promise<AuthorizationDecision | null>,
): AuthorizationEvaluator {
  return {
    name,
    priority,
    matches: () => true,
    evaluate: (req) => Promise.resolve(outcome(req)),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("AuthorizationPipeline — basic flow", () => {
  it("returns first non-null decision in priority order", async () => {
    const pipeline = new AuthorizationPipeline()
      .addEvaluator(makeEvaluator("casdoor", 50, () => ({
        allowed: false, reason: "casdoor denied", code: "CASDOOR_PERMISSION_DENIED", source: "casdoor",
      })))
      .addEvaluator(makeEvaluator("pi", 100, () => ({
        allowed: true, reason: "pi allowed", code: "PI_ALLOW_RULE", source: "pi", matchedRule: "bash(git *)",
      })));

    const decision = await pipeline.decide({
      subject: "user-1", action: "bash.run", resource: "bash",
      context: { tool: "bash", pattern: "git status" },
    });

    expect(decision).toMatchObject({
      allowed: true, code: "PI_ALLOW_RULE", source: "pi", matchedRule: "bash(git *)",
    });
  });

  it("falls through to next evaluator when first returns null", async () => {
    const pipeline = new AuthorizationPipeline()
      .addEvaluator(makeEvaluator("pi", 100, () => null))
      .addEvaluator(makeEvaluator("casdoor", 50, () => ({
        allowed: false, reason: "casdoor denied", code: "CASDOOR_SIGNED_OUT", source: "casdoor",
      })));

    const decision = await pipeline.decide({
      subject: "u", action: "a", resource: "r", context: { tool: "bash" },
    });
    expect(decision).toMatchObject({ allowed: false, source: "casdoor" });
  });

  it("respects priority ordering (higher first)", async () => {
    const seen: string[] = [];
    const pipeline = new AuthorizationPipeline()
      .addEvaluator(makeEvaluator("casdoor", 50, () => {
        seen.push("casdoor");
        return null;
      }))
      .addEvaluator(makeEvaluator("pi", 100, () => {
        seen.push("pi");
        return null;
      }))
      .addEvaluator(makeEvaluator("folder_trust", 10, () => {
        seen.push("folder_trust");
        return null;
      }));

    await pipeline.decide({ subject: "u", action: "a", resource: "r", context: { tool: "bash" } });

    expect(seen).toEqual(["pi", "casdoor", "folder_trust"]);
  });
});

describe("AuthorizationPipeline — default policy", () => {
  it("returns DEFAULT_DENY when no evaluator matches (default policy)", async () => {
    const pipeline = new AuthorizationPipeline()
      .addEvaluator(makeEvaluator("pi", 100, () => null));

    const decision = await pipeline.decide({
      subject: "u", action: "a", resource: "r", context: { tool: "bash" },
    });

    expect(decision).toMatchObject({
      allowed: false, code: "DEFAULT_DENY", source: "default",
    });
    expect(decision.reason).toContain("default deny");
  });

  it("returns DEFAULT_ALLOW when no evaluator matches and default policy is allow", async () => {
    const pipeline = new AuthorizationPipeline()
      .setDefaultPolicy("allow")
      .addEvaluator(makeEvaluator("pi", 100, () => null));

    const decision = await pipeline.decide({
      subject: "u", action: "a", resource: "r", context: { tool: "bash" },
    });

    expect(decision).toMatchObject({
      allowed: true, code: "DEFAULT_ALLOW", source: "default",
    });
  });
});

describe("AuthorizationPipeline — evaluator isolation", () => {
  it("evaluator throwing does not stop pipeline", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pipeline = new AuthorizationPipeline()
      .addEvaluator(makeEvaluator("pi", 100, () => {
        throw new Error("boom");
      }))
      .addEvaluator(makeEvaluator("casdoor", 50, () => ({
        allowed: true, reason: "ok", code: "CASDOOR_AUTHORIZED", source: "casdoor",
      })));

    const decision = await pipeline.decide({
      subject: "u", action: "a", resource: "r", context: { tool: "bash" },
    });

    expect(decision.source).toBe("casdoor");
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('evaluator "pi" threw'),
      expect.any(String),
    );
  });

  it("evaluator.matches() short-circuits non-applicable requests", async () => {
    let piCalled = false;
    const piEvaluator: AuthorizationEvaluator = {
      name: "pi", priority: 100,
      matches: () => false,
      evaluate: () => {
        piCalled = true;
        return Promise.resolve(null);
      },
    };
    const pipeline = new AuthorizationPipeline()
      .addEvaluator(piEvaluator)
      .addEvaluator(makeEvaluator("casdoor", 50, () => ({
        allowed: true, reason: "ok", code: "CASDOOR_AUTHORIZED", source: "casdoor",
      })));

    const decision = await pipeline.decide({
      subject: "u", action: "a", resource: "r", context: { tool: "bash" },
    });

    expect(piCalled).toBe(false);
    expect(decision.source).toBe("casdoor");
  });
});

describe("AuthorizationPipeline — audit integration", () => {
  it("calls audit writer with decision details", async () => {
    const auditAppend = vi.fn().mockResolvedValue(undefined);
    const pipeline = new AuthorizationPipeline()
      .setAuditWriter({ append: auditAppend })
      .addEvaluator(makeEvaluator("pi", 100, () => ({
        allowed: true, reason: "ok", code: "PI_ALLOW_RULE", source: "pi", matchedRule: "bash(git *)",
      })));

    await pipeline.decide({
      subject: "user-1", action: "bash.run", resource: "bash",
      context: { tool: "bash", pattern: "git *" },
    });

    // audit is async (fire-and-forget); wait a tick
    await new Promise((r) => setTimeout(r, 10));

    expect(auditAppend).toHaveBeenCalledWith({
      action: "bash.run",
      resource: "bash",
      allowed: true,
      code: "PI_ALLOW_RULE",
      source: "pi",
      subject: "user-1",
      matchedRule: "bash(git *)",
      reason: "ok",
    });
  });

  it("audit writer failure does not block decision", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const auditAppend = vi.fn().mockRejectedValue(new Error("audit down"));
    const pipeline = new AuthorizationPipeline()
      .setAuditWriter({ append: auditAppend })
      .addEvaluator(makeEvaluator("pi", 100, () => ({
        allowed: true, reason: "ok", code: "PI_ALLOW_RULE", source: "pi",
      })));

    const decision = await pipeline.decide({
      subject: "u", action: "a", resource: "r", context: { tool: "bash" },
    });

    expect(decision.allowed).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(consoleWarn).toHaveBeenCalledWith(
      "[auth-policy] audit writer failed:",
      "audit down",
    );
  });
});

describe("AuthorizationPipeline — registry management", () => {
  it("addEvaluator sorts by priority desc", () => {
    const pipeline = new AuthorizationPipeline()
      .addEvaluator(makeEvaluator("folder_trust", 10, () => null))
      .addEvaluator(makeEvaluator("pi", 100, () => null))
      .addEvaluator(makeEvaluator("casdoor", 50, () => null));

    expect(pipeline.listEvaluators()).toEqual([
      { name: "pi", priority: 100 },
      { name: "casdoor", priority: 50 },
      { name: "folder_trust", priority: 10 },
    ]);
  });

  it("removeEvaluator filters by name", () => {
    const pipeline = new AuthorizationPipeline()
      .addEvaluator(makeEvaluator("pi", 100, () => null))
      .addEvaluator(makeEvaluator("casdoor", 50, () => null));

    pipeline.removeEvaluator("pi");

    expect(pipeline.listEvaluators()).toEqual([{ name: "casdoor", priority: 50 }]);
  });
});

describe("AuthorizationPipeline — duration tracking", () => {
  it("records durationMs even for fast decisions", async () => {
    const pipeline = new AuthorizationPipeline()
      .addEvaluator(makeEvaluator("pi", 100, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return {
          allowed: true, reason: "ok", code: "PI_ALLOW_RULE", source: "pi",
        };
      }));

    const decision = await pipeline.decide({
      subject: "u", action: "a", resource: "r", context: { tool: "bash" },
    });

    expect(decision.durationMs).toBeGreaterThanOrEqual(0);
    expect(decision.durationMs).toBeLessThan(100);
  });
});
