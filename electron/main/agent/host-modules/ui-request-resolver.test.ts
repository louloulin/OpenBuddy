/**
 * ui-request-resolver.test.ts — 单元测试 pending UI request 解析域.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  installUiRequestResolver,
  resolveUiRequest,
  __resetUiRequestResolverForTest,
} from "./ui-request-resolver";
import { createDefaultAgentHostState } from "./_default-state";
import type { AgentHostState } from "./_state-shape";

function makeStubDeps() {
  const state = createDefaultAgentHostState() as AgentHostState;
  state.pendingUiRequests = new Map();
  state.hookPermissionSessionRules = new Map();
  const events: Array<{ type: string; payload: unknown }> = [];

  const stub = {
    state,
    emitPluginEvent: vi.fn((type: string, payload: unknown) => {
      events.push({ type, payload });
    }),
    permissionReadRules: vi.fn(async () => [] as any[]),
    permissionWriteRules: vi.fn(async (_rules: any[]) => undefined),
    events,
  };
  return stub;
}

describe("ui-request-resolver", () => {
  let stub: ReturnType<typeof makeStubDeps>;

  beforeEach(() => {
    stub = makeStubDeps();
    installUiRequestResolver(stub as any);
  });

  afterEach(() => {
    __resetUiRequestResolverForTest();
  });

  it("throws when not installed", () => {
    __resetUiRequestResolverForTest();
    expect(() => resolveUiRequest("r1", true)).toThrow(/not installed/);
    installUiRequestResolver(stub as any);
  });

  it("returns false when requestId is not in pendingUiRequests", () => {
    const result = resolveUiRequest("nonexistent", true);
    expect(result).toBe(false);
  });

  it("resolves permission request with allow decision (boolean true)", () => {
    const resolve = vi.fn();
    stub.state.pendingUiRequests.set("r1", {
      kind: "permission",
      sessionId: "s1",
      permission: { toolName: "bash", pattern: undefined },
      resolve,
    });
    const result = resolveUiRequest("r1", true);
    expect(result).toBe(true);
    expect(resolve).toHaveBeenCalledWith(true);
    expect(stub.state.pendingUiRequests.has("r1")).toBe(false);
  });

  it("emits session/permission-resolved event", () => {
    stub.state.pendingUiRequests.set("r1", {
      kind: "permission",
      sessionId: "s1",
      permission: { toolName: "bash" },
      resolve: vi.fn(),
    });
    resolveUiRequest("r1", { decision: "allow" });
    const evt = stub.events.find((e) => e.type === "session/permission-resolved");
    expect(evt).toBeDefined();
    expect(evt?.payload).toMatchObject({
      requestId: "r1",
      sessionId: "s1",
      approved: true,
      decision: "allow",
    });
  });

  it("rejects and removes a request from an older Pi generation", () => {
    const resolve = vi.fn();
    stub.state.piGeneration = 4;
    stub.state.pendingUiRequests.set("stale", {
      kind: "question",
      sessionId: "s1",
      generation: 3,
      resolve,
    });

    expect(resolveUiRequest("stale", "late answer" as any)).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    expect(stub.state.pendingUiRequests.has("stale")).toBe(false);
    expect(stub.events).toHaveLength(0);
  });

  it("accepts a request from the active Pi generation", () => {
    const resolve = vi.fn();
    stub.state.piGeneration = 4;
    stub.state.pendingUiRequests.set("current", {
      kind: "question",
      sessionId: "s1",
      generation: 4,
      resolve,
    });

    expect(resolveUiRequest("current", "answer" as any)).toBe(true);
    expect(resolve).toHaveBeenCalledWith("answer");
  });

  it("emits session/question-resolved for question requests", () => {
    stub.state.pendingUiRequests.set("r1", {
      kind: "question",
      sessionId: "s1",
      resolve: vi.fn(),
    });
    resolveUiRequest("r1", { answers: { q1: "answer-1" }, annotations: {} } as any);
    const evt = stub.events.find((e) => e.type === "session/question-resolved");
    expect(evt).toBeDefined();
    expect((evt?.payload as any).answerCount).toBe(1);
  });

  it("allow_always persists to global rules", async () => {
    stub.state.pendingUiRequests.set("r1", {
      kind: "permission",
      sessionId: "s1",
      permission: { toolName: "bash" },
      resolve: vi.fn(),
    });
    stub.permissionReadRules.mockResolvedValueOnce([{ action: "deny", tool: "other" }]);
    resolveUiRequest("r1", { decision: "allow_always" });
    // Wait for async writeRules to complete
    await new Promise((r) => setTimeout(r, 0));
    expect(stub.permissionReadRules).toHaveBeenCalled();
    expect(stub.permissionWriteRules).toHaveBeenCalledWith([
      { action: "deny", tool: "other" },
      { action: "allow", tool: "bash" },
    ]);
  });

  it("allow (single) writes session-scoped rules", () => {
    stub.state.pendingUiRequests.set("r1", {
      kind: "permission",
      sessionId: "s1",
      permission: { toolName: "bash", pattern: "git *" },
      resolve: vi.fn(),
    });
    resolveUiRequest("r1", { decision: "allow" });
    const sessionRules = stub.state.hookPermissionSessionRules.get("s1");
    expect(sessionRules).toEqual([
      { action: "allow", tool: "bash", pattern: "git *" },
    ]);
  });

  it("deny permission does not write any rules", () => {
    stub.state.pendingUiRequests.set("r1", {
      kind: "permission",
      sessionId: "s1",
      permission: { toolName: "bash" },
      resolve: vi.fn(),
    });
    resolveUiRequest("r1", { decision: "deny" });
    expect(stub.permissionWriteRules).not.toHaveBeenCalled();
    expect(stub.state.hookPermissionSessionRules.has("s1")).toBe(false);
  });

  it("string answer emits answerLength", () => {
    stub.state.pendingUiRequests.set("q1", {
      kind: "question",
      sessionId: "s1",
      resolve: vi.fn(),
    });
    resolveUiRequest("q1", "yes please" as any);
    const evt = stub.events.find((e) => e.type === "session/question-resolved");
    expect((evt?.payload as any).answerLength).toBe(10);
  });

  it("catches and logs persist rule errors", async () => {
    stub.state.pendingUiRequests.set("r1", {
      kind: "permission",
      sessionId: "s1",
      permission: { toolName: "bash" },
      resolve: vi.fn(),
    });
    stub.permissionWriteRules.mockRejectedValueOnce(new Error("write failed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    resolveUiRequest("r1", { decision: "allow_always" });
    await new Promise((r) => setTimeout(r, 0));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("persist hook permission"), expect.any(Error));
    warnSpy.mockRestore();
  });
});
