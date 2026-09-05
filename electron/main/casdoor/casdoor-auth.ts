import { app, safeStorage, shell } from "electron";
import { readFile, rm } from "node:fs/promises";
import { createPublicKey, createVerify } from "node:crypto";
import { join } from "node:path";
import { openStorageSync, SettingsDocumentStore } from "@openbuddy/storage";
import {
  buildAuthorizationUrl,
  decodeJwtPayload,
  decodeJwtHeader,
  generatePkceS256,
  generateState,
  isCasdoorCallbackUrl,
  joseEcdsaSignatureToDer,
  parseAuthCallback,
  validateIdTokenClaims,
  type OidcConfig,
  type TokenResponse,
} from "@openbuddy/auth-casdoor";
import { mergeCasdoorClaims, normalizeCasdoorClaims, restrictCasdoorClaimsFromUserinfo, type CasdoorCapability, type CasdoorIdentity } from "@openbuddy/auth-casdoor";
import { authorizeCasdoorTenant, buildCasdoorTenantContext, casdoorTenantMembership, type CasdoorAuthorizationDecision, type CasdoorAuthorizationRequirement, type CasdoorResourceAuthorizationRequest } from "@openbuddy/auth-casdoor";
import { casdoorAudit } from "./casdoor-audit";
import { casdoorCapabilityError, deriveCasdoorLoginCapabilities, type CasdoorApplicationLoginInfo, type CasdoorLoginCapabilities } from "@openbuddy/auth-casdoor";
import type { CasdoorLifecycleKind } from "@openbuddy/auth-casdoor";

// Casdoor 配置默认值的来源是「profile + 环境变量」,源代码中不保留任何硬编码 IP / client id。
// 选择顺序:`OPENBUDDY_CASDOOR_PROFILE` → `OPENBUDDY_CASDOOR_ISSUER` / `_CLIENT_ID` / `_REDIRECT_URI` → 用户持久化 → profile 兜底。
// 兜底字符串全部留空,业务层通过 `readConfig()` 的 `configured: false` + `reason` 提示用户必须显式配置。
// 生产部署必须设置 `OPENBUDDY_CASDOOR_ISSUER` / `OPENBUDDY_CASDOOR_CLIENT_ID` / `OPENBUDDY_CASDOOR_MANAGEMENT_URL`,
// 不要依赖任何内置默认值;`deploy/casdoor.env.example` 是模板。
const CASDOOR_PROFILES = {
  // dev profile 只用于本地联调场景;issuer / clientId 全部留空,必须由 `OPENBUDDY_CASDOOR_*` 环境变量提供。
  dev: {
    issuer: "",
    clientId: "",
    redirectUri: "casdoor://localhost/callback",
  },
  // selfHosted 同样留空,部署者在 `deploy/casdoor.env.example` 中显式填入自己的 Casdoor 实例。
  selfHosted: {
    issuer: "",
    clientId: "",
    redirectUri: "casdoor://localhost/callback",
  },
} as const;

type CasdoorProfileName = keyof typeof CASDOOR_PROFILES;

function resolveCasdoorProfile(): CasdoorProfileName {
  const raw = process.env.OPENBUDDY_CASDOOR_PROFILE;
  if (raw === "dev" || raw === "selfHosted") return raw;
  // 默认 dev profile 仅在 `NODE_ENV !== "production"` 时生效;生产构建强制 selfHosted 占位。
  if (process.env.NODE_ENV === "production") return "selfHosted";
  return "dev";
}

const CASDOOR_PROFILE = CASDOOR_PROFILES[resolveCasdoorProfile()];
const DEFAULT_ISSUER = CASDOOR_PROFILE.issuer;
const DEFAULT_CLIENT_ID = CASDOOR_PROFILE.clientId;
const DEFAULT_REDIRECT_URI = CASDOOR_PROFILE.redirectUri;
const SESSION_FILE = "casdoor-session.json";
const CONFIG_FILE = "casdoor-config.json";
const CONFIG_NAMESPACE = "casdoor:config";
const SESSION_NAMESPACE = "casdoor:session";
const SESSION_STORAGE_APP_VERSION = "openbuddy-casdoor-auth";
const LEGACY_CONFIG_FILE = "casdoor-config.json";
const LEGACY_SESSION_FILE = "casdoor-session.json";

let authSettingsStore: SettingsDocumentStore | null = null;

function authStoragePath(): string {
  return join(app.getPath("userData"), "openbuddy.sqlite");
}

function openAuthSettingsStore(): SettingsDocumentStore {
  if (authSettingsStore) return authSettingsStore;
  const opened = openStorageSync({ filePath: authStoragePath(), appVersion: SESSION_STORAGE_APP_VERSION });
  authSettingsStore = new SettingsDocumentStore(opened.driver);
  return authSettingsStore;
}

export function resetAuthSettingsStoreForTests(): void {
  authSettingsStore = null;
}
const FLOW_TIMEOUT_MS = 10 * 60_000;
const EXPIRY_SKEW_SECONDS = 60;
const NETWORK_TIMEOUT_MS = 15_000;
const LOGIN_CAPABILITIES_TTL_MS = 60_000;

type CasdoorEndpoints = {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  introspection_endpoint?: string;
  jwks_uri?: string;
};

export interface CasdoorAuthConfig {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  smsProviderHint: string;
  wechatProviderHint: string;
  managementUrl: string;
  enforcerId?: string;
  configured: boolean;
  reason?: string;
}

export interface CasdoorSessionView {
  status: "signed_out" | "signed_in" | "configuration_needed" | "error";
  config: CasdoorAuthConfig;
  identity: CasdoorIdentity | null;
  expiresAt?: number;
  provider?: string;
  pendingProvider?: string;
  error?: string;
  tenantContext: ReturnType<typeof buildCasdoorTenantContext>;
}

export interface WeKnoraExchangeToken {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  audience: string;
  tenantId: string;
}

