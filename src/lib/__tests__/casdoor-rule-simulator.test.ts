import { describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("../platform/electron-api", () => ({
  invoke: (channel: string, payload?: unknown) => invokeMock(channel, payload),
}));

import { casdoorAuthorizeResource } from "../casdoor/casdoor-client";

describe("casdoorAuthorizeResource client wrapper (B2 Rule simulator)", () => {
  it("forwards resource / resourceId / action to the casdoor:authorize-resource channel", async () => {
    invokeMock.mockResolvedValueOnce(true);
    const allowed = await casdoorAuthorizeResource({ resource: "project:readme", resourceId: "project:readme", action: "read" });
    expect(invokeMock).toHaveBeenCalledWith("casdoor:authorize-resource", { resource: "project:readme", resourceId: "project:readme", action: "read" });
    expect(allowed).toBe(true);
  });

  it("propagates the deny decision back to the caller", async () => {
    invokeMock.mockResolvedValueOnce(false);
    const allowed = await casdoorAuthorizeResource({ resource: "admin:secret", action: "delete" });
    expect(allowed).toBe(false);
  });

  it("propagates IPC errors without swallowing them", async () => {
    invokeMock.mockRejectedValueOnce(new Error("casdoor:authorize-resource tenant_mismatch"));
    await expect(casdoorAuthorizeResource({ resource: "project:x", action: "read" })).rejects.toThrow("casdoor:authorize-resource tenant_mismatch");
  });
});
