import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  attachHostCoreWorkspace,
  resetAgentWorkspaceBridge,
  workspaceBridgeState,
  workspaceCheckViaBridge,
  workspaceListIgnoredViaBridge,
  workspaceResolveViaBridge,
  workspaceSetRootViaBridge,
} from "../agent-workspace-bridge";

const {
  callWorkspaceResolve,
  callWorkspaceCheck,
  callWorkspaceListIgnored,
  callWorkspaceSetRoot,
} = vi.hoisted(() => ({
  callWorkspaceResolve: vi.fn(),
  callWorkspaceCheck: vi.fn(),
  callWorkspaceListIgnored: vi.fn(),
  callWorkspaceSetRoot: vi.fn(),
}));

vi.mock("@openbuddy/host-runtime", () => ({
  callWorkspaceResolve,
  callWorkspaceCheck,
  callWorkspaceListIgnored,
  callWorkspaceSetRoot,
}));

const fakeHost = { call: vi.fn(), dispose: vi.fn() } as unknown as { call: unknown };

beforeEach(() => {
  callWorkspaceResolve.mockReset();
  callWorkspaceCheck.mockReset();
  callWorkspaceListIgnored.mockReset();
  callWorkspaceSetRoot.mockReset();
  resetAgentWorkspaceBridge();
});
afterEach(() => resetAgentWorkspaceBridge());

describe("workspace-bridge — fallback path", () => {
  it("resolve returns null when no host", async () => {
    expect(await workspaceResolveViaBridge("/foo")).toBeNull();
  });

  it("check returns null when no host", async () => {
    expect(await workspaceCheckViaBridge("/foo")).toBeNull();
  });

  it("listIgnored returns empty array when no host", async () => {
    expect(await workspaceListIgnoredViaBridge()).toEqual([]);
  });

  it("setRoot is a no-op when no host", async () => {
    await workspaceSetRootViaBridge("/workspace");
    expect(callWorkspaceSetRoot).not.toHaveBeenCalled();
  });
});

describe("workspace-bridge — host-core path", () => {
  beforeEach(() => attachHostCoreWorkspace(fakeHost as never));

  it("resolve uses host-core", async () => {
    callWorkspaceResolve.mockResolvedValue({ canonical: "/workspace/foo", inWorkspace: true, isDirectory: true });

    const result = await workspaceResolveViaBridge("/foo");

    expect(result).toEqual({ canonical: "/workspace/foo", inWorkspace: true, isDirectory: true });
    expect(callWorkspaceResolve).toHaveBeenCalledWith(fakeHost, { path: "/foo" });
  });

  it("check uses host-core", async () => {
    callWorkspaceCheck.mockResolvedValue({ inWorkspace: false, isDirectory: false });

    const result = await workspaceCheckViaBridge("/outside");

    expect(result).toEqual({ inWorkspace: false, isDirectory: false });
  });

  it("listIgnored uses host-core", async () => {
    callWorkspaceListIgnored.mockResolvedValue([{ path: "node_modules", isDirectory: true }]);

    const result = await workspaceListIgnoredViaBridge();

    expect(result).toEqual([{ path: "node_modules", isDirectory: true }]);
  });

  it("setRoot uses host-core", async () => {
    callWorkspaceSetRoot.mockResolvedValue({ ok: true });

    await workspaceSetRootViaBridge("/workspace");

    expect(callWorkspaceSetRoot).toHaveBeenCalledWith(fakeHost, { workspaceRoot: "/workspace" });
  });
});

describe("workspace-bridge — degradation", () => {
  beforeEach(() => attachHostCoreWorkspace(fakeHost as never));

  it("resolve falls back to null on failure", async () => {
    callWorkspaceResolve.mockRejectedValue(new Error("rpc timeout"));
    expect(await workspaceResolveViaBridge("/foo")).toBeNull();
  });

  it("check falls back to null on failure", async () => {
    callWorkspaceCheck.mockRejectedValue(new Error("boom"));
    expect(await workspaceCheckViaBridge("/foo")).toBeNull();
  });
});

describe("workspace-bridge — backoff", () => {
  beforeEach(() => attachHostCoreWorkspace(fakeHost as never));

  it("skips host-core during backoff window after failure", async () => {
    callWorkspaceResolve.mockRejectedValue(new Error("boom"));

    await workspaceResolveViaBridge("/p1");
    expect(callWorkspaceResolve).toHaveBeenCalledTimes(1);

    await workspaceResolveViaBridge("/p2");
    expect(callWorkspaceResolve).toHaveBeenCalledTimes(1);
  });

  it("bridgeState reports inBackoff after failure", async () => {
    callWorkspaceResolve.mockRejectedValue(new Error("boom"));
    await workspaceResolveViaBridge("/p");

    const s = workspaceBridgeState();
    expect(s.hostAttached).toBe(true);
    expect(s.available).toBe(false);
    expect(s.inBackoff).toBe(true);
  });
});