type PersistedConfig = Partial<Omit<CasdoorAuthConfig, "configured" | "reason">>;
type PersistedSession = { refreshToken: string; expiresAt?: number; provider?: string; activeTenantId?: string };
type PendingFlow = { state: string; nonce: string; verifier: string; provider?: string; expiresAt: number; endpoints: CasdoorEndpoints; config: OidcConfig };

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function firstText(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return /^https?:$/i.test(url.protocol) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function isValidRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.toLowerCase() === "casdoor:"
      && url.hostname.toLowerCase() === "localhost"
      && !url.port
      && !url.username
      && !url.password
      && url.pathname === "/callback"
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function safeJsonParse<T>(value: string | undefined): T | null {
  try {
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
}

function legacyConfigPath(): string {
  return join(app.getPath("userData"), LEGACY_CONFIG_FILE);
}

function legacySessionPath(): string {
  return join(app.getPath("userData"), LEGACY_SESSION_FILE);
}

async function readPersistedConfig(): Promise<PersistedConfig | null> {
  const store = openAuthSettingsStore();
  const stored = store.get(CONFIG_NAMESPACE);
  if (stored && typeof stored === "object" && Object.keys(stored).length > 0) {
    return stored as PersistedConfig;
  }
  let raw: string;
  try {
    raw = await readFile(legacyConfigPath(), "utf8");
  } catch {
    return null; // file does not exist (first launch)
  }
  try {
    const parsed = safeJsonParse<PersistedConfig>(raw);
    if (parsed) {
      store.set(CONFIG_NAMESPACE, parsed as Record<string, unknown>);
      try { await rm(legacyConfigPath(), { force: true }); } catch { /* best effort */ }
    } else {
      try { await rm(legacyConfigPath(), { force: true }); } catch { /* best effort */ }
    }
    return parsed;
  } catch {
    try { await rm(legacyConfigPath(), { force: true }); } catch { /* best effort */ }
    return null;
  }
}

function writePersistedConfig(next: PersistedConfig): void {
  openAuthSettingsStore().set(CONFIG_NAMESPACE, next as Record<string, unknown>);
}

async function readPersistedSession(): Promise<PersistedSession | null> {
  const store = openAuthSettingsStore();
  const stored = store.get(SESSION_NAMESPACE);
  if (stored && typeof stored === "object" && Object.keys(stored).length > 0) {
    return stored as unknown as PersistedSession;
  }
  let raw: string;
  try {
    raw = await readFile(legacySessionPath(), "utf8");
  } catch {
    return null; // file does not exist (first launch)
  }
  try {
    const parsed = safeJsonParse<PersistedSession>(raw);
    if (parsed && typeof parsed.refreshToken === "string" && parsed.refreshToken.length > 0) {
      store.set(SESSION_NAMESPACE, parsed as unknown as Record<string, unknown>);
      try { await rm(legacySessionPath(), { force: true }); } catch { /* best effort */ }
    } else {
      try { await rm(legacySessionPath(), { force: true }); } catch { /* best effort */ }
    }
    return parsed;
  } catch {
    try { await rm(legacySessionPath(), { force: true }); } catch { /* best effort */ }
    return null;
  }
}

function writePersistedSession(data: PersistedSession): void {
  openAuthSettingsStore().set(SESSION_NAMESPACE, data as unknown as Record<string, unknown>);
}

async function clearPersistedSession(): Promise<void> {
  openAuthSettingsStore().delete(SESSION_NAMESPACE);
  try { await rm(legacySessionPath(), { force: true }); } catch { /* best effort */ }
}

export class CasdoorAuthService {
  private readonly pending = new Map<string, PendingFlow>();
  private config: CasdoorAuthConfig;
  private endpoints: CasdoorEndpoints | null = null;
  private identity: CasdoorIdentity | null = null;
  private accessToken: string | null = null;
  private expiresAt: number | undefined;
  private provider: string | undefined;
  private lastError: string | undefined;
  private refreshToken: string | null = null;
  private activeTenantId: string | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private loginCapabilities: CasdoorLoginCapabilities | null = null;
  private statusListener: ((kind: CasdoorLifecycleKind) => void) | null = null;

  constructor() {
    this.config = this.defaultConfig();
  }

  setStatusListener(listener: ((kind: CasdoorLifecycleKind) => void) | null): void {
    this.statusListener = listener;
  }

  private notifyStatusChange(kind: CasdoorLifecycleKind = "state-change"): void {
    this.statusListener?.(kind);
  }

  private userDataPath(file: string): string {
    return join(app.getPath("userData"), file);
  }

  private async readConfig(): Promise<CasdoorAuthConfig> {
    const environment: PersistedConfig = {
      issuer: process.env.OPENBUDDY_CASDOOR_ISSUER,
      clientId: process.env.OPENBUDDY_CASDOOR_CLIENT_ID,
      redirectUri: process.env.OPENBUDDY_CASDOOR_REDIRECT_URI,
      scope: process.env.OPENBUDDY_CASDOOR_SCOPE,
      smsProviderHint: process.env.OPENBUDDY_CASDOOR_SMS_HINT,
      wechatProviderHint: process.env.OPENBUDDY_CASDOOR_WECHAT_HINT,
      managementUrl: process.env.OPENBUDDY_CASDOOR_MANAGEMENT_URL,
      enforcerId: process.env.OPENBUDDY_CASDOOR_ENFORCER_ID,
    };
    const persisted = await readPersistedConfig();
    const issuer = trimSlash(firstText(environment.issuer, persisted?.issuer, DEFAULT_ISSUER) ?? DEFAULT_ISSUER);
    const clientId = firstText(environment.clientId, persisted?.clientId, DEFAULT_CLIENT_ID) ?? DEFAULT_CLIENT_ID;
    const redirectUri = firstText(environment.redirectUri, persisted?.redirectUri, DEFAULT_REDIRECT_URI) ?? DEFAULT_REDIRECT_URI;
    const scope = firstText(environment.scope, persisted?.scope, "openid profile email phone offline_access") ?? "openid profile email phone offline_access";
    const smsProviderHint = firstText(environment.smsProviderHint, persisted?.smsProviderHint, "Verification code") ?? "Verification code";
    const wechatProviderHint = firstText(environment.wechatProviderHint, persisted?.wechatProviderHint, "Wechat") ?? "Wechat";
    const managementUrl = firstText(environment.managementUrl, persisted?.managementUrl, `${issuer}/`) ?? `${issuer}/`;
    const enforcerId = firstText(environment.enforcerId, persisted?.enforcerId);
    const issuerUrl = parseHttpUrl(issuer);
    const managementUrlObject = parseHttpUrl(managementUrl);
    const configured = Boolean(clientId && scope.split(/\s+/).includes("openid") && issuerUrl && !issuerUrl.search && !issuerUrl.hash && isValidRedirectUri(redirectUri) && managementUrlObject && !managementUrlObject.search && !managementUrlObject.hash && managementUrlObject.origin === issuerUrl.origin);
    return {
      issuer,
      clientId,
      redirectUri,
      scope,
      smsProviderHint,
      wechatProviderHint,
      managementUrl,
      ...(enforcerId ? { enforcerId } : {}),
      configured,
      reason: configured ? undefined : "Casdoor 配置无效：请检查 issuer、client ID、管理地址和 casdoor://localhost/callback",
    };
  }

  private defaultConfig(): CasdoorAuthConfig {
    const issuer = DEFAULT_ISSUER;
    return {
      issuer,
      clientId: DEFAULT_CLIENT_ID,
      redirectUri: DEFAULT_REDIRECT_URI,
      scope: "openid profile email phone offline_access",
      smsProviderHint: "Verification code",
      wechatProviderHint: "Wechat",
      managementUrl: `${issuer}/`,
      configured: false,
      reason: "请配置 Casdoor client ID；可通过账户设置或 OPENBUDDY_CASDOOR_CLIENT_ID 配置",
    };
  }

  private async fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, { ...init, signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
  }

  private installProtocolRegistration(): void {
    if (process.defaultApp) {
      app.setAsDefaultProtocolClient("casdoor", process.execPath, [process.argv[1]]);
    } else {
      app.setAsDefaultProtocolClient("casdoor");
    }
  }

  async init(): Promise<void> {
    this.config = await this.readConfig();
    this.loginCapabilities = null;
    this.installProtocolRegistration();
    if (this.config.configured) await this.loadPersistedSession();
    else await this.clearSession();
  }

  getConfig(): CasdoorAuthConfig {
    return { ...this.config, clientId: this.config.clientId ? "configured" : "" };
  }

  async saveConfig(patch: Partial<PersistedConfig>): Promise<CasdoorAuthConfig> {
    const next: PersistedConfig = {
      issuer: firstText(patch.issuer, this.config.issuer) ?? this.config.issuer,
      clientId: firstText(patch.clientId, this.config.clientId) ?? this.config.clientId,
      redirectUri: firstText(patch.redirectUri, this.config.redirectUri) ?? this.config.redirectUri,
      scope: firstText(patch.scope, this.config.scope) ?? this.config.scope,
      smsProviderHint: firstText(patch.smsProviderHint, this.config.smsProviderHint) ?? this.config.smsProviderHint,
      wechatProviderHint: firstText(patch.wechatProviderHint, this.config.wechatProviderHint) ?? this.config.wechatProviderHint,
      managementUrl: firstText(patch.managementUrl, this.config.managementUrl) ?? this.config.managementUrl,
      enforcerId: firstText(patch.enforcerId, this.config.enforcerId),
    };
    const issuerUrl = parseHttpUrl(String(next.issuer ?? ""));
    const managementUrl = parseHttpUrl(String(next.managementUrl ?? ""));
    const scope = String(next.scope ?? "").trim();
    if (!next.clientId?.trim() || !scope.split(/\s+/).includes("openid") || !issuerUrl || issuerUrl.search || issuerUrl.hash || !isValidRedirectUri(String(next.redirectUri ?? "")) || !managementUrl || managementUrl.search || managementUrl.hash || managementUrl.origin !== issuerUrl.origin) {
      throw new Error("Casdoor 配置无效：issuer、client ID、管理地址和回调 URI 必须有效且管理地址与 issuer 同源");
    }
    const configChanged = next.issuer !== this.config.issuer || next.clientId !== this.config.clientId || next.redirectUri !== this.config.redirectUri;
    writePersistedConfig(next);
    this.config = await this.readConfig();
    this.endpoints = null;
    this.loginCapabilities = null;
    this.lastError = undefined;
    if (configChanged) await this.clearSession();
    this.notifyStatusChange(configChanged ? "config-change" : "state-change");
    return this.getConfig();
  }

  private async discover(): Promise<CasdoorEndpoints> {
    if (this.endpoints) return this.endpoints;
    const response = await this.fetchWithTimeout(`${this.config.issuer}/.well-known/openid-configuration`);
    if (!response.ok) throw new Error(`Casdoor discovery failed (${response.status})`);
    const json = await response.json() as Partial<CasdoorEndpoints>;
    if (!json.authorization_endpoint || !json.token_endpoint) throw new Error("Casdoor discovery lacks OAuth endpoints");
    const issuerUrl = parseHttpUrl(this.config.issuer);
    if (!issuerUrl) throw new Error("Casdoor issuer 地址无效");
    if (typeof json.issuer !== "string" || trimSlash(json.issuer) !== this.config.issuer) {
      throw new Error("Casdoor discovery issuer 与配置不匹配");
    }
    for (const endpoint of [json.authorization_endpoint, json.token_endpoint, json.userinfo_endpoint, json.end_session_endpoint, json.introspection_endpoint, json.jwks_uri]) {
      if (!endpoint) continue;
      const endpointUrl = parseHttpUrl(endpoint);
      if (!endpointUrl || endpointUrl.origin !== issuerUrl.origin) throw new Error("Casdoor discovery 返回了不受信任的端点");
    }
    this.endpoints = json as CasdoorEndpoints;
    return this.endpoints;
  }

  async getIntrospectionEndpoint(): Promise<string> {
    const endpoint = (await this.discover()).introspection_endpoint;
    if (!endpoint) throw new Error("Casdoor discovery 未提供 introspection_endpoint");
    return endpoint;
  }

  async startLogin(provider: "default" | "sms" | "wechat"): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
    if (provider !== "default" && provider !== "sms" && provider !== "wechat") return { ok: false, error: "不支持的 Casdoor 登录方式" };
    if (!this.config.configured) return { ok: false, error: this.config.reason ?? "Casdoor 未配置" };
    try {
      const capabilities = await this.getLoginCapabilities();
      const capability = provider === "default"
        ? capabilities.enterprise
        : provider === "sms" ? capabilities.sms : capabilities.wechat;
      if (!capability.enabled) throw new Error(capability.reason ?? `Casdoor ${provider} 登录未配置`);
      const endpoints = await this.discover();
      const verifier = generateState(48);
      const pkce = await generatePkceS256(verifier);
      if (pkce.codeChallengeMethod !== "S256") throw new Error("当前运行环境不支持 PKCE S256");
      const state = generateState(32);
      const nonce = generateState(32);
      const providerHint = provider === "sms" ? this.config.smsProviderHint : (capabilities.wechat.providerHint ?? this.config.wechatProviderHint);
      const config: OidcConfig = {
        authorizationEndpoint: endpoints.authorization_endpoint,
        tokenEndpoint: endpoints.token_endpoint,
        clientId: this.config.clientId,
        redirectUri: this.config.redirectUri,
        scope: this.config.scope,
        providerHint: provider === "wechat" ? providerHint : undefined,
        signinMethod: provider === "sms" ? providerHint : undefined,
      };
      this.pending.clear();
      this.pending.set(state, { state, nonce, verifier, provider, expiresAt: Date.now() + FLOW_TIMEOUT_MS, endpoints, config });
      const url = buildAuthorizationUrl(config, pkce, state, nonce);
      this.lastError = undefined;
      await shell.openExternal(url);
      return { ok: true, url };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return { ok: false, error: this.lastError };
    }
  }

  async getLoginCapabilities(): Promise<CasdoorLoginCapabilities> {
    if (!this.config.configured) return casdoorCapabilityError(this.config.reason ?? "Casdoor 未配置");
    if (this.loginCapabilities && Date.now() - this.loginCapabilities.checkedAt < LOGIN_CAPABILITIES_TTL_MS) return this.loginCapabilities;
    try {
      const query = new URLSearchParams({
        clientId: this.config.clientId,
        responseType: "code",
        redirectUri: this.config.redirectUri,
        type: "code",
        scope: this.config.scope,
        state: "openbuddy-capability-probe",
        nonce: "openbuddy-capability-probe",
        code_challenge_method: "S256",
        code_challenge: "openbuddy-capability-probe",
      });
      const response = await this.fetchWithTimeout(`${this.config.issuer}/api/get-app-login?${query.toString()}`);
      const payload = await response.json().catch(() => null) as { status?: string; msg?: string; data?: CasdoorApplicationLoginInfo } | null;
      if (!response.ok || payload?.status === "error" || !payload?.data) {
        throw new Error(payload?.msg || `Casdoor 应用能力探测失败 (${response.status})`);
      }
      this.loginCapabilities = deriveCasdoorLoginCapabilities(payload.data, this.config.redirectUri);
      return this.loginCapabilities;
    } catch (error) {
      return casdoorCapabilityError(error instanceof Error ? error.message : String(error));
    }
  }

  async handleCallback(callbackUrl: string): Promise<void> {
    if (!isCasdoorCallbackUrl(callbackUrl, this.config.redirectUri)) {
      this.lastError = "登录回调地址不匹配";
      return;
    }
    const callback = parseAuthCallback(callbackUrl);
    const callbackState = callback.state;
    const flow = callbackState ? this.pending.get(callbackState) : undefined;
    if (!callbackState || !flow || flow.expiresAt < Date.now()) {
      this.lastError = "登录回调已过期或 state 无效";
      if (callbackState) this.pending.delete(callbackState);
      return;
    }
    this.pending.delete(callbackState);
    if (callback.error || !callback.code || callbackState !== flow.state) {
      this.lastError = callback.error || "Casdoor 未返回授权码";
      return;
    }
    try {
      if (!isCasdoorCallbackUrl(callbackUrl, flow.config.redirectUri)) throw new Error("登录回调地址不匹配");
      const token = await this.exchangeCode(flow, callback.code);
      const identity = await this.identityFromToken(flow.endpoints, token, flow.provider, flow.nonce);
      this.identity = identity;
      this.accessToken = token.accessToken;
      this.refreshToken = token.refreshToken ?? null;
      this.expiresAt = Date.now() + (token.expiresIn ?? 3600) * 1000;
      this.provider = flow.provider;
      this.activeTenantId = buildCasdoorTenantContext(identity, this.activeTenantId).activeTenantId;
      this.lastError = undefined;
      void casdoorAudit.record({ event: "login", outcome: "success", subject: identity.subject, tenantId: this.activeTenantId, provider: flow.provider });
      await this.persistSession();
      this.scheduleRefresh();
      this.notifyStatusChange("login");
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      void casdoorAudit.record({ event: "login", outcome: "failure", provider: flow.provider, reason: this.lastError });
      this.notifyStatusChange("login-failed");
    }
  }

  private async exchangeCode(flow: PendingFlow, code: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: flow.config.clientId,
      redirect_uri: flow.config.redirectUri,
      code,
      code_verifier: flow.verifier,
    });
    const secret = process.env.OPENBUDDY_CASDOOR_CLIENT_SECRET;
    if (secret) body.set("client_secret", secret);
    const response = await this.fetchWithTimeout(flow.endpoints.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    const json = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !json || typeof json.access_token !== "string") throw new Error(String(json?.error_description ?? json?.error ?? `Casdoor token exchange failed (${response.status})`));
    return { accessToken: json.access_token, refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined, idToken: typeof json.id_token === "string" ? json.id_token : undefined, tokenType: typeof json.token_type === "string" ? json.token_type : undefined, expiresIn: typeof json.expires_in === "number" ? json.expires_in : undefined };
  }

  private async fetchUserinfo(endpoint: string, accessToken: string): Promise<Record<string, unknown>> {
    const response = await this.fetchWithTimeout(endpoint, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Casdoor userinfo failed (${response.status})`);
    const json = await response.json() as Record<string, unknown>;
    if (json.data && typeof json.data === "object") return json.data as Record<string, unknown>;
    return json;
  }

  private async identityFromToken(
    endpoints: CasdoorEndpoints,
    token: TokenResponse,
    provider?: string,
    nonce?: string,
    requireIdToken = true,
    trustedIdentity?: CasdoorIdentity | null,
  ): Promise<CasdoorIdentity> {
    let claims: Record<string, unknown> = {};
    if (token.idToken) {
      const decoded = decodeJwtPayload(token.idToken);
      if (!decoded) throw new Error("Casdoor ID token 无法解析");
      await this.validateJwtSignature(token.idToken, endpoints);
      const validation = validateIdTokenClaims(decoded, {
        issuer: this.config.issuer,
        clientId: this.config.clientId,
        nonce,
      });
      if (!validation.ok) throw new Error(`ID token 校验失败: ${validation.reason}`);
      claims = decoded;
    } else if (requireIdToken) {
      throw new Error("Casdoor 未返回 ID token");
    }
    const userinfo = endpoints.userinfo_endpoint ? await this.fetchUserinfo(endpoints.userinfo_endpoint, token.accessToken) : {};
    if (!token.idToken && trustedIdentity) {
      claims = {
        sub: trustedIdentity.subject,
        owner: trustedIdentity.owner,
        organization: trustedIdentity.organization,
        organizations: trustedIdentity.organizations,
        roles: trustedIdentity.roles,
        permissions: trustedIdentity.permissions,
        groups: trustedIdentity.groups,
        capabilities: trustedIdentity.capabilities,
        isAdmin: trustedIdentity.isAdmin,
        isForbidden: trustedIdentity.isForbidden,
        isDeleted: trustedIdentity.isDeleted,
      };
    }
    const mergedClaims = trustedIdentity
      ? restrictCasdoorClaimsFromUserinfo(claims, userinfo)
      : token.idToken
        ? mergeCasdoorClaims(claims, userinfo)
        : userinfo;
    const identity = normalizeCasdoorClaims(mergedClaims, provider);
    if (!identity.subject) throw new Error("Casdoor userinfo 缺少 subject");
    if (identity.isForbidden) throw new Error("Casdoor 账户已被禁用");
    if (identity.isDeleted) throw new Error("Casdoor 账户已删除");
    return identity;
  }

  private async validateJwtSignature(token: string, endpoints: CasdoorEndpoints): Promise<void> {
    const header = decodeJwtHeader(token);
    if (!header?.alg || !header.kid) throw new Error("ID token 缺少签名元数据");
    if (!["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"].includes(header.alg)) throw new Error(`不支持的 ID token 签名算法: ${header.alg}`);
    const jwksUrl = endpoints.jwks_uri ?? `${this.config.issuer}/.well-known/jwks`;
    const response = await this.fetchWithTimeout(jwksUrl);
    if (!response.ok) throw new Error(`Casdoor JWKS 请求失败 (${response.status})`);
    const payload = await response.json() as { keys?: Array<Record<string, unknown>> };
    const jwk = payload.keys?.find((key) => key.kid === header.kid);
    if (!jwk) throw new Error("找不到匹配的 Casdoor JWKS key");
    const parts = token.split(".");
    const signature = Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (parts[2].length % 4)) % 4), "base64");
    const hashAlgorithm = ({
      RS256: "RSA-SHA256", RS384: "RSA-SHA384", RS512: "RSA-SHA512",
      ES256: "SHA256", ES384: "SHA384", ES512: "SHA512",
    } as Record<string, string>)[header.alg];
    if (!hashAlgorithm) throw new Error(`不支持的 ID token 签名算法: ${header.alg}`);
    const verificationSignature = header.alg.startsWith("ES") ? joseEcdsaSignatureToDer(signature) : signature;
    if (!verificationSignature) throw new Error("ID token ECDSA 签名格式无效");
    const verifier = createVerify(hashAlgorithm);
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    if (!verifier.verify({ key: createPublicKey({ key: jwk as never, format: "jwk" }), dsaEncoding: "der" }, verificationSignature)) throw new Error("ID token 签名校验失败");
  }

  private async persistSession(): Promise<void> {
    if (!this.refreshToken || !safeStorage.isEncryptionAvailable()) {
      await clearPersistedSession();
      return;
    }
    const data: PersistedSession = { refreshToken: safeStorage.encryptString(this.refreshToken).toString("base64"), expiresAt: this.expiresAt, provider: this.provider, activeTenantId: this.activeTenantId };
    writePersistedSession(data);
  }

  private async loadPersistedSession(): Promise<void> {
    try {
      const data = await readPersistedSession();
      if (!data || !safeStorage.isEncryptionAvailable()) return;
      this.refreshToken = safeStorage.decryptString(Buffer.from(data.refreshToken, "base64"));
      this.expiresAt = data.expiresAt;
      this.provider = data.provider;
      this.activeTenantId = data.activeTenantId;
      await this.refresh();
    } catch {
      await this.clearSession();
    }
  }

  async refresh(): Promise<CasdoorSessionView> {
    if (!this.refreshToken) return this.status();
    try {
      const previousTenantId = this.activeTenantId;
      const endpoints = await this.discover();
      const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.refreshToken, client_id: this.config.clientId });
      const secret = process.env.OPENBUDDY_CASDOOR_CLIENT_SECRET;
      if (secret) body.set("client_secret", secret);
      const response = await this.fetchWithTimeout(endpoints.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
      const json = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok || !json || typeof json.access_token !== "string") throw new Error("Casdoor session refresh failed");
      const token: TokenResponse = {
        accessToken: json.access_token,
        refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
        idToken: typeof json.id_token === "string" ? json.id_token : undefined,
        expiresIn: typeof json.expires_in === "number" ? json.expires_in : undefined,
      };
      const identity = await this.identityFromToken(endpoints, token, this.provider, undefined, false, this.identity);
      if (previousTenantId && !casdoorTenantMembership(identity, previousTenantId)) throw new Error("Casdoor 当前租户成员资格已失效");
      this.identity = identity;
      this.activeTenantId = buildCasdoorTenantContext(identity, this.activeTenantId).activeTenantId;
      this.accessToken = token.accessToken;
      if (typeof json.refresh_token === "string") this.refreshToken = json.refresh_token;
      this.expiresAt = Date.now() + (typeof json.expires_in === "number" ? json.expires_in : 3600) * 1000;
      await this.persistSession();
      this.scheduleRefresh();
      this.notifyStatusChange("refresh");
      return this.status();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      await this.clearSession();
      this.notifyStatusChange("session-invalidated");
      return this.status();
    }
  }

  async revalidateCurrentSession(): Promise<CasdoorSessionView> {
    if (!this.identity || !this.accessToken) return this.status();
    if (this.refreshToken) return this.refresh();
    try {
      const previousTenantId = this.activeTenantId;
      const endpoints = await this.discover();
      const identity = await this.identityFromToken(endpoints, { accessToken: this.accessToken }, this.provider, undefined, false, this.identity);
      if (previousTenantId && !casdoorTenantMembership(identity, previousTenantId)) throw new Error("Casdoor 当前租户成员资格已失效");
      this.identity = identity;
      this.activeTenantId = buildCasdoorTenantContext(identity, this.activeTenantId).activeTenantId;
      this.notifyStatusChange("refresh");
      return this.status();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      await this.clearSession();
      this.notifyStatusChange("session-invalidated");
      return this.status();
    }
  }

  async logout(): Promise<{ ok: true }> {
    const endpoint = this.endpoints?.end_session_endpoint;
    const identity = this.identity;
    const tenantId = this.activeTenantId;
    this.lastError = undefined;
    await this.clearSession();
    void casdoorAudit.record({ event: "logout", outcome: "success", subject: identity?.subject, tenantId });
    if (endpoint) {
      const url = new URL(endpoint);
      url.searchParams.set("post_logout_redirect_uri", this.config.redirectUri);
      await shell.openExternal(url.toString());
    }
    this.notifyStatusChange("logout");
    return { ok: true };
  }

  private async clearSession(): Promise<void> {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.pending.clear();
    this.identity = null;
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = undefined;
    this.provider = undefined;
    this.activeTenantId = undefined;
    await clearPersistedSession();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (!this.refreshToken || !this.expiresAt) return;
    const delay = Math.max(10_000, this.expiresAt - Date.now() - 60_000);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, delay);
  }

  status(): CasdoorSessionView {
    const tenantContext = buildCasdoorTenantContext(this.identity, this.activeTenantId);
    const pendingProvider = [...this.pending.values()].find((flow) => flow.expiresAt > Date.now())?.provider;
    if (!this.config.configured) return { status: "configuration_needed", config: this.getConfig(), identity: null, error: this.lastError, tenantContext };
    if (this.identity && this.expiresAt && this.expiresAt > Date.now()) return { status: "signed_in", config: this.getConfig(), identity: this.identity, expiresAt: this.expiresAt, provider: this.provider, tenantContext };
    return { status: this.lastError ? "error" : "signed_out", config: this.getConfig(), identity: null, pendingProvider, error: this.lastError, tenantContext };
  }

  can(capability: CasdoorCapability): boolean {
    const status = this.status();
    if (!status.identity) return false;
    return authorizeCasdoorTenant(status.identity, status.tenantContext.activeTenantId, { capability }).allowed;
  }

  assertCapability(capability: CasdoorCapability, message = `当前账户没有 ${capability} 权限`): void {
    if (!this.config.configured) return;
    const decision = this.authorizationDecision({ capability });
    if (!decision.allowed) {
      const error = new Error(`${decision.code}: ${message}`) as Error & { code?: string; reason?: string; tenantId?: string; subject?: string };
      error.name = "CasdoorAuthorizationError";
      error.code = decision.code;
      error.reason = decision.reason;
      error.tenantId = decision.tenantId;
      error.subject = decision.subject;
      throw error;
    }
  }

  authorize(requirement: CasdoorAuthorizationRequirement): boolean {
    return this.authorizationDecision(requirement).allowed;
  }

  authorizationDecision(requirement: CasdoorAuthorizationRequirement): CasdoorAuthorizationDecision {
    const status = this.status();
    const decision = authorizeCasdoorTenant(status.identity, status.tenantContext.activeTenantId, requirement);
    const resource = "resource" in requirement ? requirement.resource : undefined;
    const action = "resource" in requirement ? requirement.action : "check";
    void casdoorAudit.record({
      event: "authorization",
      outcome: decision.allowed ? "allow" : "deny",
      subject: decision.subject,
      tenantId: decision.tenantId,
      resource: resource ?? ("capability" in requirement ? requirement.capability : requirement.permission),
      action,
      reason: decision.reason,
      code: decision.code,
    });
    return decision;
  }

  assertAuthorized(requirement: CasdoorAuthorizationRequirement, message = "当前账户没有访问当前租户资源的权限"): void {
    const decision = this.authorizationDecision(requirement);
    if (!decision.allowed) {
      const error = new Error(`${decision.code}: ${message}`) as Error & { code?: string; reason?: string; tenantId?: string; subject?: string; resource?: string; action?: string };
      error.name = "CasdoorAuthorizationError";
      error.code = decision.code;
      error.reason = decision.reason;
      error.tenantId = decision.tenantId;
      error.subject = decision.subject;
      error.resource = decision.resource;
      error.action = decision.action;
      throw error;
    }
  }

  authorizeResource(request: CasdoorResourceAuthorizationRequest): boolean {
    const status = this.status();
    if (request.tenantId && request.tenantId !== status.tenantContext.activeTenantId) {
      void casdoorAudit.record({
        event: "authorization",
        outcome: "deny",
        subject: status.identity?.subject,
        tenantId: status.tenantContext.activeTenantId,
        resource: request.resource,
        action: request.action,
        reason: "tenant_context_mismatch",
      });
      return false;
    }
    return this.authorize({ resource: request.resource, resourceId: request.resourceId, action: request.action });
  }

  async authorizeResourceRemotely(request: CasdoorResourceAuthorizationRequest): Promise<boolean> {
    const status = this.status();
    const secret = process.env.OPENBUDDY_CASDOOR_CLIENT_SECRET;
    const enforcerId = this.config.enforcerId;
    const activeTenantId = status.tenantContext.activeTenantId;
    const input = request as unknown as Record<string, unknown> | null | undefined;
    const resource = typeof input?.resource === "string" ? input.resource.trim() : "";
    const action = typeof input?.action === "string" ? input.action.trim() : "";
    const tenantId = typeof input?.tenantId === "string" ? input.tenantId.trim() : undefined;
    const resourceId = typeof input?.resourceId === "string" ? input.resourceId.trim() : undefined;
    if (!resource || !action || (input?.tenantId !== undefined && !tenantId) || (tenantId && tenantId !== activeTenantId)) {
      void casdoorAudit.record({
        event: "authorization.remote",
        outcome: "deny",
        subject: status.identity?.subject,
        tenantId: activeTenantId,
        resource: resource || (typeof input?.resource === "string" ? input.resource : undefined),
        action: action || (typeof input?.action === "string" ? input.action : undefined),
        reason: tenantId && tenantId !== activeTenantId ? "tenant_context_mismatch" : "invalid_resource_request",
      });
      return false;
    }
    const localAllowed = this.authorizeResource({ tenantId, resource, resourceId, action });
    if (!status.identity || status.identity.isForbidden || status.identity.isDeleted || !activeTenantId) return false;
    if (!casdoorTenantMembership(status.identity, activeTenantId)) return false;
    if (!secret || !enforcerId) return localAllowed;
    try {
      const object = resourceId || resource;
      const response = await this.fetchWithTimeout(`${this.config.issuer}/api/enforce?${new URLSearchParams({ enforcerId }).toString()}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Basic ${Buffer.from(`${this.config.clientId}:${secret}`, "utf8").toString("base64")}`,
        },
        body: JSON.stringify([status.identity.subject, object, action]),
      });
      const payload = await response.json().catch(() => null) as { status?: string; data?: unknown } | null;
      const allowed = response.ok && payload?.status !== "error" && Array.isArray(payload?.data) && payload.data.some((value) => value === true);
      void casdoorAudit.record({ event: "authorization.remote", outcome: allowed ? "allow" : "deny", subject: status.identity.subject, tenantId: activeTenantId, resource, action, reason: allowed ? "casbin_allow" : "casbin_deny" });
      return allowed;
    } catch (error) {
      void casdoorAudit.record({ event: "authorization.remote", outcome: "deny", subject: status.identity.subject, tenantId: activeTenantId, resource, action, reason: error instanceof Error ? error.message : "casbin_request_failed" });
      return false;
    }
  }

  async exchangeForWeKnora(weknoraTenantId: string, sessionId?: string): Promise<WeKnoraExchangeToken> {
    const normalizedWeKnoraTenantId = weknoraTenantId.trim();
    if (!/^\d{1,20}$/.test(normalizedWeKnoraTenantId)) throw new Error("WeKnora 租户标识无效");
    const normalizedSessionId = sessionId?.trim();
    if (normalizedSessionId !== undefined && (normalizedSessionId.length < 1 || normalizedSessionId.length > 200)) throw new Error("会话标识无效");
    const token = this.getAccessToken();
    const tenantId = this.status().tenantContext.activeTenantId;
    const endpoint = process.env.OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL?.trim();
    if (!token || !tenantId) throw new Error("请先登录并选择 Casdoor 租户");
    if (!endpoint) throw new Error("未配置 OpenBuddy → WeKnora token exchange 地址");
    const response = await this.fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ tenant: tenantId, weknoraTenantId: normalizedWeKnoraTenantId, ...(normalizedSessionId ? { sessionId: normalizedSessionId } : {}) }),
    });
    const payload = await response.json().catch(() => null) as { status?: string; data?: { access_token?: unknown; token_type?: unknown; expires_in?: unknown; audience?: unknown }; code?: string; message?: string } | null;
    const accessToken = payload?.data?.access_token;
    if (!response.ok || typeof accessToken !== "string" || payload?.data?.token_type !== "Bearer") {
      throw new Error(payload?.message || payload?.code || `WeKnora token exchange failed (${response.status})`);
    }
    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn: typeof payload.data.expires_in === "number" ? payload.data.expires_in : 300,
      audience: typeof payload.data.audience === "string" ? payload.data.audience : "weknora",
      tenantId: normalizedWeKnoraTenantId,
    };
  }

  /**
   * refreshWeKnoraExchangeToken — sliding-window refresh of an existing weknora_exchange
   * token via the Gateway's `POST /v1/token-exchange/weknora/refresh` endpoint.
   *
   * Unlike `exchangeForWeKnora` (which requires a fresh Casdoor access token), this
   * uses the current weknora_exchange token itself as the bearer credential, so a
   * long-running OpenBuddy desktop session does not have to bounce the user through
   * Casdoor re-login every 5 minutes when the exchange token expires.
   *
   * The Gateway re-runs the same HMAC + claim + tenant-mapping + authorization_version
   * + member-revocation checks as `introspect`, so a stolen token cannot keep being
   * refreshed indefinitely: revocation via Casdoor backchannel-logout or a
   * permission/role change that bumps authorization_version will reject the refresh.
   */
  async refreshWeKnoraExchangeToken(current: WeKnoraExchangeToken, sessionId?: string): Promise<WeKnoraExchangeToken> {
    if (!current?.accessToken) throw new Error("缺少当前 WeKnora exchange token");
    const endpoint = process.env.OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL?.trim();
    if (!endpoint) throw new Error("未配置 OpenBuddy → WeKnora token exchange 地址");
    const refreshUrl = endpoint.replace(/\/?$/, "") + "/refresh";
    const response = await this.fetchWithTimeout(refreshUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${current.accessToken}` },
      body: JSON.stringify(sessionId?.trim() ? { sessionId: sessionId.trim().slice(0, 200) } : {}),
    });
    const payload = await response.json().catch(() => null) as { status?: string; data?: { access_token?: unknown; token_type?: unknown; expires_in?: unknown; audience?: unknown }; code?: string; message?: string } | null;
    const accessToken = payload?.data?.access_token;
    if (!response.ok || typeof accessToken !== "string" || payload?.data?.token_type !== "Bearer") {
      throw new Error(payload?.message || payload?.code || `WeKnora token refresh failed (${response.status})`);
    }
    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn: typeof payload.data.expires_in === "number" ? payload.data.expires_in : 300,
      audience: typeof payload.data.audience === "string" ? payload.data.audience : "weknora",
      tenantId: current.tenantId,
    };
  }

  assertResourceAuthorized(request: CasdoorResourceAuthorizationRequest, message = "当前账户没有访问当前租户资源的权限"): void {
    if (!this.authorizeResource(request)) {
      const decision = this.authorizationDecision({ resource: request.resource, resourceId: request.resourceId, action: request.action });
      const error = new Error(`${decision.code}: ${message}`) as Error & { code?: string; reason?: string; tenantId?: string; subject?: string; resource?: string; action?: string };
      error.name = "CasdoorAuthorizationError";
      error.code = decision.code;
      error.reason = decision.reason;
      error.tenantId = decision.tenantId;
      error.subject = decision.subject;
      error.resource = decision.resource;
      error.action = decision.action;
      throw error;
    }
  }

  selectTenant(tenantId: string): CasdoorSessionView {
    const normalized = tenantId.trim();
    const status = this.status();
    if (!status.identity) throw new Error("请先登录 Casdoor 企业账户");
    if (!normalized || !status.tenantContext.availableTenantIds.includes(normalized)) {
      throw new Error("当前账户不属于所选租户");
    }
    this.activeTenantId = normalized;
    void casdoorAudit.record({ event: "tenant.switch", outcome: "success", subject: status.identity.subject, tenantId: normalized });
    void this.persistSession();
    this.notifyStatusChange("tenant-switch");
    return this.status();
  }

  getAccessToken(): string | null {
    if (!this.identity || !this.accessToken || !this.expiresAt) return null;
    if (this.expiresAt <= Date.now()) return null;
    return this.accessToken;
  }

  async handleExternalRevocation(tenantId: string, subject: string, reason?: string): Promise<void> {
    const status = this.status();
    const normalizedTenant = tenantId.trim();
    const normalizedSubject = subject.trim();
    if (!normalizedTenant || !normalizedSubject) return;
    const active = status.tenantContext.activeTenantId;
    if (status.identity && active === normalizedTenant && status.identity.subject === normalizedSubject) {
      this.lastError = `当前账户已被租户管理员撤销访问：${reason?.trim() || "请联系管理员"}`;
      this.identity = null;
      this.accessToken = null;
      this.refreshToken = null;
      this.expiresAt = 0;
      this.activeTenantId = undefined;
      await this.persistSession();
      void casdoorAudit.record({ event: "session.invalidated", outcome: "success", tenantId: normalizedTenant, subject: normalizedSubject, resource: `member/${normalizedSubject}`, action: "revoke", reason: reason?.trim() });
      this.notifyStatusChange("member-revoked");
    }
  }
}

