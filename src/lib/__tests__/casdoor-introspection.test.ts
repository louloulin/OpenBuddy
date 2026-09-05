import { describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("../platform/electron-api", () => ({
  invoke: (channel: string, payload?: unknown) => invokeMock(channel, payload),
}));

import { casdoorIntrospectToken } from "../casdoor/casdoor-client";

describe("casdoorIntrospectToken client wrapper", () => {
  it("forwards token + token_type_hint to casdoor:introspect-token", async () => {
    invokeMock.mockResolvedValueOnce({
      active: true,
      sub: "built-in/admin",
      username: "admin",
      client_id: "app-builtin",
      scope: "openid profile email",
      token_type: "Bearer",
      exp: 1717000000,
      iat: 1716996400,
    });
    const out = await casdoorIntrospectToken({ token: "eyJhbGciOi...", tokenTypeHint: "access_token" });
    expect(invokeMock).toHaveBeenCalledWith("casdoor:introspect-token", { token: "eyJhbGciOi...", tokenTypeHint: "access_token" });
    expect(out.active).toBe(true);
    expect(out.sub).toBe("built-in/admin");
    expect(out.clientId).toBe("app-builtin");
    expect(out.exp).toBe(1717000000);
  });

  it("returns active=false when Casdoor reports the token is revoked", async () => {
    invokeMock.mockResolvedValueOnce({ active: false });
    const out = await casdoorIntrospectToken({ token: "revoked-token", tokenTypeHint: "refresh_token" });
    expect(invokeMock).toHaveBeenCalledWith("casdoor:introspect-token", { token: "revoked-token", tokenTypeHint: "refresh_token" });
    expect(out.active).toBe(false);
  });

  it("propagates IPC errors without swallowing them", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Casdoor /api/introspect 401"));
    await expect(casdoorIntrospectToken({ token: "bad" })).rejects.toThrow("Casdoor /api/introspect 401");
  });
});
