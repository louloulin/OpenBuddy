/**
 * OpenBuddy Admin Portal · Casdoor OIDC Client
 *
 * 复用 desktop 端 `electron/main/casdoor-auth.ts` 的同一套 OIDC/PKCE 流程，
 * 但去掉 Electron 依赖，纯浏览器实现。
 *
 * 流程：
 * 1. generatePKCE() → 生成 code_verifier / code_challenge
 * 2. authorizeUrl() → 浏览器跳转到 Casdoor /login/oauth/authorize
 * 3. Casdoor 重定向到 /callback?code=...&state=...
 * 4. exchangeCode() → 用 code + verifier 换 access_token
 * 5. fetchUserInfo() → 拉用户信息（subject / displayName / email / roles）
 *
 * 凭据存储：access_token + refresh_token 存 sessionStorage（刷新即丢）
 *           用户偏好（如选中的 tenantId）存 localStorage
 */

export interface OidcConfig {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

export interface OidcTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
  tokenType: string;
}

export interface OidcUserInfo {
  sub: string;
  preferred_username?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  organizations?: string[];
  roles?: string[];
  permissions?: string[];
  capabilities?: string[];
  isAdmin?: boolean;
  customFields?: Record<string, unknown>;
}

const CONFIG_KEY = "openbuddy.oidc.config";
const TOKENS_KEY = "openbuddy.oidc.tokens";
const USER_KEY = "openbuddy.oidc.user";
const PKCE_VERIFIER_KEY = "openbuddy.oidc.pkce_verifier";
const STATE_KEY = "openbuddy.oidc.state";

/** 默认配置（用户可在登录页覆盖）。 */
export const DEFAULT_OIDC_CONFIG: OidcConfig = {
  issuer: import.meta.env.VITE_CASDOOR_ISSUER || "http://localhost:8000",
  clientId: import.meta.env.VITE_CASDOOR_CLIENT_ID || "005d6839fe25abd6696f",
  redirectUri: import.meta.env.VITE_CASDOOR_REDIRECT_URI || `${window.location.origin}/callback`,
  scope: "openid profile email phone offline_access",
};

export function loadOidcConfig(): OidcConfig {
  const raw = sessionStorage.getItem(CONFIG_KEY);
  if (raw) {
    try {
      return { ...DEFAULT_OIDC_CONFIG, ...JSON.parse(raw) };
    } catch {
      // 忽略
    }
  }
  return DEFAULT_OIDC_CONFIG;
}

export function saveOidcConfig(cfg: OidcConfig): void {
  sessionStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export function loadTokens(): OidcTokens | null {
  const raw = sessionStorage.getItem(TOKENS_KEY);
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as OidcTokens;
    if (t.expiresAt > Date.now()) return t;
    sessionStorage.removeItem(TOKENS_KEY);
    return null;
  } catch {
    return null;
  }
}

export function saveTokens(t: OidcTokens): void {
  sessionStorage.setItem(TOKENS_KEY, JSON.stringify(t));
}

export function clearTokens(): void {
  sessionStorage.removeItem(TOKENS_KEY);
  sessionStorage.removeItem(USER_KEY);
}

export function loadUser(): OidcUserInfo | null {
  const raw = sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OidcUserInfo;
  } catch {
    return null;
  }
}

export function saveUser(u: OidcUserInfo): void {
  sessionStorage.setItem(USER_KEY, JSON.stringify(u));
}

/** 生成 PKCE code_verifier / code_challenge (S256). */
export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(hash));
  return { verifier, challenge };
}

export function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
}

/** 构造 Casdoor /login/oauth/authorize URL。 */
export function authorizeUrl(cfg: OidcConfig, challenge: string, state: string): string {
  const url = new URL("/login/oauth/authorize", cfg.issuer);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", cfg.scope);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

/** 把 Casdoor 返回的 authorization code 换 access_token。 */
export async function exchangeCode(
  cfg: OidcConfig,
  code: string,
  verifier: string,
): Promise<OidcTokens> {
  const url = new URL("/api/login/oauth/access_token", cfg.issuer);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cfg.clientId,
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: verifier,
  });
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`OIDC token exchange failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in: number;
    token_type: string;
  };
  return {
    accessToken: json.access_token,
    ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
    ...(json.id_token ? { idToken: json.id_token } : {}),
    expiresAt: Date.now() + json.expires_in * 1000,
    tokenType: json.token_type,
  };
}

/** 拉 Casdoor userinfo（解码 ID token 拿到标准 claim）。 */
export async function fetchUserInfo(cfg: OidcConfig, accessToken: string): Promise<OidcUserInfo> {
  const url = new URL("/api/userinfo", cfg.issuer);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`OIDC userinfo failed: ${res.status}`);
  return (await res.json()) as OidcUserInfo;
}

/** 浏览器跳转到 Casdoor 授权页。 */
export async function startLogin(cfg: OidcConfig): Promise<void> {
  const { verifier, challenge } = await generatePKCE();
  const state = generateState();
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  window.location.href = authorizeUrl(cfg, challenge, state);
}

/** 处理 Casdoor 回调：校验 state + 换 token + 拉 userinfo。 */
export async function handleCallback(searchParams: URLSearchParams): Promise<OidcUserInfo> {
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (!code) throw new Error("OIDC callback missing code");
  if (!state || state !== expectedState) throw new Error("OIDC callback state mismatch");
  if (!verifier) throw new Error("OIDC PKCE verifier missing");
  const cfg = loadOidcConfig();
  const tokens = await exchangeCode(cfg, code, verifier);
  saveTokens(tokens);
  const user = await fetchUserInfo(cfg, tokens.accessToken);
  saveUser(user);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  return user;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 标准化 issuer：去掉尾斜杠。 */
export function normalizeOidcIssuer(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("OIDC issuer 不能为空");
  try {
    const url = new URL(trimmed);
    if (!/^https?:$/.test(url.protocol)) throw new Error("OIDC issuer 必须以 http(s):// 开头");
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch (err) {
    if (err instanceof Error && /必须以/.test(err.message)) throw err;
    throw new Error(`OIDC issuer 非法: ${input}`);
  }
}
