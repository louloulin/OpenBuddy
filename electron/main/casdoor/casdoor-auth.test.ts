import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/openbuddy-casdoor-auth-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: vi.fn() },
}));

import { normalizeCasdoorClaims } from "@openbuddy/auth-casdoor";
import { CasdoorAuthService } from "./casdoor-auth";
import { shell } from "electron";

function configuredService(): CasdoorAuthService {
  const service = new CasdoorAuthService();
  const internal = service as unknown as {
    config: Record<string, unknown>;
    identity: ReturnType<typeof normalizeCasdoorClaims>;
    activeTenantId: string;
    accessToken: string;
    expiresAt: number;
  };
  internal.config = {
    ...internal.config,
    issuer: "https://casdoor.test",
    clientId: "client-id",
    enforcerId: "openbuddy-enforcer",
    configured: true,
  };
  internal.identity = normalizeCasdoorClaims({
    sub: "tenant-a/member",
    organizations: ["tenant-a"],
    permissions: ["workspace.read"],
  });
  internal.activeTenantId = "tenant-a";
  internal.accessToken = "casdoor-access-token";
  internal.expiresAt = Date.now() + 60_000;
  return service;
}

describe("Casdoor remote resource authorization", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENBUDDY_CASDOOR_CLIENT_SECRET;
    delete process.env.OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL;
  });

  it("uses local authorization when remote enforcement is not configured", async () => {
    const service = configuredService();
    expect(await service.authorizeResourceRemotely({ tenantId: "tenant-a", resource: "workspace", action: "read" })).toBe(true);
    expect(await service.authorizeResourceRemotely({ tenantId: "tenant-a", resource: "workspace", action: "write" })).toBe(false);
  });

  it("opens the discovered Casdoor authorization page for the enterprise login entry", async () => {
    const service = configuredService();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "ok",
        data: { enableCodeSignin: false, signinMethods: [], providers: [], redirectUris: ["casdoor://localhost/callback"] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        issuer: "https://casdoor.test",
        authorization_endpoint: "https://casdoor.test/login/oauth/authorize",
        token_endpoint: "https://casdoor.test/api/login/oauth/access_token",
      }), { status: 200 }));

    const result = await service.startLogin("default");
    expect(result.ok).toBe(true);
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
    const authorizationUrl = new URL(vi.mocked(shell.openExternal).mock.calls[0][0] as string);
    expect(authorizationUrl.origin).toBe("https://casdoor.test");
    expect(authorizationUrl.pathname).toBe("/login/oauth/authorize");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("client-id");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe("casdoor://localhost/callback");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("state")).toHaveLength(64);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the Casdoor application is not ready for enterprise login", async () => {
    const service = configuredService();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "ok",
        data: { redirectUris: [], scopes: [], enableCodeSignin: false, signinMethods: [], providers: [] },
      }), { status: 200 }));

    const result = await service.startLogin("default");
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: expect.stringContaining("未登记回调 URI") });
    expect(vi.mocked(shell.openExternal)).not.toHaveBeenCalled();
  });

  it("rejects malformed requests without throwing or making a request", async () => {
    const service = configuredService();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await service.authorizeResourceRemotely(null as never)).toBe(false);
    expect(await service.authorizeResourceRemotely({ resource: "", action: "read" })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a cross-tenant request before remote enforcement", async () => {
    const service = configuredService();
    process.env.OPENBUDDY_CASDOOR_CLIENT_SECRET = "secret";
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await service.authorizeResourceRemotely({ tenantId: "tenant-b", resource: "workspace", action: "read" })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses Casdoor Casbin enforcement and the original client id", async () => {
    const service = configuredService();
    process.env.OPENBUDDY_CASDOOR_CLIENT_SECRET = "secret";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "ok", data: [true] }), { status: 200 }));
    expect(await service.authorizeResourceRemotely({ tenantId: "tenant-a", resource: "workspace", resourceId: "workspace-1", action: "read" })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://casdoor.test/api/enforce?enforcerId=openbuddy-enforcer");
    expect((init?.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("client-id:secret").toString("base64")}`);
    expect(init?.body).toBe(JSON.stringify(["tenant-a/member", "workspace-1", "read"]));
  });

  it("exchanges a short-lived WeKnora token without exposing the Casdoor token", async () => {
    const service = configuredService();
    process.env.OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL = "http://gateway.test/v1/token-exchange/weknora";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      status: "ok",
      data: { access_token: "header.payload.signature", token_type: "Bearer", expires_in: 300, audience: "weknora" },
    }), { status: 200 }));

    await expect(service.exchangeForWeKnora("42", "session-1")).resolves.toEqual({
      accessToken: "header.payload.signature",
      tokenType: "Bearer",
      expiresIn: 300,
      audience: "weknora",
      tenantId: "42",
    });
    expect(fetchMock).toHaveBeenCalledWith("http://gateway.test/v1/token-exchange/weknora", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer casdoor-access-token" }),
      body: JSON.stringify({ tenant: "tenant-a", weknoraTenantId: "42", sessionId: "session-1" }),
    }));
  });

  it("rejects invalid WeKnora exchange input and non-Bearer responses", async () => {
    const service = configuredService();
    process.env.OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL = "http://gateway.test/v1/token-exchange/weknora";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      status: "ok", data: { access_token: "opaque", token_type: "Basic" },
    }), { status: 200 }));

    await expect(service.exchangeForWeKnora("not-numeric")).rejects.toThrow("WeKnora 租户标识无效");
    await expect(service.exchangeForWeKnora("42", " ")).rejects.toThrow("会话标识无效");
    await expect(service.exchangeForWeKnora("42")).rejects.toThrow("WeKnora token exchange failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes a WeKnora exchange token via the Gateway sliding-window endpoint", async () => {
    const service = configuredService();
    process.env.OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL = "http://gateway.test/v1/token-exchange/weknora";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      status: "ok",
      data: { access_token: "new.header.signature", token_type: "Bearer", expires_in: 300, audience: "weknora" },
    }), { status: 200 }));

    const current = { accessToken: "old.header.signature", tokenType: "Bearer" as const, expiresIn: 300, audience: "weknora", tenantId: "42" };
    await expect(service.refreshWeKnoraExchangeToken(current, "session-2")).resolves.toEqual({
      accessToken: "new.header.signature",
      tokenType: "Bearer",
      expiresIn: 300,
      audience: "weknora",
      tenantId: "42",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://gateway.test/v1/token-exchange/weknora/refresh");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer old.header.signature");
    expect(init?.body).toBe(JSON.stringify({ sessionId: "session-2" }));
  });

  it("rejects refresh when the Gateway returns non-Bearer or failure", async () => {
    const service = configuredService();
    process.env.OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL = "http://gateway.test/v1/token-exchange/weknora";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      status: "error", code: "AUTHORIZATION_VERSION_REVOKED", message: "WeKnora exchange token 的权限版本已失效",
    }), { status: 403 }));

    const current = { accessToken: "old.header.signature", tokenType: "Bearer" as const, expiresIn: 300, audience: "weknora", tenantId: "42" };
    await expect(service.refreshWeKnoraExchangeToken(current)).rejects.toThrow("权限版本已失效");
  });

  it("fails closed when Casdoor denies or is unavailable", async () => {
    const service = configuredService();
    process.env.OPENBUDDY_CASDOOR_CLIENT_SECRET = "secret";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", data: [false] }), { status: 200 })).mockRejectedValueOnce(new Error("network down"));
    expect(await service.authorizeResourceRemotely({ tenantId: "tenant-a", resource: "workspace", action: "read" })).toBe(false);
    expect(await service.authorizeResourceRemotely({ tenantId: "tenant-a", resource: "workspace", action: "read" })).toBe(false);
  });

  it("exposes a stable authorization code to main-process callers", () => {
    const service = configuredService();
    expect(() => service.assertAuthorized({ permission: "tenant.users.write" })).toThrow("CASDOOR_PERMISSION_DENIED");
    try {
      service.assertAuthorized({ permission: "tenant.users.write" });
    } catch (error) {
      expect(error).toMatchObject({ name: "CasdoorAuthorizationError", code: "CASDOOR_PERMISSION_DENIED", reason: "permission_denied", tenantId: "tenant-a" });
    }
  });

  it("emits a tenant-switch lifecycle reason without exposing credentials", () => {
    const service = configuredService();
    const listener = vi.fn();
    service.setStatusListener(listener);
    service.selectTenant("tenant-a");
    expect(listener).toHaveBeenCalledWith("tenant-switch");
    expect(listener.mock.calls[0]).not.toContain("secret-token");
  });

  it("revalidates public sessions through UserInfo and invalidates disabled accounts", async () => {
    const service = configuredService();
    const internal = service as unknown as { accessToken: string; refreshToken: string | null };
    internal.accessToken = "access-token";
    internal.refreshToken = null;
    const listener = vi.fn();
    service.setStatusListener(listener);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        issuer: "https://casdoor.test",
        authorization_endpoint: "https://casdoor.test/authorize",
        token_endpoint: "https://casdoor.test/token",
        userinfo_endpoint: "https://casdoor.test/userinfo",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sub: "tenant-a/member", isForbidden: true }), { status: 200 }));

    const result = await service.revalidateCurrentSession();
    expect(result.status).toBe("error");
    expect(result.identity).toBeNull();
    expect(listener).toHaveBeenCalledWith("session-invalidated");
  });
});
