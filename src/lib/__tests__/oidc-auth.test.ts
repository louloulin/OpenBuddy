import { describe, it, expect, vi } from "vitest";
import {
  generatePkce,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  parseAuthCallback,
  generateState,
  joseEcdsaSignatureToDer,
  type OidcConfig,
  type HttpPost,
} from "@openbuddy/auth-casdoor";

const config: OidcConfig = {
  authorizationEndpoint: "https://idp.example.com/authorize",
  tokenEndpoint: "https://idp.example.com/token",
  clientId: "test-client",
  redirectUri: "http://localhost:1420/callback",
};

describe("generatePkce", () => {
  it("生成 verifier + challenge(plain 模式)", () => {
    const pkce = generatePkce("my-verifier-123");
    expect(pkce.codeVerifier).toBe("my-verifier-123");
    expect(pkce.codeChallenge).toBe("my-verifier-123");
    expect(pkce.codeChallengeMethod).toBe("plain");
  });
});

describe("buildAuthorizationUrl", () => {
  it("含 response_type=code + client_id + redirect_uri + PKCE + state", () => {
    const pkce = generatePkce("verifier");
    const url = buildAuthorizationUrl(config, pkce, "state123");
    expect(url.startsWith(config.authorizationEndpoint + "?")).toBe(true);
    expect(url).toContain("response_type=code");
    expect(url).toContain("client_id=test-client");
    expect(url).toContain("redirect_uri=http");
    expect(url).toContain("code_challenge=verifier");
    expect(url).toContain("code_challenge_method=plain");
    expect(url).toContain("state=state123");
  });
  it("自定义 scope", () => {
    const url = buildAuthorizationUrl({ ...config, scope: "openid email" }, generatePkce("v"), "s");
    expect(url).toContain("scope=openid+email");
  });
});

describe("exchangeCodeForToken", () => {
  const mockHttp = (json: unknown, ok = true): HttpPost => ({
    post: vi.fn(async () => ({ ok, json })),
  });
  it("成功 → TokenResponse", async () => {
    const http = mockHttp({ access_token: "atk", refresh_token: "rtk", id_token: "itk", expires_in: 3600 });
    const res = await exchangeCodeForToken(config, "authcode", generatePkce("v"), http);
    expect(res?.accessToken).toBe("atk");
    expect(res?.refreshToken).toBe("rtk");
    expect(res?.idToken).toBe("itk");
    expect(res?.expiresIn).toBe(3600);
  });
  it("失败(ok=false)→ null", async () => {
    const http = mockHttp(null, false);
    expect(await exchangeCodeForToken(config, "code", generatePkce("v"), http)).toBeNull();
  });
  it("无 json → null", async () => {
    const http: HttpPost = { post: vi.fn(async () => ({ ok: true })) };
    expect(await exchangeCodeForToken(config, "code", generatePkce("v"), http)).toBeNull();
  });
});

describe("refreshAccessToken", () => {
  it("成功 → 新 access_token", async () => {
    const http: HttpPost = { post: vi.fn(async () => ({ ok: true, json: { access_token: "new-atk", expires_in: 1800 } })) };
    const res = await refreshAccessToken(config, "old-rtk", http);
    expect(res?.accessToken).toBe("new-atk");
  });
  it("失败 → null", async () => {
    const http: HttpPost = { post: vi.fn(async () => ({ ok: false })) };
    expect(await refreshAccessToken(config, "rtk", http)).toBeNull();
  });
});

describe("parseAuthCallback", () => {
  it("解析 code + state", () => {
    const r = parseAuthCallback("http://localhost:1420/callback?code=abc&state=xyz");
    expect(r.code).toBe("abc");
    expect(r.state).toBe("xyz");
  });
  it("解析 error", () => {
    const r = parseAuthCallback("http://localhost:1420/callback?error=access_denied");
    expect(r.error).toBe("access_denied");
    expect(r.code).toBeUndefined();
  });
  it("无效 URL → 空", () => {
    expect(parseAuthCallback("not-a-url")).toEqual({});
  });
});

describe("generateState", () => {
  it("生成长度 64 的十六进制字符串", () => {
    const s = generateState(32);
    expect(s.length).toBe(64);
    expect(/^[0-9a-f]+$/.test(s)).toBe(true);
  });
  it("两次不同", () => {
    expect(generateState()).not.toBe(generateState());
  });
});

describe("joseEcdsaSignatureToDer", () => {
  it("converts raw r || s values to DER integers", () => {
    const raw = new Uint8Array(64);
    raw[0] = 0x80;
    raw[32] = 0x01;
    const der = joseEcdsaSignatureToDer(raw);
    expect(der).not.toBeNull();
    expect(Array.from(der ?? [])).toEqual([0x30, 0x45, 0x02, 0x21, 0x00, 0x80, ...new Array(31).fill(0), 0x02, 0x20, 0x01, ...new Array(31).fill(0)]);
  });

  it("rejects odd-length signatures", () => {
    expect(joseEcdsaSignatureToDer(new Uint8Array(63))).toBeNull();
  });

  it("uses long-form DER lengths for ES512-sized signatures", () => {
    const raw = new Uint8Array(132).fill(0xff);
    const der = joseEcdsaSignatureToDer(raw);
    expect(der?.[0]).toBe(0x30);
    expect(der?.[1]).toBe(0x81);
    expect(der?.[2]).toBe(0x8a);
  });
});
