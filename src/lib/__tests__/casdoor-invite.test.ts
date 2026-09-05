import { describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("../platform/electron-api", () => ({
  invoke: (channel: string, payload?: unknown) => invokeMock(channel, payload),
}));

import { casdoorInviteUser, type CasdoorUserInviteResult } from "../casdoor/casdoor-client";

describe("casdoorInviteUser client wrapper", () => {
  it("forwards the invite payload to the casdoor:user-invite IPC channel", async () => {
    const result: CasdoorUserInviteResult = {
      owner: "acme",
      email: "newbie@example.com",
      link: "https://casdoor.test/signup?token=abc",
      expiresAt: "2025-01-02T00:00:00Z",
    };
    invokeMock.mockResolvedValueOnce(result);

    const out = await casdoorInviteUser({
      owner: "acme",
      email: "newbie@example.com",
      role: "built-in/openbuddy-member",
      group: "built-in/engineering",
      hoursValid: 48,
    });

    expect(invokeMock).toHaveBeenCalledWith("casdoor:user-invite", {
      owner: "acme",
      email: "newbie@example.com",
      role: "built-in/openbuddy-member",
      group: "built-in/engineering",
      hoursValid: 48,
    });
    expect(out).toEqual(result);
  });

  it("omits optional fields when not provided so Casdoor applies its defaults", async () => {
    invokeMock.mockResolvedValueOnce({ owner: "acme", email: "anon@example.com" });
    await casdoorInviteUser({ owner: "acme", email: "anon@example.com" });
    expect(invokeMock).toHaveBeenCalledWith("casdoor:user-invite", {
      owner: "acme",
      email: "anon@example.com",
    });
  });

  it("propagates IPC errors without swallowing them", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Casdoor /api/invite-user 403"));
    await expect(
      casdoorInviteUser({ owner: "acme", email: "denied@example.com" })
    ).rejects.toThrow("Casdoor /api/invite-user 403");
  });
});
