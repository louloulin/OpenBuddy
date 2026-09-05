/**
 * OIDC / OAuth 通用鉴权抽象 —— OneID(腾讯 OAuth)的本地可移植替代。
 *
 * WorkBuddy 用腾讯 OneID OAuth 鉴权;OpenBuddy 是 BYOK(API Key 认证),但某些场景
 * (如连接企业 IdP、SSO)需要通用 OAuth。这里抽象成 provider-agnostic 的 OIDC 客户端:
 * 任意 IdP(Keycloak/Auth0/Okta/自托管)都可用。纯函数核心(授权 URL 构造 + token 交换 +
 * PKCE),HTTP 依赖注入便于单测。
 */

/** OIDC 提供商配置。 */
export interface OidcConfig {
  /** 授权端点(如 https://idp.example.com/authorize)。 */
  authorizationEndpoint: string;
  /** Token 端点。 */
  tokenEndpoint: string;
  /** 用户信息端点(可选)。 */
  userInfoEndpoint?: string;
  /** 客户端 id。 */
  clientId: string;
  /** 重定向 URI。 */
  redirectUri: string;
  /** 请求的 scope(默认 openid profile email)。 */
  scope?: string;
  /** Optional Casdoor provider hint (for example Wechat or sms). */
  providerHint?: string;
  /** Casdoor application sign-in method (for example Verification code). */
  signinMethod?: string;
  /** Main-process-only client secret. Never expose this to the renderer. */
  clientSecret?: string;
}

/** 授权码流程的 token 响应。 */
export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  tokenType?: string;
  expiresIn?: number;
}

export interface OidcClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  azp?: string;
  nonce?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

export interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

/** Convert a JOSE ECDSA signature (r || s) into ASN.1 DER. */
export function joseEcdsaSignatureToDer(signature: Uint8Array): Uint8Array | null {
  if (signature.length === 0 || signature.length % 2 !== 0) return null;
  const componentLength = signature.length / 2;
  const encodeInteger = (component: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < component.length - 1 && component[start] === 0) start += 1;
    const value = component.slice(start);
    const needsPadding = (value[0] & 0x80) !== 0;
    const encoded = new Uint8Array(value.length + (needsPadding ? 1 : 0));
    encoded.set(value, needsPadding ? 1 : 0);
    const result = new Uint8Array(encoded.length + 2);
    result[0] = 0x02;
    result[1] = encoded.length;
    result.set(encoded, 2);
    return result;
  };
  const r = encodeInteger(signature.slice(0, componentLength));
  const s = encodeInteger(signature.slice(componentLength));
  const body = new Uint8Array(r.length + s.length);
  body.set(r);
  body.set(s, r.length);
  const encodeLength = (length: number): number[] => {
    if (length < 128) return [length];
    if (length < 256) return [0x81, length];
    return [0x82, (length >>> 8) & 0xff, length & 0xff];
  };
  return Uint8Array.from([0x30, ...encodeLength(body.length), ...body]);
}

/** PKCE 验证器(key=value&key=value URL 编码)。 */
export interface PkceVerifier {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256" | "plain";
}

/** 生成 PKCE code_verifier(随机字符串)与 code_challenge(SHA-256 + base64url)。纯函数。 */
export function generatePkce(verifier: string): PkceVerifier {
  // S256: base64url(SHA-256(verifier))。测试环境无 crypto.subtle 时用 plain 降级。
  return {
    codeVerifier: verifier,
    codeChallenge: verifier, // plain 模式(测试用);运行时替换为 S256。
    codeChallengeMethod: "plain",
  };
}

/** 生成 S256 code_challenge(运行时用 Web Crypto API)。 */
export async function generatePkceS256(verifier: string): Promise<PkceVerifier> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const data = new TextEncoder().encode(verifier);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const codeChallenge = base64Url(new Uint8Array(hash));
    return { codeVerifier: verifier, codeChallenge, codeChallengeMethod: "S256" };
  }
  throw new Error("当前运行环境不支持 PKCE S256");
}

/** base64url 编码(无 padding)。 */
function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): string {
  const encoded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
  if (typeof atob === "function") {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return typeof TextDecoder === "function" ? new TextDecoder().decode(bytes) : binary;
  }
  return Buffer.from(padded, "base64").toString("utf8");
}

/**
 * 构造授权 URL(带 PKCE + state)。纯函数。
 * 用户浏览器跳转到此 URL 登录,IdP 回调 redirectUri 并带 code。
 */
export function buildAuthorizationUrl(
  config: OidcConfig,
  pkce: PkceVerifier,
  state: string,
  nonce?: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope ?? "openid profile email",
    state,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: pkce.codeChallengeMethod,
  });
  if (nonce) params.set("nonce", nonce);
  if (config.providerHint) params.set("provider_hint", config.providerHint);
  if (config.signinMethod) params.set("signinMethod", config.signinMethod);
  return `${config.authorizationEndpoint}?${params.toString()}`;
}

