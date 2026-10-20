/**
 * agent-permission-bridge.test.ts — 双路径权限适配层单元测试 (P2.1)
 *
 * 覆盖三个核心场景:
 *   1. host-core 不可用 → 完全走 fallback (TS direct)
 *   2. host-core 可用 → 优先 host-core,失败时降级
 *   3. backoff 机制 — 失败后短期不再重试 host-core
 *
 * 测试策略:
 *   - mock `@openbuddy/host-runtime` 的 `callPermissions*` wrapper
 *   - mock `@openbuddy/auth-permission` 的 `permissionHandlers`
 *   - 不 spawn 真实 host-core binary(留给 e2e)
 */

import type { PermissionAction } from "@openbuddy/auth-permission";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  agentPermissionBridge,
  attachHostCorePermissions,
  bridgeState,
  evaluateViaBridge,
  readModeViaBridge,
  readRulesViaBridge,
  resetAgentPermissionBridge,
  writeModeViaBridge,
  writeRulesViaBridge,
} from "../agent-permission-bridge";

// ---- mocks -----------------------------------------------------------------

const {
  callPermissionsEvaluate,
  callPermissionsReadRules,
  callPermissionsWriteRules,
  callPermissionsReadMode,
  callPermissionsWriteMode,
  permissionHandlers,
  resolvePermissionAction,
} = vi.hoisted(() => ({
  callPermissionsEvaluate: vi.fn(),
  callPermissionsReadRules: vi.fn(),
  callPermissionsWriteRules: vi.fn(),
  callPermissionsReadMode: vi.fn(),
  callPermissionsWriteMode: vi.fn(),
  permissionHandlers: {
    readRules: vi.fn(),
    writeRules: vi.fn(),
    readMode: vi.fn(),
    writeMode: vi.fn(),
  },
  resolvePermissionAction: vi.fn(),
}));

vi.mock("@openbuddy/host-runtime", () => ({
  callPermissionsEvaluate,
  callPermissionsReadRules,
  callPermissionsWriteRules,
  callPermissionsReadMode,
  callPermissionsWriteMode,
}));

vi.mock("@openbuddy/auth-permission", () => ({
  permissionHandlers,
  resolvePermissionAction,
}));

// fake host handle that satisfies the structural shape
const fakeHost = { call: vi.fn(), dispose: vi.fn() } as unknown as { call: unknown };

beforeEach(() => {
  // Reset all mocks
  callPermissionsEvaluate.mockReset();
  callPermissionsReadRules.mockReset();
  callPermissionsWriteRules.mockReset();
  callPermissionsReadMode.mockReset();
  callPermissionsWriteMode.mockReset();
  permissionHandlers.readRules.mockReset();
  permissionHandlers.writeRules.mockReset();
  permissionHandlers.readMode.mockReset();
  permissionHandlers.writeMode.mockReset();
  resolvePermissionAction.mockReset();

  // Default fallback behaviors
  permissionHandlers.readRules.mockResolvedValue([]);
  permissionHandlers.writeRules.mockResolvedValue(undefined);
  permissionHandlers.readMode.mockResolvedValue("default" as const);
  permissionHandlers.writeMode.mockResolvedValue(undefined);
  resolvePermissionAction.mockReturnValue(undefined);

  // Reset bridge state between tests
  resetAgentPermissionBridge();
});

afterEach(() => {
  resetAgentPermissionBridge();
});

// ---- tests -----------------------------------------------------------------

describe("agent-permission-bridge — fallback path (no host-core)", () => {
  it("evaluateViaBridge goes straight to fallback when host-core not attached", async () => {
    permissionHandlers.readRules.mockResolvedValue([{ action: "deny" as PermissionAction, tool: "bash" }]);
    resolvePermissionAction.mockReturnValue("deny");

    const action = await evaluateViaBridge("bash", "rm -rf /");

    expect(action).toBe("deny");
    expect(callPermissionsEvaluate).not.toHaveBeenCalled();
    expect(permissionHandlers.readRules).toHaveBeenCalledTimes(1);
    expect(resolvePermissionAction).toHaveBeenCalledWith(
      [{ action: "deny" as PermissionAction, tool: "bash" }],
      "bash",
      "rm -rf /",
    );
  });

  it("readRulesViaBridge returns fallback rules when host-core not attached", async () => {
    const rules = [{ action: "allow" as PermissionAction, tool: "bash", pattern: "git *" }];
    permissionHandlers.readRules.mockResolvedValue(rules);

    const result = await readRulesViaBridge();

    expect(result).toEqual(rules);
    expect(callPermissionsReadRules).not.toHaveBeenCalled();
  });

  it("readModeViaBridge returns fallback mode when host-core not attached", async () => {
    permissionHandlers.readMode.mockResolvedValue("plan" as const);

    const result = await readModeViaBridge();

    expect(result).toBe("plan");
    expect(callPermissionsReadMode).not.toHaveBeenCalled();
  });
});

