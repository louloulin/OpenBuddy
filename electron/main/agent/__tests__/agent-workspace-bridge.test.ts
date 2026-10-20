import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  attachHostCoreWorkspace,
  resetAgentWorkspaceBridge,
  workspaceBridgeState,
  workspaceCheckViaBridge,
  workspaceSetRootViaBridge,
} from "../agent-workspace-bridge";

const {
  callWorkspaceCheck,
  callWorkspaceSetRoot,
} = vi.hoisted(() => ({
  callWorkspaceCheck: vi.fn(),
  callWorkspaceSetRoot: vi.fn(),
}));

vi.mock("@openbuddy/host-runtime", () => ({
  callWorkspaceCheck,
  callWorkspaceSetRoot,
}));

const fakeHost = { call: vi.fn(), dispose: vi.fn() } as unknown as { call: unknown };

beforeEach(() => {
  callWorkspaceCheck.mockReset();
  callWorkspaceSetRoot.mockReset();
  resetAgentWorkspaceBridge();
});
afterEach(() => resetAgentWorkspaceBridge());

describe("workspace-bridge — fallback path", () => {
  it("check returns null when no host", async () => {
    expect(await workspaceCheckViaBridge("/foo")).toBeNull();
  });

  it("setRoot is a no-op when no host", async () => {
    await workspaceSetRootViaBridge("/workspace");
    expect(callWorkspaceSetRoot).not.toHaveBeenCalled();
  });
});

describe("workspace-bridge — host-core path", () => {
  beforeEach(() => attachHostCoreWorkspace(fakeHost as never));

  it("check uses host-core", async () => {
    callWorkspaceCheck.mockResolvedValue({ inWorkspace: false, isDirectory: false });

    const result = await workspaceCheckViaBridge("/outside");

    expect(result).toEqual({ inWorkspace: false, isDirectory: false });
  });

  it("setRoot uses host-core", async () => {
    callWorkspaceSetRoot.mockResolvedValue({ ok: true });

    await workspaceSetRootViaBridge("/workspace");

    expect(callWorkspaceSetRoot).toHaveBeenCalledWith(fakeHost, { workspaceRoot: "/workspace" });
  });
});

describe("workspace-bridge — degradation", () => {
  beforeEach(() => attachHostCoreWorkspace(fakeHost as never));

  it("check falls back to null on failure", async () => {
    callWorkspaceCheck.mockRejectedValue(new Error("boom"));
    expect(await workspaceCheckViaBridge("/foo")).toBeNull();
  });
});

describe("workspace-bridge — backoff", () => {
  beforeEach(() => attachHostCoreWorkspace(fakeHost as never));

  it("skips host-core during backoff window after failure", async () => {
    callWorkspaceCheck.mockRejectedValue(new Error("boom"));

    await workspaceCheckViaBridge("/p1");
    expect(callWorkspaceCheck).toHaveBeenCalledTimes(1);

    await workspaceCheckViaBridge("/p2");
    expect(callWorkspaceCheck).toHaveBeenCalledTimes(1);
  });

  it("bridgeState reports inBackoff after failure", async () => {
    callWorkspaceCheck.mockRejectedValue(new Error("boom"));
    await workspaceCheckViaBridge("/p");

    const s = workspaceBridgeState();
    expect(s.hostAttached).toBe(true);
    expect(s.available).toBe(false);
    expect(s.inBackoff).toBe(true);
  });
});