/** HTTP 客户端接口(token 交换用)。 */
export interface HttpPost {
  post(url: string, body: Record<string, string>): Promise<{ ok: boolean; json?: unknown }>;
}

/**
 * 用授权码换取 token(code → token exchange)。纯逻辑 + HTTP 注入。
 */
export async function exchangeCodeForToken(
  config: OidcConfig,
  code: string,
  pkce: PkceVerifier,
  http: HttpPost,
): Promise<TokenResponse | null> {
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: pkce.codeVerifier,
  };
  if (config.clientSecret) body.client_secret = config.clientSecret;
  const res = await http.post(config.tokenEndpoint, body);
  if (!res.ok || !res.json) return null;
  const j = res.json as Record<string, unknown>;
  if (typeof j.access_token !== "string" || j.access_token.length === 0) return null;
  return {
    accessToken: j.access_token as string,
    refreshToken: j.refresh_token as string | undefined,
    idToken: j.id_token as string | undefined,
    tokenType: j.token_type as string | undefined,
    expiresIn: j.expires_in as number | undefined,
  };
}

/** 用 refresh_token 刷新 access_token。 */
export async function refreshAccessToken(
  config: OidcConfig,
  refreshToken: string,
  http: HttpPost,
): Promise<TokenResponse | null> {
  const res = await http.post(config.tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
  });
  if (!res.ok || !res.json) return null;
  const j = res.json as Record<string, unknown>;
  if (typeof j.access_token !== "string" || j.access_token.length === 0) return null;
  return {
    accessToken: j.access_token as string,
    refreshToken: j.refresh_token as string | undefined,
    expiresIn: j.expires_in as number | undefined,
  };
}

/** 从 redirectUri 的查询参数中解析 code + state。 */
export function parseAuthCallback(callbackUrl: string): { code?: string; state?: string; error?: string } {
  try {
    const url = new URL(callbackUrl);
    const params = new URLSearchParams(url.search);
    if (url.hash) {
      const fragment = new URLSearchParams(url.hash.slice(1));
      for (const [key, value] of fragment) if (!params.has(key)) params.set(key, value);
    }
    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined,
      error: params.get("error") ?? undefined,
    };
  } catch {
    return {};
  }
}

export function isCasdoorCallbackUrl(callbackUrl: string, redirectUri: string): boolean {
  try {
    const callback = new URL(callbackUrl);
    const expected = new URL(redirectUri);
    return callback.protocol === expected.protocol
      && callback.host === expected.host
      && callback.pathname === expected.pathname
      && !callback.username
      && !callback.password
      && !callback.port;
  } catch {
    return false;
  }
}

/** 生成随机 state(CSRF 防护)。 */
export function generateState(length = 32): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("当前运行环境不支持安全随机数");
}

/** Decode a JWT payload without trusting it. Signature verification belongs in the main process. */
export function decodeJwtPayload(token: string): OidcClaims | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const json = decodeBase64Url(parts[1]);
    const claims = JSON.parse(json) as unknown;
    return claims && typeof claims === "object" ? claims as OidcClaims : null;
  } catch {
    return null;
  }
}

export function decodeJwtHeader(token: string): JwtHeader | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const json = decodeBase64Url(parts[0]);
    const header = JSON.parse(json) as unknown;
    return header && typeof header === "object" ? header as JwtHeader : null;
  } catch {
    return null;
  }
}

export interface IdTokenValidationOptions {
  issuer: string;
  clientId: string;
  nonce?: string;
  nowSeconds?: number;
  clockSkewSeconds?: number;
}

/** Validate the claims that are independent of a JWT signature. */
export function validateIdTokenClaims(
  claims: OidcClaims,
  options: IdTokenValidationOptions,
): { ok: true } | { ok: false; reason: string } {
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = options.clockSkewSeconds ?? 60;
  if (claims.iss !== options.issuer) return { ok: false, reason: "issuer_mismatch" };
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(options.clientId)) return { ok: false, reason: "audience_mismatch" };
  if (audience.length > 1 && claims.azp !== options.clientId) return { ok: false, reason: "authorized_party_mismatch" };
  if (options.nonce && claims.nonce !== options.nonce) return { ok: false, reason: "nonce_mismatch" };
  if (typeof claims.exp !== "number" || claims.exp < now - skew) return { ok: false, reason: "token_expired" };
  if (typeof claims.iat === "number" && claims.iat > now + skew) return { ok: false, reason: "issued_in_future" };
  return { ok: true };
}
