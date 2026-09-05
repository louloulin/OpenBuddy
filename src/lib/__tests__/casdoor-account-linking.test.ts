import { describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("../platform/electron-api", () => ({
  invoke: (channel: string, payload?: unknown) => invokeMock(channel, payload),
}));

import { casdoorListAccountLinking, casdoorUnlinkAccount } from "../casdoor/casdoor-client";

describe("casdoorListAccountLinking / casdoorUnlinkAccount client wrappers", () => {
  it("forwards owner + name to the casdoor:list-account-linking channel", async () => {
    invokeMock.mockResolvedValueOnce([
      { type: "WeChat", provider: "WeChat", identifier: "wx-openid-1", displayName: "WeCom Alice", linkedAt: "2024-05-01" },
      { type: "Phone", identifier: "+8613800001111" },
    ]);
    const out = await casdoorListAccountLinking("acme", "alice");
    expect(invokeMock).toHaveBeenCalledWith("casdoor:list-account-linking", { owner: "acme", name: "alice" });
    expect(out).toHaveLength(2);
    expect(out[0].provider).toBe("WeChat");
  });

  it("forwards the unlink payload to the casdoor:unlink-account channel", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await casdoorUnlinkAccount({ owner: "acme", name: "alice", type: "WeChat", identifier: "wx-openid-1" });
    expect(invokeMock).toHaveBeenCalledWith("casdoor:unlink-account", { owner: "acme", name: "alice", type: "WeChat", identifier: "wx-openid-1" });
  });

  it("propagates IPC errors without swallowing them", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Casdoor /api/get-account-linking-options 403"));
    await expect(casdoorListAccountLinking("acme", "alice")).rejects.toThrow("Casdoor /api/get-account-linking-options 403");
  });
});
