import { describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("../platform/electron-api", () => ({
  invoke: (channel: string, payload?: unknown) => invokeMock(channel, payload),
}));

import { casdoorGetOrganization } from "../casdoor/casdoor-client";

describe("casdoorGetOrganization client wrapper", () => {
  it("forwards owner + name to the casdoor:get-organization channel", async () => {
    invokeMock.mockResolvedValueOnce({ owner: "acme", name: "acme", displayName: "ACME Inc.", logo: "data:image/png;base64,...", websiteUrl: "https://acme.example" });
    const out = await casdoorGetOrganization("acme", "acme");
    expect(invokeMock).toHaveBeenCalledWith("casdoor:get-organization", { owner: "acme", name: "acme" });
    expect(out.displayName).toBe("ACME Inc.");
    expect(out.logo?.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("propagates IPC errors without swallowing them", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Casdoor /api/get-organization 403"));
    await expect(casdoorGetOrganization("acme", "acme")).rejects.toThrow("Casdoor /api/get-organization 403");
  });
});
