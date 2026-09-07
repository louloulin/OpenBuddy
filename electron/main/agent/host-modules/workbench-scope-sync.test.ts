/**
 * workbench-scope-sync.test.ts — 单元测试 workbench scope 同步域.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  installWorkbenchScopeSync,
  syncWorkbenchScope,
  __resetWorkbenchScopeSyncForTest,
} from "./workbench-scope-sync";
import { createDefaultAgentHostState } from "./_default-state";
import { type AgentHostState } from "./_state-shape";

function makeStubDeps() {
  const state = createDefaultAgentHostState() as AgentHostState;
  const events: Array<{ channel: string; payload: unknown }> = [];

  const stub = {
    state,
    emitRendererEvent: vi.fn((channel: string, payload: unknown) => {
      events.push({ channel, payload });
    }),
    casdoorStatus: vi.fn((): any => ({
      config: { configured: false },
      tenantContext: { activeTenantId: null },
      identity: null,
    })),
    events,
  };
  return stub;
}

describe("workbench-scope-sync", () => {
  let stub: ReturnType<typeof makeStubDeps>;

  beforeEach(() => {
    stub = makeStubDeps();
    installWorkbenchScopeSync(stub as any);
    // Reset env
    delete process.env.OPENBUDDY_WORKBENCH_SCOPE;
  });

  afterEach(() => {
    __resetWorkbenchScopeSyncForTest();
  });

  it("throws when not installed", async () => {
    __resetWorkbenchScopeSyncForTest();
    await expect(syncWorkbenchScope()).rejects.toThrow(/not installed/);
    installWorkbenchScopeSync(stub as any);
  });

  it("emits openbuddy://workbench-scope event with derived scope", async () => {
    stub.casdoorStatus.mockReturnValueOnce({
      config: { configured: true },
      tenantContext: { activeTenantId: "tenant-a" },
      identity: { subject: "alice" },
    });
    await syncWorkbenchScope();
    expect(stub.emitRendererEvent).toHaveBeenCalledWith(
      "openbuddy://workbench-scope",
      expect.objectContaining({ scope: "configured:tenant-a:alice" }),
    );
    expect(stub.state.scopeKey).toBe("configured:tenant-a:alice");
    expect(process.env.OPENBUDDY_WORKBENCH_SCOPE).toBe("configured:tenant-a:alice");
  });

  it("uses 'local:none:anonymous' for unconfigured casdoor", async () => {
    await syncWorkbenchScope();
    expect(stub.emitRendererEvent).toHaveBeenCalledWith(
      "openbuddy://workbench-scope",
      expect.objectContaining({ scope: "local:none:anonymous" }),
    );
  });

  it("is idempotent when scope doesn't change", async () => {
    stub.casdoorStatus.mockReturnValue({
      config: { configured: true },
      tenantContext: { activeTenantId: "tenant-a" },
      identity: { subject: "alice" },
    });
    await syncWorkbenchScope();
    stub.emitRendererEvent.mockClear();
    await syncWorkbenchScope();
    expect(stub.emitRendererEvent).not.toHaveBeenCalled();
  });

  it("force=true re-emits even when scopeKey matches", async () => {
    stub.casdoorStatus.mockReturnValue({
      config: { configured: true },
      tenantContext: { activeTenantId: "tenant-a" },
      identity: { subject: "alice" },
    });
    await syncWorkbenchScope();
    stub.emitRendererEvent.mockClear();
    await syncWorkbenchScope(true);
    expect(stub.emitRendererEvent).toHaveBeenCalledTimes(1);
  });

  it("catches and logs errors from casdoorStatus", async () => {
    stub.casdoorStatus.mockImplementationOnce(() => {
      throw new Error("casdoor not initialized");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(syncWorkbenchScope()).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("syncWorkbenchScope"), expect.any(Error));
    errSpy.mockRestore();
  });

  it("includes ISO timestamp in emitted event payload", async () => {
    await syncWorkbenchScope();
    const evt = stub.events[0];
    expect((evt?.payload as any).at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