describe("agent-permission-bridge — host-core path (attached)", () => {
  beforeEach(() => {
    attachHostCorePermissions(fakeHost as never);
  });

  it("evaluateViaBridge uses host-core on the happy path", async () => {
    callPermissionsEvaluate.mockResolvedValue({ action: "allow", matchedRule: "git *" });

    const action = await evaluateViaBridge("bash", "git status");

    expect(action).toBe("allow");
    expect(callPermissionsEvaluate).toHaveBeenCalledWith(fakeHost, { tool: "bash", pattern: "git status" });
    expect(permissionHandlers.readRules).not.toHaveBeenCalled();
  });

  it("readRulesViaBridge uses host-core on the happy path", async () => {
    const rules = [{ action: "allow" as PermissionAction, tool: "bash" }];
    callPermissionsReadRules.mockResolvedValue(rules);

    const result = await readRulesViaBridge();

    expect(result).toEqual(rules);
    expect(permissionHandlers.readRules).not.toHaveBeenCalled();
  });

  it("writeRulesViaBridge forwards rules and returns void", async () => {
    callPermissionsWriteRules.mockResolvedValue({ ok: true, count: 2 });
    const rules = [{ action: "deny" as PermissionAction, tool: "bash" }, { action: "allow" as PermissionAction, tool: "bash" }];

    await writeRulesViaBridge(rules);

    expect(callPermissionsWriteRules).toHaveBeenCalledWith(fakeHost, rules);
    expect(permissionHandlers.writeRules).not.toHaveBeenCalled();
  });

  it("readModeViaBridge uses host-core", async () => {
    callPermissionsReadMode.mockResolvedValue("bypassPermissions");

    const result = await readModeViaBridge();

    expect(result).toBe("bypassPermissions");
    expect(callPermissionsReadMode).toHaveBeenCalledWith(fakeHost);
  });

  it("writeModeViaBridge uses host-core", async () => {
    callPermissionsWriteMode.mockResolvedValue({ ok: true, mode: "acceptEdits" });

    await writeModeViaBridge("acceptEdits");

    expect(callPermissionsWriteMode).toHaveBeenCalledWith(fakeHost, "acceptEdits");
  });
});

describe("agent-permission-bridge — degradation on host-core failure", () => {
  beforeEach(() => {
    attachHostCorePermissions(fakeHost as never);
  });

  it("falls back when callPermissionsEvaluate throws", async () => {
    callPermissionsEvaluate.mockRejectedValue(new Error("host-core disconnected"));
    permissionHandlers.readRules.mockResolvedValue([{ action: "deny" as PermissionAction, tool: "bash" }]);
    resolvePermissionAction.mockReturnValue("deny");

    const action = await evaluateViaBridge("bash");

    expect(action).toBe("deny");
    expect(callPermissionsEvaluate).toHaveBeenCalledTimes(1);
    expect(permissionHandlers.readRules).toHaveBeenCalledTimes(1);
  });

  it("falls back when callPermissionsReadRules throws", async () => {
    callPermissionsReadRules.mockRejectedValue(new Error("ENOENT: no such file"));
    const rules = [{ action: "allow" as PermissionAction, tool: "bash" }];
    permissionHandlers.readRules.mockResolvedValue(rules);

    const result = await readRulesViaBridge();

    expect(result).toEqual(rules);
    expect(permissionHandlers.readRules).toHaveBeenCalledTimes(1);
  });

  it("falls back when callPermissionsWriteRules throws", async () => {
    callPermissionsWriteRules.mockRejectedValue(new Error("rpc timeout"));
    const rules = [{ action: "deny" as PermissionAction, tool: "bash" }];

    await writeRulesViaBridge(rules);

    expect(callPermissionsWriteRules).toHaveBeenCalledTimes(1);
    expect(permissionHandlers.writeRules).toHaveBeenCalledWith(rules);
  });

  it("falls back when callPermissionsReadMode throws", async () => {
    callPermissionsReadMode.mockRejectedValue(new Error("rpc timeout"));
    permissionHandlers.readMode.mockResolvedValue("default" as const);

    const result = await readModeViaBridge();

    expect(result).toBe("default");
    expect(permissionHandlers.readMode).toHaveBeenCalledTimes(1);
  });

  it("falls back when callPermissionsWriteMode throws", async () => {
    callPermissionsWriteMode.mockRejectedValue(new Error("rpc timeout"));

    await writeModeViaBridge("plan");

    expect(callPermissionsWriteMode).toHaveBeenCalledTimes(1);
    expect(permissionHandlers.writeMode).toHaveBeenCalledWith("plan");
  });
});

