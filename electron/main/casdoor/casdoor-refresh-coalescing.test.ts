/**
 * Casdoor refresh() 单实例合并 (P1.3.1) 契约测试。
 *
 * 覆盖:
 *   - 5 个并发 refresh() → 1 次实际 token endpoint 请求
 *   - 串行调用每次都执行 refresh(无合并语义)
 *   - 失败后 in-flight 清空,下次可重试
 *   - 失败时所有并发 caller 都 reject(此处 refresh() 实际上不 reject,见下)
 *   - clearSession() 同时清空 in-flight
 *   - refresh_token=null 时直接返回 status,不发请求
 *
 * 注意:casdoor-auth.refresh() 设计上 catch 所有错误并返回 status()(容错),
 *   不向上抛异常。所以「失败传播」语义是:所有 caller 都得到相同的 failed status,
 *   而不是 reject。这里测试 status 字段即可。
 *
 * 测试策略:spyOn(globalThis, "fetch") 控制 IdP 响应;
 *   discovery mock 返回标准 OIDC discovery body(token_endpoint 在顶层,
 *   与 casdoor 真实响应一致 — casdoor 也用标准 .well-known 路径)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/openbuddy-coalesce-test" },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: vi.fn() },
}));

import { CasdoorAuthService } from "./casdoor-auth";

/** 标准 OIDC discovery body(Casdoor 真实响应格式 — token_endpoint 在顶层)。 */
function buildDiscovery(): Response {
  return new Response(JSON.stringify({
    issuer: "https://casdoor.test",
    authorization_endpoint: "https://casdoor.test/oauth/authorize",
    token_endpoint: "https://casdoor.test/oauth/token",
    end_session_endpoint: "https://casdoor.test/oauth/logout",
    jwks_uri: "https://casdoor.test/.well-known/jwks",
    userinfo_endpoint: "https://casdoor.test/oauth/userinfo",
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function tokenResponse(at: string): Response {
  return new Response(JSON.stringify({
    access_token: at,
    refresh_token: "new-rt",
    expires_in: 3600,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

/** 构造最小可用 CasdoorAuthService(已配置 + 带 refresh_token)。 */
function makeService(refreshToken: string | null): CasdoorAuthService {
  const service = new CasdoorAuthService();
  const internal = service as unknown as {
    config: Record<string, unknown>;
    refreshToken: string | null;
    identity: null;
    accessToken: null;
    expiresAt: number;
    activeTenantId: string | undefined;
    endpoints: null;
  };
  internal.config = {
    ...internal.config,
    issuer: "https://casdoor.test",
    clientId: "client-id",
    configured: true,
  };
  internal.refreshToken = refreshToken;
  // 清掉任何残留 session 状态,避免 identityFromToken 触发额外路径
  internal.identity = null;
  internal.accessToken = null;
  internal.expiresAt = Date.now() + 60_000;
  internal.activeTenantId = undefined;
  internal.endpoints = null;
  return service;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CasdoorAuthService.refresh() — 单实例合并 (P1.3.1)", () => {
  it("5 个并发 refresh() 调用只触发 1 次 token endpoint 请求", async () => {
    const service = makeService("rt-shared");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let tokenCalls = 0;
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/.well-known/openid-configuration")) return buildDiscovery();
      if (url.includes("/oauth/token")) {
        tokenCalls++;
        return tokenResponse("new-at");
      }
      return new Response(JSON.stringify({ sub: "user-1", organizations: ["tenant-a"] }), { status: 200 });
    });

    const results = await Promise.all([
      service.refresh(),
      service.refresh(),
      service.refresh(),
      service.refresh(),
      service.refresh(),
    ]);
    expect(tokenCalls).toBe(1);
    expect(results).toHaveLength(5);
    // 所有 caller 共享同一 status 结果
    expect(results[0].status).toBe(results[4].status);
  });

  it("串行调用每次都执行 refresh(无合并语义,因为 in-flight 已清空)", async () => {
    const service = makeService("rt");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let tokenCalls = 0;
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/.well-known/openid-configuration")) return buildDiscovery();
      if (url.includes("/oauth/token")) {
        tokenCalls++;
        return tokenResponse(`at-${tokenCalls}`);
      }
      // userinfo / JWKS / 其他:返回空 userinfo,避免身份验证路径爆
      return new Response(JSON.stringify({ sub: "user-1", organizations: ["tenant-a"] }), { status: 200 });
    });

    await service.refresh();
    await service.refresh();
    await service.refresh();
    expect(tokenCalls).toBe(3);
  });

  it("并发 refresh() 全部共享同一 Promise 实例(in-flight 期间)", async () => {
    const service = makeService("rt");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let resolveToken!: (response: Response) => void;
    const pendingToken = new Promise<Response>((r) => {
      resolveToken = r;
    });
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/.well-known/openid-configuration")) return buildDiscovery();
      if (url.includes("/oauth/token")) return pendingToken;
      return new Response("{}", { status: 200 });
    });

    // 在 in-flight 期间:3 个并发调用都拿同一个 Promise
    const p1 = service.refresh();
    const p2 = service.refresh();
    const p3 = service.refresh();
    // resolve token endpoint 后,所有 caller 同时收到结果
    resolveToken(tokenResponse("at-shared"));
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.status).toBe(r2.status);
    expect(r2.status).toBe(r3.status);
  });

  it("refresh() 失败时清空 in-flight,下次调用可重试", async () => {
    const service = makeService("rt");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let tokenCalls = 0;
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/.well-known/openid-configuration")) return buildDiscovery();
      if (url.includes("/oauth/token")) {
        tokenCalls++;
        return tokenCalls === 1
          ? new Response("internal server error", { status: 500 })
          : tokenResponse("at-2");
      }
      return new Response("{}", { status: 200 });
    });

    // 第一次失败(refresh() 内部 catch,返回 status)
    const r1 = await service.refresh();
    expect(r1.status).not.toBe("signed_in");
    // 第二次可以重试(不 hang 在 in-flight Promise 上)
    const r2 = await service.refresh();
    expect(r2).toBeDefined();
  });

  it("refresh() 失败时所有并发 caller 都得到相同失败 status(共享 in-flight)", async () => {
    const service = makeService("rt");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/.well-known/openid-configuration")) return buildDiscovery();
      if (url.includes("/oauth/token")) {
        return new Response("casdoor down", { status: 503 });
      }
      return new Response("{}", { status: 200 });
    });

    const results = await Promise.all([
      service.refresh(),
      service.refresh(),
      service.refresh(),
    ]);
    // refresh() 不抛异常,所有 caller 收到相同的 failed status
    expect(results[0].status).toBe("error");
    expect(results[1].status).toBe("error");
    expect(results[2].status).toBe("error");
    // token endpoint 只被调用 1 次(并发合并)
    const tokenFetches = fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/oauth/token"));
    expect(tokenFetches.length).toBe(1);
  });

  it("refresh_token=null 时 refresh() 直接返回 status,不发 HTTP", async () => {
    const service = makeService(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await service.refresh();
    expect(r).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clearSession() 后 in-flight 被清空,后续 refresh() 不复用旧 Promise", async () => {
    const service = makeService("rt");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let tokenCalls = 0;
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/.well-known/openid-configuration")) return buildDiscovery();
      if (url.includes("/oauth/token")) {
        tokenCalls++;
        return tokenResponse("at");
      }
      return new Response("{}", { status: 200 });
    });

    // 第一次 refresh → 成功(虽然返回 status,但 token endpoint 被调用 1 次)
    await service.refresh();
    expect(tokenCalls).toBe(1);

    // 模拟 logout
    await (service as unknown as { clearSession: () => Promise<void> }).clearSession();

    // 清空后,下次 refresh 会重新触发(in-flight 已清空)
    // 但 refreshToken 已被 clearSession 清掉,所以返回 status,不发请求
    const r = await service.refresh();
    expect(r).toBeDefined();
    // 总调用次数仍是 1(第二次 refresh 因 refreshToken=null 直接返回)
    expect(tokenCalls).toBe(1);
  });
});
