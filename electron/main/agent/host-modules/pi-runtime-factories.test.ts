/**
 * pi-runtime-factories.test.ts — smoke tests for Cordis Pi runtime facades.
 */
import { afterEach, describe, it, expect, vi } from "vitest";

import {
  installPiRuntimeFactories,
  createToolRegistry,
  createPiRuntime,
  createPiSessionFacade,
  listAllPiSessions,
  persistedSessionPath,
  __resetPiRuntimeFactoriesForTest,
} from "./pi-runtime-factories";
import { createDefaultAgentHostState } from "./_default-state";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

afterEach(() => {
  __resetPiRuntimeFactoriesForTest();
});

function makeStubDeps(state = createDefaultAgentHostState()) {
  return {
    state,
    piHome: vi.fn(() => "/fake/home"),
    getSession: vi.fn(() => ({ sessionId: "x" })),
    getModel: vi.fn(() => ({ provider: "p", id: "m" })),
    prompt: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    setThinkingLevel: vi.fn(async () => undefined),
    promptContent: vi.fn(async () => undefined),
    onEvent: vi.fn(() => () => undefined),
  };
}

describe("pi-runtime-factories", () => {
  it("createToolRegistry throws when not installed", () => {
    expect(() => createToolRegistry()).toThrow(/not installed/);
  });

  it("createToolRegistry register/unregister bumps revision + invokes onChange", () => {
    const state = createDefaultAgentHostState();
    installPiRuntimeFactories(makeStubDeps(state));
    const onChange = vi.fn();
    const registry = createToolRegistry(onChange);
    const tool: ToolDefinition = { name: "foo", description: "d", label: "F", execute: vi.fn() } as any;
    const dispose = registry.registerTool(tool);
    expect(state.toolRegistryRevision).toBe(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(registry.list()).toEqual([tool]);
    const ok = dispose();
    expect(ok).toBe(true);
    expect(state.toolRegistryRevision).toBe(2);
    expect(registry.list()).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("createToolRegistry rejects tool without name", () => {
    const state = createDefaultAgentHostState();
    installPiRuntimeFactories(makeStubDeps(state));
    const registry = createToolRegistry();
    expect(() => registry.registerTool({ name: "" } as any)).toThrow(/name is required/);
  });

  it("createPiRuntime returns a facade delegating to install deps", async () => {
    const state = createDefaultAgentHostState();
    state.toolRegistry = { list: () => [] } as any;
    const deps = makeStubDeps(state);
    installPiRuntimeFactories(deps);
    const runtime = createPiRuntime();
    expect(runtime.tools).toBe(state.toolRegistry);
    runtime.getSession();
    expect(deps.getSession).toHaveBeenCalled();
    await runtime.prompt("hi");
    expect(deps.prompt).toHaveBeenCalledWith("hi");
  });

  it("createPiSessionFacade proxies thinkingLevel from session", () => {
    const state = createDefaultAgentHostState();
    state.session = { thinkingLevel: "high" } as any;
    installPiRuntimeFactories(makeStubDeps(state));
    const facade = createPiSessionFacade();
    expect(facade.thinkingLevel).toBe("high");
  });

  it("listAllPiSessions uses install-injected piHome (not a default)", async () => {
    // We don't mock fs.readdir — instead we verify the install-injected
    // piHome is what drives the path scan. The SessionManager.listAll call
    // will throw on the fake path; we just assert the install dep is wired.
    let called = false;
    installPiRuntimeFactories({
      ...makeStubDeps(),
      piHome: () => { called = true; return "/nonexistent/pi-home-for-test"; },
    });
    try { await listAllPiSessions(); } catch { /* expected */ }
    expect(called).toBe(true);
  });

  it("persistedSessionPath returns undefined for empty sessionId", async () => {
    const state = createDefaultAgentHostState();
    installPiRuntimeFactories(makeStubDeps(state));
    expect(await persistedSessionPath(undefined)).toBeUndefined();
    expect(await persistedSessionPath("")).toBeUndefined();
  });

  it("persistedSessionPath prefers active session path", async () => {
    const state = createDefaultAgentHostState();
    state.session = { sessionId: "active", sessionManager: { getSessionFile: () => "/path/active.jsonl" } } as any;
    installPiRuntimeFactories(makeStubDeps(state));
    expect(await persistedSessionPath("active")).toBe("/path/active.jsonl");
  });
});
