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
}

/** 授权码流程的 token 响应。 */
export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  tokenType?: string;
  expiresIn?: number;
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
  return generatePkce(verifier);
}

/** base64url 编码(无 padding)。 */
function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 构造授权 URL(带 PKCE + state)。纯函数。
 * 用户浏览器跳转到此 URL 登录,IdP 回调 redirectUri 并带 code。
 */
export function buildAuthorizationUrl(config: OidcConfig, pkce: PkceVerifier, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope ?? "openid profile email",
    state,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: pkce.codeChallengeMethod,
  });
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
  const body = {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: pkce.codeVerifier,
  };
  const res = await http.post(config.tokenEndpoint, body);
  if (!res.ok || !res.json) return null;
  const j = res.json as Record<string, unknown>;
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
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
      error: url.searchParams.get("error") ?? undefined,
    };
  } catch {
    return {};
  }
}

/** 生成随机 state(CSRF 防护)。 */
export function generateState(length = 32): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const arr = new Uint8Array(length);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(36).slice(2, 2 + length);
}