describe("agent-permission-bridge — backoff after failure", () => {
  beforeEach(() => {
    attachHostCorePermissions(fakeHost as never);
  });

  it("skips host-core during backoff window after a failure", async () => {
    callPermissionsEvaluate.mockRejectedValue(new Error("host-core crashed"));
    permissionHandlers.readRules.mockResolvedValue([]);
    resolvePermissionAction.mockReturnValue(undefined);

    // First call: tries host-core, fails, records failure
    await evaluateViaBridge("bash");
    expect(callPermissionsEvaluate).toHaveBeenCalledTimes(1);

    // Second call within backoff window: skips host-core entirely
    await evaluateViaBridge("bash");
    expect(callPermissionsEvaluate).toHaveBeenCalledTimes(1); // still 1, no retry
    expect(permissionHandlers.readRules).toHaveBeenCalledTimes(2);
  });

  it("bridgeState reports inBackoff after a failure", async () => {
    callPermissionsReadRules.mockRejectedValue(new Error("boom"));

    await readRulesViaBridge();

    const state = bridgeState();
    expect(state.hostAttached).toBe(true);
    expect(state.available).toBe(false);
    expect(state.inBackoff).toBe(true);
  });

  it("bridgeState reports available when host-core healthy", () => {
    const state = bridgeState();
    expect(state.hostAttached).toBe(true);
    expect(state.available).toBe(true);
    expect(state.inBackoff).toBe(false);
  });

  it("bridgeState reports hostAttached=false when no host", () => {
    attachHostCorePermissions(null);
    const state = bridgeState();
    expect(state.hostAttached).toBe(false);
  });
});

describe("agent-permission-bridge — reset semantics", () => {
  it("resetAgentPermissionBridge clears host attachment", () => {
    attachHostCorePermissions(fakeHost as never);
    expect(bridgeState().hostAttached).toBe(true);

    resetAgentPermissionBridge();

    expect(bridgeState().hostAttached).toBe(false);
    expect(bridgeState().available).toBe(true);
  });
});

describe("agentPermissionBridge object — drop-in compatibility", () => {
  it("exposes readRules / writeRules / readMode / writeMode / evaluate", () => {
    expect(typeof agentPermissionBridge.readRules).toBe("function");
    expect(typeof agentPermissionBridge.writeRules).toBe("function");
    expect(typeof agentPermissionBridge.readMode).toBe("function");
    expect(typeof agentPermissionBridge.writeMode).toBe("function");
    expect(typeof agentPermissionBridge.evaluate).toBe("function");
  });

  it("agentPermissionBridge.readRules uses host-core when attached", async () => {
    attachHostCorePermissions(fakeHost as never);
    const rules = [{ action: "deny" as PermissionAction, tool: "rm" }];
    callPermissionsReadRules.mockResolvedValue(rules);

    const result = await agentPermissionBridge.readRules();

    expect(result).toEqual(rules);
    expect(callPermissionsReadRules).toHaveBeenCalledWith(fakeHost);
    expect(permissionHandlers.readRules).not.toHaveBeenCalled();
  });

  it("agentPermissionBridge.writeRules uses host-core when attached", async () => {
    attachHostCorePermissions(fakeHost as never);
    callPermissionsWriteRules.mockResolvedValue({ ok: true, count: 1 });
    const rules = [{ action: "allow" as PermissionAction, tool: "bash" }];

    await agentPermissionBridge.writeRules(rules);

    expect(callPermissionsWriteRules).toHaveBeenCalledWith(fakeHost, rules);
  });

  it("agentPermissionBridge falls back on host-core failure (object form)", async () => {
    attachHostCorePermissions(fakeHost as never);
    callPermissionsReadMode.mockRejectedValue(new Error("rpc timeout"));
    permissionHandlers.readMode.mockResolvedValue("acceptEdits" as const);

    const mode = await agentPermissionBridge.readMode();

    expect(mode).toBe("acceptEdits");
    expect(permissionHandlers.readMode).toHaveBeenCalledTimes(1);
  });

  it("agentPermissionBridge.evaluate is alias of evaluateViaBridge", async () => {
    attachHostCorePermissions(fakeHost as never);
    callPermissionsEvaluate.mockResolvedValue({ action: "ask" });

    const result = await agentPermissionBridge.evaluate("bash", "npm publish");

    expect(result).toBe("ask");
    expect(callPermissionsEvaluate).toHaveBeenCalledWith(fakeHost, { tool: "bash", pattern: "npm publish" });
  });
});
