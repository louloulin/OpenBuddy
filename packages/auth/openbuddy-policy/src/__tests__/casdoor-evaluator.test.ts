/**
 * casdoor-evaluator.test.ts — CasdoorEvaluator 单元测试
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { CasdoorEvaluator } from "../evaluators/casdoor-evaluator";

beforeEach(() => vi.restoreAllMocks());

describe("CasdoorEvaluator — matches()", () => {
  it("matches when context.capability is present", () => {
    const e = new CasdoorEvaluator({ identity: null, authorize: vi.fn() });
    expect(e.matches({ subject: "u", action: "x", resource: "y", context: { capability: "team.workspace" } })).toBe(true);
  });

  it("matches when context.permission is present", () => {
    const e = new CasdoorEvaluator({ identity: null, authorize: vi.fn() });
    expect(e.matches({ subject: "u", action: "x", resource: "y", context: { permission: "tenant.users.read" } })).toBe(true);
  });

  it("matches when context.resource is present", () => {
    const e = new CasdoorEvaluator({ identity: null, authorize: vi.fn() });
    expect(e.matches({ subject: "u", action: "x", resource: "r", context: { resource: "/some/path" } })).toBe(true);
  });

  it("does not match when no relevant context", () => {
    const e = new CasdoorEvaluator({ identity: null, authorize: vi.fn() });
    expect(e.matches({ subject: "u", action: "x", resource: "y" })).toBe(false);
    expect(e.matches({ subject: "u", action: "x", resource: "y", context: { tool: "bash" } })).toBe(false);
  });
});

describe("CasdoorEvaluator — evaluate() with capability", () => {
  it("returns CASDOOR_AUTHORIZED when allowed", async () => {
    const authorize = vi.fn().mockReturnValue({
      allowed: true, reason: "ok", code: "CASDOOR_AUTHORIZED", tenantId: "t1",
    });
    const e = new CasdoorEvaluator({ identity: null, authorize });

    const result = await e.evaluate({
      subject: "u", action: "read", resource: "workspace",
      context: { capability: "team.workspace" },
    });

    expect(authorize).toHaveBeenCalledWith({
      identity: null,
      requirement: { capability: "team.workspace" },
    });
    expect(result).toMatchObject({
      allowed: true, code: "CASDOOR_AUTHORIZED", source: "casdoor", matchedRule: "tenant:t1",
    });
  });

  it("returns CASDOOR_PERMISSION_DENIED when denied", async () => {
    const authorize = vi.fn().mockReturnValue({
      allowed: false, reason: "nope", code: "CASDOOR_PERMISSION_DENIED", tenantId: "t1",
    });
    const e = new CasdoorEvaluator({ identity: null, authorize });

    const result = await e.evaluate({
      subject: "u", action: "x", resource: "y", context: { capability: "admin.portal" },
    });

    expect(result?.code).toBe("CASDOOR_PERMISSION_DENIED");
    expect(result?.allowed).toBe(false);
  });

  it("returns CASDOOR_SIGNED_OUT when user is signed out", async () => {
    const authorize = vi.fn().mockReturnValue({
      allowed: false, reason: "no identity", code: "CASDOOR_SIGNED_OUT",
    });
    const e = new CasdoorEvaluator({ identity: null, authorize });

    const result = await e.evaluate({
      subject: "u", action: "x", resource: "y", context: { capability: "billing.read" },
    });

    expect(result?.code).toBe("CASDOOR_SIGNED_OUT");
  });

  it("returns CASDOOR_USER_FORBIDDEN for forbidden user", async () => {
    const authorize = vi.fn().mockReturnValue({
      allowed: false, reason: "user blocked", code: "CASDOOR_USER_FORBIDDEN",
    });
    const e = new CasdoorEvaluator({ identity: null, authorize });

    const result = await e.evaluate({
      subject: "u", action: "x", resource: "y", context: { capability: "admin.portal" },
    });

    expect(result?.code).toBe("CASDOOR_USER_FORBIDDEN");
  });
});

describe("CasdoorEvaluator — evaluate() with permission", () => {
  it("routes context.permission through authorize", async () => {
    const authorize = vi.fn().mockReturnValue({
      allowed: true, reason: "ok", code: "CASDOOR_AUTHORIZED",
    });
    const e = new CasdoorEvaluator({ identity: null, authorize });

    await e.evaluate({
      subject: "u", action: "read", resource: "users",
      context: { permission: "tenant.users.read" },
    });

    expect(authorize).toHaveBeenCalledWith({
      identity: null,
      requirement: { permission: "tenant.users.read" },
    });
  });
});

describe("CasdoorEvaluator — evaluate() with resource+action", () => {
  it("routes through authorize with resource+action+resourceId", async () => {
    const authorize = vi.fn().mockReturnValue({
      allowed: true, reason: "ok", code: "CASDOOR_AUTHORIZED",
    });
    const e = new CasdoorEvaluator({ identity: null, authorize });

    await e.evaluate({
      subject: "u", action: "delete", resource: "users",
      context: { resource: "user", resourceId: "u-1" },
    });

    expect(authorize).toHaveBeenCalledWith({
      identity: null,
      requirement: { resource: "user", action: "delete", resourceId: "u-1" },
    });
  });

  it("omits resourceId when not provided", async () => {
    const authorize = vi.fn().mockReturnValue({
      allowed: true, reason: "ok", code: "CASDOOR_AUTHORIZED",
    });
    const e = new CasdoorEvaluator({ identity: null, authorize });

    await e.evaluate({
      subject: "u", action: "list", resource: "users",
      context: { resource: "user" },
    });

    expect(authorize).toHaveBeenCalledWith({
      identity: null,
      requirement: { resource: "user", action: "list" },
    });
  });
});

describe("CasdoorEvaluator — properties", () => {
  it("name is 'casdoor'", () => {
    const e = new CasdoorEvaluator({ identity: null, authorize: vi.fn() });
    expect(e.name).toBe("casdoor");
  });

  it("priority is 50 (after pi)", () => {
    const e = new CasdoorEvaluator({ identity: null, authorize: vi.fn() });
    expect(e.priority).toBe(50);
  });
});