// P2-10: lazy casdoorAuth. The previous `new CasdoorAuthService()` ran at
// module top, dragging the class' static initializers into the cold-start
// module graph for every main-process consumer (index.ts, ipc/*,
// agent-host.ts). Even though the constructor body is currently tiny
// (`defaultConfig()` only), the import-time instance guarantees that any
// future expansion (e.g. eager storage open, native binding load) will
// silently regress cold-start.
//
// The Proxy preserves the existing call sites (`casdoorAuth.status()`,
// `casdoorAuth.init()`, `casdoorAuth.saveConfig(...)`) without any code
// change — every property access lazily constructs the instance once
// and caches it. Method binds ensure `this` always points to the real
// instance even when callers destructure (e.g. `const { status } =
// casdoorAuth; status()`).
let _casdoorAuthInstance: CasdoorAuthService | undefined;
export const casdoorAuth: CasdoorAuthService = new Proxy(
  {} as CasdoorAuthService,
  {
    get(_target, prop) {
      if (!_casdoorAuthInstance) _casdoorAuthInstance = new CasdoorAuthService();
      const value = Reflect.get(_casdoorAuthInstance, prop, _casdoorAuthInstance);
      return typeof value === "function" ? value.bind(_casdoorAuthInstance) : value;
    },
    set(_target, prop, value) {
      // P2-10: tests poke private fields via
      // `(casdoorAuth as unknown as { refreshToken: ... }).refreshToken = ...`
      // — without forwarding `set` to the instance, those writes land on
      // the empty target and the real instance never sees them.
      if (!_casdoorAuthInstance) _casdoorAuthInstance = new CasdoorAuthService();
      Reflect.set(_casdoorAuthInstance, prop, value, _casdoorAuthInstance);
      return true;
    },
    has(_target, prop) {
      if (!_casdoorAuthInstance) _casdoorAuthInstance = new CasdoorAuthService();
      return Reflect.has(_casdoorAuthInstance, prop);
    },
    defineProperty(_target, prop, descriptor) {
      // P2-10: vitest's `vi.spyOn(service, "refresh")` uses
      // `Object.defineProperty(target, "refresh", { value: mockFn })` —
      // without this trap, the spy lands on the empty target and the
      // real instance never sees it, breaking tests like
      // `casdoor-auth-storage.test.ts`.
      if (!_casdoorAuthInstance) _casdoorAuthInstance = new CasdoorAuthService();
      Reflect.defineProperty(_casdoorAuthInstance, prop, descriptor);
      return true;
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (!_casdoorAuthInstance) _casdoorAuthInstance = new CasdoorAuthService();
      return Reflect.getOwnPropertyDescriptor(_casdoorAuthInstance, prop);
    },
  },
);

/**
 * Test-only escape hatch — drop the cached instance so unit tests can
 * start from a clean slate. Production code must never call this.
 */
export function _resetCasdoorAuthForTests(): void {
  _casdoorAuthInstance = undefined;
}
