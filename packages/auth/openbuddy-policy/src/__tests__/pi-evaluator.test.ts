/**
 * pi-evaluator.test.ts — PiPermissionEvaluator 单元测试
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { PiPermissionEvaluator } from "../evaluators/pi-evaluator";

beforeEach(() => vi.restoreAllMocks());

describe("PiPermissionEvaluator — matches()", () => {
  it("matches when context.tool is present", () => {
    const e = new PiPermissionEvaluator({ rules: [] });
    expect(e.matches({ subject: "u", action: "bash.run", resource: "bash", context: { tool: "bash" } })).toBe(true);
  });

  it("does not match when context.tool is missing", () => {
    const e = new PiPermissionEvaluator({ rules: [] });
    expect(e.matches({ subject: "u", action: "a", resource: "r" })).toBe(false);
    expect(e.matches({ subject: "u", action: "a", resource: "r", context: {} })).toBe(false);
  });

  it("does not match when context.tool is empty string", () => {
    const e = new PiPermissionEvaluator({ rules: [] });
    expect(e.matches({ subject: "u", action: "a", resource: "r", context: { tool: "" } })).toBe(false);
  });
});

describe("PiPermissionEvaluator — evaluate (synchronous, rules-based)", () => {
  it("returns PI_DENY_RULE when a deny rule matches", async () => {
    const e = new PiPermissionEvaluator({
      rules: [{ action: "deny", tool: "bash", pattern: "rm *" }],
    });

    const result = await e.evaluate({
      subject: "u", action: "bash.run", resource: "bash",
      context: { tool: "bash", pattern: "rm -rf /" },
    });

    expect(result).toMatchObject({
      allowed: false,
      code: "PI_DENY_RULE",
      source: "pi",
      matchedRule: "bash(rm -rf /)",
    });
  });

  it("returns PI_ALLOW_RULE when an allow rule matches", async () => {
    const e = new PiPermissionEvaluator({
      rules: [{ action: "allow", tool: "bash", pattern: "git *" }],
    });

    const result = await e.evaluate({
      subject: "u", action: "bash.run", resource: "bash",
      context: { tool: "bash", pattern: "git status" },
    });

    expect(result).toMatchObject({
      allowed: true,
      code: "PI_ALLOW_RULE",
      source: "pi",
      matchedRule: "bash(git status)",
    });
  });

  it("returns PI_ASK_RULE with allowed=false when an ask rule matches", async () => {
    const e = new PiPermissionEvaluator({
      rules: [{ action: "ask", tool: "bash" }],
    });

    const result = await e.evaluate({
      subject: "u", action: "bash.run", resource: "bash",
      context: { tool: "bash", pattern: "ls" },
    });

    expect(result).toMatchObject({
      allowed: false,
      code: "PI_ASK_RULE",
      source: "pi",
      matchedRule: "bash(ls)",
    });
  });

  it("returns null when no rule matches", async () => {
    const e = new PiPermissionEvaluator({ rules: [] });

    const result = await e.evaluate({
      subject: "u", action: "bash.run", resource: "bash",
      context: { tool: "bash", pattern: "echo hi" },
    });

    expect(result).toBeNull();
  });

  it("deny > ask > allow precedence", async () => {
    const e = new PiPermissionEvaluator({
      rules: [
        { action: "allow", tool: "bash", pattern: "*" },
        { action: "ask", tool: "bash", pattern: "rm *" },
        { action: "deny", tool: "bash", pattern: "rm -rf *" },
      ],
    });

    const result = await e.evaluate({
      subject: "u", action: "bash.run", resource: "bash",
      context: { tool: "bash", pattern: "rm -rf /" },
    });

    expect(result?.code).toBe("PI_DENY_RULE");
  });
});

describe("PiPermissionEvaluator — evaluateViaBridge (P2.1 host-core path)", () => {
  it("uses bridge evaluate when provided", async () => {
    const evaluateViaBridge = vi.fn().mockResolvedValue("deny" as const);
    const e = new PiPermissionEvaluator({ rules: [], evaluateViaBridge });

    const result = await e.evaluate({
      subject: "u", action: "bash.run", resource: "bash",
      context: { tool: "bash", pattern: "rm -rf /" },
    });

    expect(evaluateViaBridge).toHaveBeenCalledWith("bash", "rm -rf /");
    expect(result?.code).toBe("PI_DENY_RULE");
  });

  it("bridge returns undefined → falls back to null", async () => {
    const evaluateViaBridge = vi.fn().mockResolvedValue(undefined);
    const e = new PiPermissionEvaluator({ rules: [], evaluateViaBridge });

    const result = await e.evaluate({
      subject: "u", action: "bash.run", resource: "bash",
      context: { tool: "bash" },
    });

    expect(result).toBeNull();
  });

  it("bridge returns allow → PI_ALLOW_RULE", async () => {
    const evaluateViaBridge = vi.fn().mockResolvedValue("allow" as const);
    const e = new PiPermissionEvaluator({ rules: [], evaluateViaBridge });

    const result = await e.evaluate({
      subject: "u", action: "a", resource: "r", context: { tool: "bash" },
    });

    expect(result?.code).toBe("PI_ALLOW_RULE");
    expect(result?.allowed).toBe(true);
  });
});

describe("PiPermissionEvaluator — properties", () => {
  it("name is 'pi'", () => {
    const e = new PiPermissionEvaluator({ rules: [] });
    expect(e.name).toBe("pi");
  });

  it("priority is 100 (first-class)", () => {
    const e = new PiPermissionEvaluator({ rules: [] });
    expect(e.priority).toBe(100);
  });
});
