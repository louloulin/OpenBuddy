import { afterEach, describe, expect, it, vi } from "vitest";
import { hostCapabilities, sessionSearch } from "../agent-client";
import type { OpenBuddyBridge } from "../ipc";

const install = (invoke: OpenBuddyBridge["invoke"]) => {
  window.openbuddy = {
    invoke,
    listen: vi.fn(() => vi.fn()),
    dialog: { open: vi.fn(async () => null), save: vi.fn(async () => null), ask: vi.fn(async () => false) },
    window: { minimize: vi.fn(async () => {}), toggleMaximize: vi.fn(async () => {}), close: vi.fn(async () => {}), isMaximized: vi.fn(async () => false), onResized: vi.fn(() => vi.fn()) },
    getPathForFile: vi.fn((file: File) => file.name),
  };
};
afterEach(() => { delete window.openbuddy; });

describe("client api: host + session search (pii W0.1 / W1.4)", () => {
  it("hostCapabilities returns the host's command and event lists", async () => {
    const caps = { protocolVersion: 1, platform: "desktop", commands: ["host_capabilities", "session_search"], events: ["agent://event"], features: [] };
    const invoke = vi.fn(async () => caps);
    install(invoke);
    await expect(hostCapabilities()).resolves.toEqual(caps);
    expect(invoke).toHaveBeenCalledWith("host_capabilities", undefined);
  });

  it("hostCapabilities rejects a malformed reply instead of returning it", async () => {
    install(vi.fn(async () => ({ protocolVersion: 1 })));
    await expect(hostCapabilities()).rejects.toThrow("invalid_payload");
  });

  it("sessionSearch sends query, cwd and limit with nulls for omitted values", async () => {
    const invoke = vi.fn(async () => []);
    install(invoke);
    await sessionSearch("季度报告");
    await sessionSearch("report", "/work", 30);
    expect(invoke).toHaveBeenNthCalledWith(1, "session_search", { query: "季度报告", cwd: null, limit: null });
    expect(invoke).toHaveBeenNthCalledWith(2, "session_search", { query: "report", cwd: "/work", limit: 30 });
  });
});
