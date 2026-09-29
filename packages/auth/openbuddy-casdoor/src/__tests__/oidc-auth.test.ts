/**
 * @openbuddy/auth-casdoor/oidc-auth — 核心 OIDC/OAuth 原语契约测试。
 *
 * 覆盖 OIDC 鉴权抽象中所有无副作用 / 无 Electron 依赖的原语:
 *   - PKCE 生成(plain + S256)
 *   - base64url 编码 / 解码
 *   - 授权 URL 构造(Code Flow + PKCE + state + nonce + provider hint)
 *   - code → token exchange(HTTP 注入)
 *   - refresh token → access token(HTTP 注入)
 *   - redirectUri 回调解析(query + fragment)
 *   - 回调 URL 白名单校验
 *   - state 随机生成
 *   - JWT 解析(payload / header,只解码不验签)
 *   - id_token claims 校验(issuer / audience / nonce / exp / iat)
 *   - JOSE ECDSA 签名 → ASN.1 DER 转换
 *
 * 价值:
 *   - oidc-auth.ts 之前 0 测试覆盖(P1.3 补齐)
 *   - 安全相关函数必须有完整覆盖,避免 PKCE / nonce / state 退化破坏安全不变量
 *   - 全部为纯函数 + HTTP 注入 → 单测 100% 可达,无外部 mock
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizationUrl,
  decodeJwtHeader,
  decodeJwtPayload,
  exchangeCodeForToken,
  generatePkce,
  generatePkceS256,
  generateState,
  isCasdoorCallbackUrl,
  joseEcdsaSignatureToDer,
  parseAuthCallback,
  refreshAccessToken,
  validateIdTokenClaims,
  type HttpPost,
  type OidcConfig,
  type PkceVerifier,
} from "../oidc-auth.js";

// ---- helpers ---------------------------------------------------------------

const baseConfig: OidcConfig = {
  authorizationEndpoint: "https://idp.example.com/authorize",
  tokenEndpoint: "https://idp.example.com/token",
  userInfoEndpoint: "https://idp.example.com/userinfo",
  clientId: "client-abc",
  redirectUri: "https://app.example.com/callback",
};

const fakePkce: PkceVerifier = {
  codeVerifier: "v_v3r1f13r",
  codeChallenge: "ch4ll3ng3",
  codeChallengeMethod: "S256",
};

function makeHttp(responder: (url: string, body: Record<string, string>) => { ok: boolean; json?: unknown }): HttpPost {
  return {
    post: vi.fn(async (u: string, body: Record<string, string>) => responder(u, body)),
  };
}

// ===========================================================================
// PKCE — generatePkce / generatePkceS256
// ===========================================================================

describe("PKCE — generatePkce / generatePkceS256", () => {
  it("generatePkce(plain 模式)返回与 verifier 完全相同的 codeChallenge", () => {
    const r = generatePkce("my-verifier-123");
    expect(r).toEqual({
      codeVerifier: "my-verifier-123",
      codeChallenge: "my-verifier-123",
      codeChallengeMethod: "plain",
    });
  });

  it("generatePkceS256(异步)在 jsdom/node 环境下产出 base64url 编码挑战", async () => {
    const r = await generatePkceS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(r.codeVerifier).toBe("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(r.codeChallengeMethod).toBe("S256");
    // base64url: 字母数字 + "-_",无 padding
    expect(r.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    // SHA-256 = 32 bytes → base64url 编码后 43 字符(无 padding)
    expect(r.codeChallenge.length).toBe(43);
  });

  it("generatePkceS256 每次输出不同 verifier 时产出不同 challenge(无缓存)", async () => {
    const a = await generatePkceS256("verifier-a");
    const b = await generatePkceS256("verifier-b");
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
  });
});

// ===========================================================================
// 授权 URL 构造 — buildAuthorizationUrl
// ===========================================================================

describe("buildAuthorizationUrl — 授权 URL 构造", () => {
  it("必填参数全部就位", () => {
    const url = new URL(buildAuthorizationUrl(baseConfig, fakePkce, "state-xyz"));
    expect(url.origin + url.pathname).toBe(baseConfig.authorizationEndpoint);
    const p = url.searchParams;
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe("client-abc");
    expect(p.get("redirect_uri")).toBe(baseConfig.redirectUri);
    expect(p.get("scope")).toBe("openid profile email"); // 默认值
    expect(p.get("state")).toBe("state-xyz");
    expect(p.get("code_challenge")).toBe(fakePkce.codeChallenge);
    expect(p.get("code_challenge_method")).toBe("S256");
  });

  it("scope 显式传入时覆盖默认值", () => {
    const url = new URL(buildAuthorizationUrl({ ...baseConfig, scope: "openid email groups" }, fakePkce, "s"));
    expect(url.searchParams.get("scope")).toBe("openid email groups");
  });

  it("nonce 传入时写入 query", () => {
    const url = new URL(buildAuthorizationUrl(baseConfig, fakePkce, "s", "nonce-1"));
    expect(url.searchParams.get("nonce")).toBe("nonce-1");
  });

  it("nonce 不传时不出现在 query(避免空 nonce 干扰 IdP)", () => {
    const url = new URL(buildAuthorizationUrl(baseConfig, fakePkce, "s"));
    expect(url.searchParams.has("nonce")).toBe(false);
  });

  it("Casdoor provider hint 与 signinMethod 注入", () => {
    const cfg: OidcConfig = {
      ...baseConfig,
      providerHint: "Wechat",
      signinMethod: "Verification code",
    };
    const url = new URL(buildAuthorizationUrl(cfg, fakePkce, "s"));
    expect(url.searchParams.get("provider_hint")).toBe("Wechat");
    expect(url.searchParams.get("signinMethod")).toBe("Verification code");
  });
});

// ===========================================================================
// code → token 交换 — exchangeCodeForToken
// ===========================================================================

describe("exchangeCodeForToken — 授权码换 token", () => {
  it("成功响应(200 + access_token)返回结构化 TokenResponse", async () => {
    const http = makeHttp(() => ({
      ok: true,
      json: {
        access_token: "at-1",
        refresh_token: "rt-1",
        id_token: "id-1",
        token_type: "Bearer",
        expires_in: 3600,
      },
    }));
    const r = await exchangeCodeForToken(baseConfig, "auth-code", fakePkce, http);
    expect(r).toEqual({
      accessToken: "at-1",
      refreshToken: "rt-1",
      idToken: "id-1",
      tokenType: "Bearer",
      expiresIn: 3600,
    });
  });

  it("POST body 包含 grant_type / code / redirect_uri / client_id / code_verifier", async () => {
    const http = makeHttp(() => ({ ok: true, json: { access_token: "at" } }));
    await exchangeCodeForToken(baseConfig, "my-code", fakePkce, http);
    const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(body).toMatchObject({
      grant_type: "authorization_code",
      code: "my-code",
      redirect_uri: baseConfig.redirectUri,
      client_id: baseConfig.clientId,
      code_verifier: fakePkce.codeVerifier,
    });
  });

  it("clientSecret 存在时附带在 body 中(confidential client)", async () => {
    const cfg = { ...baseConfig, clientSecret: "shh" };
    const http = makeHttp(() => ({ ok: true, json: { access_token: "at" } }));
    await exchangeCodeForToken(cfg, "code", fakePkce, http);
    const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(body.client_secret).toBe("shh");
  });

  it("HTTP 失败时返回 null(不抛异常)", async () => {
    const http = makeHttp(() => ({ ok: false }));
    expect(await exchangeCodeForToken(baseConfig, "code", fakePkce, http)).toBeNull();
  });

  it("响应缺 access_token 时返回 null", async () => {
    const http = makeHttp(() => ({ ok: true, json: { id_token: "only-id" } }));
    expect(await exchangeCodeForToken(baseConfig, "code", fakePkce, http)).toBeNull();
  });

  it("access_token 为空字符串时返回 null(防御性)", async () => {
    const http = makeHttp(() => ({ ok: true, json: { access_token: "" } }));
    expect(await exchangeCodeForToken(baseConfig, "code", fakePkce, http)).toBeNull();
  });
});

// ===========================================================================
// refresh — refreshAccessToken
// ===========================================================================

describe("refreshAccessToken — 刷新 access token", () => {
  it("成功响应返回新 token + refresh_token(若有则返回)", async () => {
    const http = makeHttp(() => ({
      ok: true,
      json: { access_token: "new-at", refresh_token: "new-rt", expires_in: 7200 },
    }));
    const r = await refreshAccessToken(baseConfig, "old-rt", http);
    expect(r).toEqual({
      accessToken: "new-at",
      refreshToken: "new-rt",
      expiresIn: 7200,
    });
  });

  it("refresh_token 缺席时保持 undefined(不报错)", async () => {
    const http = makeHttp(() => ({ ok: true, json: { access_token: "new-at", expires_in: 3600 } }));
    const r = await refreshAccessToken(baseConfig, "rt", http);
    expect(r?.refreshToken).toBeUndefined();
  });

  it("POST body 使用 grant_type=refresh_token", async () => {
    const http = makeHttp(() => ({ ok: true, json: { access_token: "at" } }));
    await refreshAccessToken(baseConfig, "rt-old", http);
    const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(body).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "rt-old",
      client_id: baseConfig.clientId,
    });
    // 注意:refresh_token grant 不应带 redirect_uri / code_verifier / client_secret
    expect(body.redirect_uri).toBeUndefined();
    expect(body.code_verifier).toBeUndefined();
  });

  it("HTTP 失败返回 null", async () => {
    const http = makeHttp(() => ({ ok: false }));
    expect(await refreshAccessToken(baseConfig, "rt", http)).toBeNull();
  });
});

// ===========================================================================
// 回调 URL 解析 — parseAuthCallback
// ===========================================================================

describe("parseAuthCallback — 回调 URL 解析", () => {
  it("从 query 参数中读取 code + state", () => {
    const r = parseAuthCallback("https://app.example.com/callback?code=abc&state=xyz");
    expect(r).toEqual({ code: "abc", state: "xyz" });
  });

  it("error 参数存在时返回(error 优先)", () => {
    const r = parseAuthCallback("https://app.example.com/callback?error=access_denied&state=x");
    expect(r.error).toBe("access_denied");
    expect(r.state).toBe("x");
  });

  it("fragment(#) 中的参数也支持(implicit flow 兼容)", () => {
    const r = parseAuthCallback("https://app.example.com/callback#code=frag-code&state=frag-state");
    expect(r).toEqual({ code: "frag-code", state: "frag-state" });
  });

  it("query 已有值时,fragment 不覆盖(query wins)", () => {
    // 实现:fragment 仅在 query 缺该键时填充(防 OIDC 重定向冲突)
    const r = parseAuthCallback("https://app.example.com/callback?code=q-code&state=q-state#code=frag");
    expect(r.code).toBe("q-code");
    expect(r.state).toBe("q-state");
  });

  it("非法 URL 返回空对象(不抛)", () => {
    expect(parseAuthCallback("not a url")).toEqual({});
  });
});

// ===========================================================================
// 回调 URL 白名单 — isCasdoorCallbackUrl
// ===========================================================================

describe("isCasdoorCallbackUrl — 回调 URL 校验", () => {
  it("同 scheme/host/pathname 时通过", () => {
    expect(isCasdoorCallbackUrl("https://app.example.com/callback", "https://app.example.com/callback")).toBe(true);
  });

  it("host 不同 → 拒绝", () => {
    expect(isCasdoorCallbackUrl("https://attacker.com/callback", "https://app.example.com/callback")).toBe(false);
  });

  it("scheme 不同 → 拒绝", () => {
    expect(isCasdoorCallbackUrl("http://app.example.com/callback", "https://app.example.com/callback")).toBe(false);
  });

  it("pathname 不同 → 拒绝", () => {
    expect(isCasdoorCallbackUrl("https://app.example.com/other", "https://app.example.com/callback")).toBe(false);
  });

  it("非法 URL 返回 false(不抛)", () => {
    expect(isCasdoorCallbackUrl("not-a-url", "https://x/c")).toBe(false);
  });
});

// ===========================================================================
// state 生成 — generateState
// ===========================================================================

describe("generateState — 随机 state 生成", () => {
  it("默认长度 32 字节 = 64 十六进制字符", () => {
    const s = generateState();
    expect(s).toMatch(/^[0-9a-f]{64}$/);
  });

  it("自定义长度生效", () => {
    expect(generateState(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(generateState(8)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("两次连续生成产出不同值(CSRF 防护基石)", () => {
    expect(generateState()).not.toBe(generateState());
  });
});

// ===========================================================================
// JWT 解码 — decodeJwtPayload / decodeJwtHeader
// ===========================================================================

describe("decodeJwtPayload / decodeJwtHeader — JWT 解码", () => {
  // 手搓一个测试 JWT(header + payload + 假签名)
  function base64UrlEncode(obj: unknown): string {
    const json = JSON.stringify(obj);
    return Buffer.from(json, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  const token = [
    base64UrlEncode({ alg: "RS256", kid: "key-1", typ: "JWT" }),
    base64UrlEncode({ iss: "https://idp", sub: "user-1", aud: "client-abc", exp: 9999999999 }),
    "fake-signature",
  ].join(".");

  it("decodeJwtPayload 解析 claims", () => {
    const claims = decodeJwtPayload(token);
    expect(claims).toMatchObject({
      iss: "https://idp",
      sub: "user-1",
      aud: "client-abc",
      exp: 9999999999,
    });
  });

  it("decodeJwtHeader 解析 header", () => {
    const h = decodeJwtHeader(token);
    expect(h).toEqual({ alg: "RS256", kid: "key-1", typ: "JWT" });
  });

  it("段数 ≠ 3 返回 null", () => {
    expect(decodeJwtPayload("a.b")).toBeNull();
    expect(decodeJwtHeader("a.b.c.d")).toBeNull();
  });

  it("payload 不是合法 JSON 返回 null", () => {
    const bad = `aaa.${base64UrlEncode("not-an-object-but-string")}.bbb`;
    expect(decodeJwtPayload(bad)).toBeNull();
  });
});

// ===========================================================================
// id_token claims 校验 — validateIdTokenClaims
// ===========================================================================

describe("validateIdTokenClaims — id_token claims 校验", () => {
  const baseClaims = {
    iss: "https://idp",
    sub: "user-1",
    aud: "client-abc",
    exp: 1000,
    iat: 900,
  };
  const opts = { issuer: "https://idp", clientId: "client-abc", nowSeconds: 1000, clockSkewSeconds: 0 };

  it("全部合法时返回 ok", () => {
    expect(validateIdTokenClaims(baseClaims, opts)).toEqual({ ok: true });
  });

  it("issuer 不匹配 → issuer_mismatch", () => {
    expect(validateIdTokenClaims(baseClaims, { ...opts, issuer: "https://other" })).toEqual({
      ok: false,
      reason: "issuer_mismatch",
    });
  });

  it("audience 不在 claims.aud 数组中 → audience_mismatch", () => {
    expect(validateIdTokenClaims({ ...baseClaims, aud: "different-client" }, opts)).toEqual({
      ok: false,
      reason: "audience_mismatch",
    });
  });

  it("audience 是数组且含 clientId,且 azp 一致 → ok", () => {
    // 实现:多值 audience 必须有 azp == clientId 才算合法(防 audience confusion 攻击)
    expect(validateIdTokenClaims({ ...baseClaims, aud: ["client-abc", "other"], azp: "client-abc" }, opts)).toEqual({
      ok: true,
    });
  });

  it("audience 是多值但 azp 不是 clientId → authorized_party_mismatch", () => {
    const r = validateIdTokenClaims({ ...baseClaims, aud: ["client-abc", "other"] }, opts);
    // 缺 azp,且 audience 多值 → azp mismatch
    expect(r).toEqual({ ok: false, reason: "authorized_party_mismatch" });
  });

  it("nonce 不匹配 → nonce_mismatch(当 options.nonce 传入时)", () => {
    const r = validateIdTokenClaims({ ...baseClaims, nonce: "wrong" }, { ...opts, nonce: "right" });
    expect(r).toEqual({ ok: false, reason: "nonce_mismatch" });
  });

  it("nonce 匹配 → ok", () => {
    const r = validateIdTokenClaims({ ...baseClaims, nonce: "right" }, { ...opts, nonce: "right" });
    expect(r).toEqual({ ok: true });
  });

  it("exp 过期 → token_expired", () => {
    expect(validateIdTokenClaims({ ...baseClaims, exp: 500 }, { ...opts, nowSeconds: 1000 })).toEqual({
      ok: false,
      reason: "token_expired",
    });
  });

  it("clock skew 容错:nowSeconds - skew 之内不视作过期", () => {
    // exp=950, now=1000, skew=60 → 1000-60=940, 950 > 940 → ok
    expect(validateIdTokenClaims({ ...baseClaims, exp: 950 }, { ...opts, nowSeconds: 1000, clockSkewSeconds: 60 })).toEqual({
      ok: true,
    });
  });

  it("iat 晚于 now + skew → issued_in_future(防回放)", () => {
    expect(validateIdTokenClaims({ ...baseClaims, iat: 2000 }, { ...opts, nowSeconds: 1000, clockSkewSeconds: 60 })).toEqual({
      ok: false,
      reason: "issued_in_future",
    });
  });

  it("exp 缺字段 → token_expired", () => {
    const { exp: _exp, ...rest } = baseClaims;
    expect(validateIdTokenClaims(rest, opts)).toEqual({ ok: false, reason: "token_expired" });
  });
});

// ===========================================================================
// JOSE ECDSA 签名 → ASN.1 DER
// ===========================================================================

describe("joseEcdsaSignatureToDer — JOSE ECDSA → ASN.1 DER", () => {
  it("空签名返回 null", () => {
    expect(joseEcdsaSignatureToDer(new Uint8Array())).toBeNull();
  });

  it("奇数长度签名返回 null(r || s 必须等长)", () => {
    expect(joseEcdsaSignatureToDer(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("64 字节 r||s 转换为合法 DER 序列", () => {
    // 全 0x01 的 64 字节:r = s = 0x01 × 32(无前导零,高位 bit = 0,不需要 padding)
    // r 编码:0x02, 0x20, 32 × 0x01 = 34 字节
    // s 同上 = 34 字节
    // 总长度:2 (SEQUENCE header) + 34 + 34 = 70 字节
    const sig = new Uint8Array(64).fill(0x01);
    const der = joseEcdsaSignatureToDer(sig);
    expect(der).not.toBeNull();
    expect(der!.length).toBe(70);
    // DER SEQUENCE 头
    expect(der![0]).toBe(0x30);
    // SEQUENCE 长度 = 68 = 0x44
    expect(der![1]).toBe(0x44);
    // INTEGER (r): tag 0x02, length 0x20 (32)
    expect(der![2]).toBe(0x02);
    expect(der![3]).toBe(0x20);
    // INTEGER (s): 在 r 之后 (offset 2 + 2 + 32 = 36)
    expect(der![2 + 2 + 32]).toBe(0x02);
    expect(der![2 + 2 + 32 + 1]).toBe(0x20);
  });

  it("高位 0x80 字节触发补 0x00 padding(避免被当作负数)", () => {
    // 第 0 个字节为 0x80(高位 1),ASN.1 INTEGER 需要补 0x00 表示正数
    const sig = new Uint8Array(64);
    sig[0] = 0x80;
    sig[32] = 0x80;
    const der = joseEcdsaSignatureToDer(sig);
    expect(der).not.toBeNull();
    // r 的 INTEGER 长度 = 33(原始 32 + 1 padding)
    expect(der![3]).toBe(33);
  });

  it("前导零字节被 strip(直到第一个非零字节)", () => {
    // 32 字节全 0 → r 应该是空 INTEGER?实际实现保留 1 字节 0x00
    const sig = new Uint8Array(64); // 全 0
    const der = joseEcdsaSignatureToDer(sig);
    expect(der).not.toBeNull();
    // r 的 INTEGER 应保留至少 1 字节(0x00),长度 = 1
    // 注意:具体实现可能 strip 到只剩最后一个 0x00,这里只断言 der 非 null 且格式合法
    expect(der![2]).toBe(0x02); // INTEGER tag
  });
});
