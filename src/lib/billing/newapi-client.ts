/**
 * Newapi 客户端层（纯函数 + 依赖注入 + env 注入）
 *
 * 设计原则：
 * 1. **绝无硬编码凭据**：URL/API Key/User ID 一律通过 env 或调用方注入
 * 2. **fetch 可注入**：测试通过 config.fetchImpl 覆盖，运行时用全局 fetch
 * 3. **envelope 统一**：Newapi 大多数接口使用 { success, data, message } 包装
 * 4. **safeHttpUrl**：与 casdoor-resource-backend 一致，拒绝 query/hash/credentials
 *
 * 参考 newapi 文档：
 *   - 鉴权：`POST /api/user/login`、`GET /api/user/self`
 *   - 模型：`GET /v1/models`（OpenAI 兼容）、`GET /api/models/`
 *   - Token：`GET/POST/PUT/DELETE /api/user/token[/id]`
 *   - 计费：`GET /api/user/topup/self`、`GET /api/user/topup/info`
 *   - 用量：`GET /api/user/token/{id}/usage`（受 openapi/management/usage 控制）
 *   - 聊天：`POST /v1/chat/completions`（OpenAI 兼容）
 *   - Anthropic：`POST /v1/messages`（Claude 兼容）
 *
 * 该模块与 casdoor-resource-gateway 完全解耦：
 *   - newapi 用于实时模型调用 + 用户级余额/用量
 *   - casdoor-resource-gateway 用于租户级积分/钱包/账本
 *   - billing-coordinator 桥接两者（对账推送）
 */

export type NewapiFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

// ----------------------------------------------------------------------------
// 配置
// ----------------------------------------------------------------------------

/** Newapi 客户端配置。 */
export interface NewapiConfig {
  /** Newapi 服务基地址（如 `https://api.newapi.example.com`）。 */
  baseUrl: string;
  /** 用户级 API Key（推荐 sk- 前缀）。可选：未提供时只能调用公开端点。 */
  apiKey?: string;
  /** 用户/子账户 ID（用于"以用户身份"调用管理员端点）。 */
  userId?: string;
  /** 单次请求超时（毫秒）。 */
  timeoutMs?: number;
  /** 是否启用（false 时所有方法立即抛错）。 */
  enabled?: boolean;
  /** fetch 实现（测试可注入）。默认全局 fetch。 */
  fetchImpl?: NewapiFetch;
  /** AbortSignal 工厂（测试可注入）。默认 AbortSignal.timeout。 */
  abortSignalFactory?: (timeoutMs: number) => AbortSignal;
  /** 调试日志回调（生产可关闭）。 */
  logger?: (message: string, meta?: Record<string, unknown>) => void;
}

// ----------------------------------------------------------------------------
// Envelope
// ----------------------------------------------------------------------------

/** Newapi 标准响应包络。 */
export type NewapiEnvelope<T> =
  | { success: true; data: T; message?: string }
  | { success: false; data?: T; message: string; code?: string | number }
  | T; // 部分端点直出数据

/** 取包络里的 data（自动剥壳）。 */
export function unwrapNewapiEnvelope<T>(value: unknown): T {
  if (value && typeof value === "object" && "data" in value) {
    const envelope = value as { data?: unknown; success?: boolean; message?: string };
    if (envelope.success === false) {
      const message = typeof envelope.message === "string" && envelope.message ? envelope.message : "Newapi 业务错误";
      const err = new Error(message) as Error & { newapiError?: { message: string; raw: unknown } };
      err.newapiError = { message, raw: value };
      throw err;
    }
    return (envelope.data ?? null) as T;
  }
  return value as T;
}

/** 判断是否失败包络。 */
export function isNewapiEnvelopeOk(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (!("success" in value)) return true; // 直出数据视为成功
  return (value as { success?: unknown }).success !== false;
}

/** 判断是否失败包络。 */
export function isNewapiEnvelopeErr(value: unknown): value is { success: false; message: string; code?: string | number } {
  if (!value || typeof value !== "object") return false;
  const obj = value as { success?: unknown; message?: unknown };
  return obj.success === false && typeof obj.message === "string";
}

// ----------------------------------------------------------------------------
// URL 安全
// ----------------------------------------------------------------------------

const VALID_PROTOCOLS = /^(https?):$/i;

/** 拒绝带 query/hash/credentials 的 baseUrl。返回去掉尾斜杠的字符串。 */
export function safeHttpUrl(value: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Newapi baseUrl 必填");
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Newapi baseUrl 不是合法 URL");
  }
  if (!VALID_PROTOCOLS.test(url.protocol)) {
    throw new Error("Newapi baseUrl 必须使用 http(s) 协议");
  }
  if (url.username || url.password) {
    throw new Error("Newapi baseUrl 不允许携带凭据，请改用 Authorization 头");
  }
  if (url.search || url.hash) {
    throw new Error("Newapi baseUrl 不允许携带 query 或 hash 片段");
  }
  return url.toString().replace(/\/+$/, "");
}

/** 判断是否合法 Newapi baseUrl。 */
export function isValidNewapiBaseUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    safeHttpUrl(value);
    return true;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------
// Env 注入
// ----------------------------------------------------------------------------

export interface NewapiEnvSource {
  /** process.env 或其 mock。 */
  readonly [key: string]: string | undefined;
}

/** 默认 env 源（Node + 浏览器都覆盖到 process.env）。 */
export const defaultNewapiEnv: NewapiEnvSource =
  typeof process !== "undefined" && process.env
    ? (process.env as NewapiEnvSource)
    : {};

/** 从 env 读取 Newapi 配置。变量名：
 *   - OPENBUDDY_NEWAPI_BASE_URL（必填）
 *   - OPENBUDDY_NEWAPI_API_KEY（可选）
 *   - OPENBUDDY_NEWAPI_USER_ID（可选）
 *   - OPENBUDDY_NEWAPI_TIMEOUT_MS（可选，默认 60000）
 *   - OPENBUDDY_NEWAPI_ENABLED（可选，"false" 禁用）
 */
export function loadNewapiConfigFromEnv(env: NewapiEnvSource = defaultNewapiEnv): NewapiConfig | null {
  const baseUrl = env.OPENBUDDY_NEWAPI_BASE_URL?.trim();
  if (!baseUrl) return null;
  const enabledRaw = env.OPENBUDDY_NEWAPI_ENABLED?.trim().toLowerCase();
  const enabled = enabledRaw !== "false" && enabledRaw !== "0" && enabledRaw !== "no" && enabledRaw !== "off";
  const timeoutRaw = env.OPENBUDDY_NEWAPI_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutRaw && /^\d+$/.test(timeoutRaw) ? Math.max(1000, Math.min(600_000, Number(timeoutRaw))) : 60_000;
  return {
    baseUrl: safeHttpUrl(baseUrl),
    apiKey: env.OPENBUDDY_NEWAPI_API_KEY?.trim() || undefined,
    userId: env.OPENBUDDY_NEWAPI_USER_ID?.trim() || undefined,
    timeoutMs,
    enabled,
  };
}

// ----------------------------------------------------------------------------
// 错误
// ----------------------------------------------------------------------------

export class NewapiError extends Error {
  readonly status: number;
  readonly code?: string | number;
  readonly payload: unknown;
  readonly endpoint: string;
  readonly method: string;

  constructor(message: string, opts: { status: number; code?: string | number; payload?: unknown; endpoint: string; method: string }) {
    super(message);
    this.name = "NewapiError";
    this.status = opts.status;
    this.code = opts.code;
    this.payload = opts.payload;
    this.endpoint = opts.endpoint;
    this.method = opts.method;
  }
}

export class NewapiNetworkError extends Error {
  readonly cause: unknown;
  readonly endpoint: string;
  readonly method: string;
  readonly timeoutMs: number;

  constructor(message: string, opts: { cause?: unknown; endpoint: string; method: string; timeoutMs: number }) {
    super(message);
    this.name = "NewapiNetworkError";
    this.cause = opts.cause;
    this.endpoint = opts.endpoint;
    this.method = opts.method;
    this.timeoutMs = opts.timeoutMs;
  }
}

export class NewapiAuthError extends NewapiError {
  constructor(message: string, opts: { status: number; payload?: unknown; endpoint: string; method: string; code?: string | number }) {
    super(message, opts);
    this.name = "NewapiAuthError";
  }
}

export class NewapiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewapiConfigError";
  }
}

// ----------------------------------------------------------------------------
// 会话（与 Casdoor claim 桥接）
// ----------------------------------------------------------------------------

export interface NewapiSession {
  /** 用户/子账户 ID。 */
  userId: string;
  /** 用户级 API Key（sk- 前缀）。 */
  apiKey: string;
  /** 可选显示名。 */
  displayName?: string;
  /** 可选 email。 */
  email?: string;
}

/** 从 Casdoor OIDC claim 构造 Newapi 会话（不读取本地敏感文件）。 */
export function newapiSessionFromCasdoorClaim(claim: {
  sub?: string | null;
  preferred_username?: string | null;
  name?: string | null;
  email?: string | null;
  newapi_api_key?: string | null;
  newapi_user_id?: string | null;
}): NewapiSession | null {
  const apiKey = typeof claim.newapi_api_key === "string" ? claim.newapi_api_key.trim() : "";
  if (!apiKey) return null;
  const userId = (typeof claim.newapi_user_id === "string" && claim.newapi_user_id.trim())
    || (typeof claim.sub === "string" && claim.sub.trim())
    || "";
  if (!userId) return null;
  return {
    userId,
    apiKey,
    displayName: typeof claim.name === "string" && claim.name ? claim.name : (typeof claim.preferred_username === "string" ? claim.preferred_username : undefined),
    email: typeof claim.email === "string" && claim.email ? claim.email : undefined,
  };
}

// ----------------------------------------------------------------------------
// 数据模型
// ----------------------------------------------------------------------------

/** 登录请求。 */
export interface NewapiLoginRequest {
  username: string;
  password: string;
  /** 2FA 验证码（如开启）。 */
  code?: string;
}

/** 登录响应。 */
export interface NewapiLoginResponse {
  token?: string;
  refreshToken?: string;
  user?: NewapiUserSelf;
  message?: string;
}

/** 当前用户信息。 */
export interface NewapiUserSelf {
  id: number | string;
  username: string;
  displayName?: string;
  email?: string;
  role?: number | string;
  status?: number | string;
  group?: string;
  balance?: number;
  quota?: number;
  usedQuota?: number;
}

/** 用户分组（带倍率/速率）。 */
export interface NewapiUserGroup {
  name: string;
  ratio?: number;
  /** 描述。 */
  description?: string;
}

/** 模型元数据。 */
export interface NewapiModel {
  id: string;
  object?: "model";
  created?: number;
  ownedBy?: string;
  /** 模型分组（用于计费倍率）。 */
  group?: string;
  /** 价格倍率（相对基准组）。 */
  ratio?: number;
  /** 描述。 */
  description?: string;
}

/** 模型列表响应（OpenAI 兼容）。 */
export interface NewapiModelsResponse {
  object: "list";
  data: NewapiModel[];
}

/** API Token 记录。 */
export interface NewapiToken {
  id: number | string;
  name: string;
  key?: string;
  /** 掩码后的 key（仅显示用）。 */
  maskedKey?: string;
  group: string;
  status?: number | string;
  expiredAt?: number;
  remainQuota?: number;
  usedQuota?: number;
  unlimitedQuota?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

/** 创建 Token 请求。 */
export interface NewapiCreateTokenRequest {
  name: string;
  group?: string;
  remainQuota?: number;
  expiredAt?: number;
  unlimitedQuota?: boolean;
}

/** 更新 Token 请求。 */
export interface NewapiUpdateTokenRequest {
  name?: string;
  group?: string;
  remainQuota?: number;
  expiredAt?: number;
  status?: number | string;
  unlimitedQuota?: boolean;
}

/** 单条用量日志。 */
export interface NewapiTokenUsageLog {
  id?: number | string;
  userId?: number | string;
  tokenId?: number | string;
  model?: string;
  group?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  quota?: number;
  /** ISO 时间字符串。 */
  createdAt?: string;
  /** Unix ms 时间戳（部分端点）。 */
  createdAtMs?: number;
  /** 渠道（多渠道负载均衡场景）。 */
  channel?: number | string;
  requestId?: string;
}

/** 余额快照。 */
export interface NewapiQuotaBalance {
  /** 剩余 quota（Newapi 内部单位 = 1/500000 USD）。 */
  remainQuota: number;
  /** 已用 quota。 */
  usedQuota?: number;
  /** 总额度。 */
  totalQuota?: number;
  /** 货币（通常 CNY/USD）。 */
  currency?: string;
  /** USD 等价。 */
  usdEquivalent?: number;
}

/** Topup info。 */
export interface NewapiTopupInfo {
  amount: number;
  currency?: string;
  minTopup?: number;
  paymentMethods?: string[];
  /** USD 等价。 */
  usdEquivalent?: number;
  /** 1 USD = X quota 之类的换算。 */
  quotaPerUsd?: number;
}

// ----------------------------------------------------------------------------
// Chat / Anthropic
// ----------------------------------------------------------------------------

export interface NewapiChatMessage {
  role: "system" | "user" | "assistant" | "tool" | "function";
  content: string | NewapiChatContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

export interface NewapiChatContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string; detail?: "auto" | "low" | "high" };
}

export interface NewapiChatCompletionRequest {
  model: string;
  messages: NewapiChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
  stop?: string | string[];
  tools?: unknown[];
  tool_choice?: string | Record<string, unknown>;
  response_format?: Record<string, unknown>;
  seed?: number;
  /** Newapi 私有字段：分组覆盖。 */
  group?: string;
}

export interface NewapiChatChoice {
  index: number;
  message: NewapiChatMessage;
  finish_reason?: string;
}

export interface NewapiChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface NewapiChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: NewapiChatChoice[];
  usage?: NewapiChatUsage;
}

export interface NewapiAnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  messages: { role: "user" | "assistant"; content: string | NewapiAnthropicContentBlock[] }[];
  system?: string | NewapiAnthropicContentBlock[];
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: unknown[];
  tool_choice?: unknown;
  metadata?: Record<string, string>;
}

export interface NewapiAnthropicContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result";
  text?: string;
  source?: { type: "base64"; media_type: string; data: string };
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

export interface NewapiAnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface NewapiAnthropicMessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: NewapiAnthropicContentBlock[];
  model: string;
  stop_reason?: string;
  stop_sequence?: string | null;
  usage?: NewapiAnthropicUsage;
}

export interface NewapiEmbeddingsRequest {
  model: string;
  input: string | string[];
  encoding_format?: "float" | "base64";
  user?: string;
}

export interface NewapiEmbedding {
  index: number;
  object: "embedding";
  embedding: number[];
}

export interface NewapiEmbeddingsResponse {
  object: "list";
  data: NewapiEmbedding[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

// ----------------------------------------------------------------------------
// 客户端
// ----------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 60_000;

export class NewapiClient {
  readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly userId: string | undefined;
  private readonly timeoutMs: number;
  private readonly enabled: boolean;
  private readonly fetchImpl: NewapiFetch;
  private readonly abortSignalFactory: (timeoutMs: number) => AbortSignal;
  private readonly logger: ((message: string, meta?: Record<string, unknown>) => void) | undefined;

  constructor(config: NewapiConfig) {
    this.baseUrl = safeHttpUrl(config.baseUrl);
    this.apiKey = typeof config.apiKey === "string" && config.apiKey.trim() ? config.apiKey.trim() : undefined;
    this.userId = typeof config.userId === "string" && config.userId.trim() ? config.userId.trim() : undefined;
    this.timeoutMs = Number.isFinite(config.timeoutMs) && (config.timeoutMs ?? 0) > 0 ? config.timeoutMs! : DEFAULT_TIMEOUT_MS;
    this.enabled = config.enabled !== false;
    this.fetchImpl = config.fetchImpl ?? (typeof fetch === "function" ? (fetch as NewapiFetch) : (() => { throw new NewapiNetworkError("全局 fetch 不可用", { endpoint: "*", method: "*", timeoutMs: 0 }); }));
    this.abortSignalFactory = config.abortSignalFactory ?? ((ms: number) => (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(ms) : new AbortController().signal));
    this.logger = config.logger;
  }

  // 工厂 ----------------------------------------------------------------

  static fromSession(session: NewapiSession, overrides: Partial<NewapiConfig> = {}): NewapiClient {
    return new NewapiClient({
      baseUrl: overrides.baseUrl ?? "",
      apiKey: session.apiKey,
      userId: session.userId,
      ...overrides,
    });
  }

  static unauthenticated(baseUrl: string, overrides: Partial<NewapiConfig> = {}): NewapiClient {
    return new NewapiClient({ baseUrl, ...overrides });
  }

  withApiKey(apiKey: string): NewapiClient {
    return new NewapiClient({
      baseUrl: this.baseUrl,
      apiKey,
      userId: this.userId,
      timeoutMs: this.timeoutMs,
      enabled: this.enabled,
      fetchImpl: this.fetchImpl,
      abortSignalFactory: this.abortSignalFactory,
      logger: this.logger,
    });
  }

  withUserId(userId: string): NewapiClient {
    return new NewapiClient({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      userId,
      timeoutMs: this.timeoutMs,
      enabled: this.enabled,
      fetchImpl: this.fetchImpl,
      abortSignalFactory: this.abortSignalFactory,
      logger: this.logger,
    });
  }

  // 状态 ----------------------------------------------------------------

  get isEnabled(): boolean {
    return this.enabled;
  }

  get hasApiKey(): boolean {
    return Boolean(this.apiKey);
  }

  get currentUserId(): string | undefined {
    return this.userId;
  }

  // 内部请求 --------------------------------------------------------------

  private ensureEnabled(endpoint: string, method: string): void {
    if (!this.enabled) {
      throw new NewapiConfigError(`Newapi 客户端已禁用 (${method} ${endpoint})`);
    }
  }

  private authHeaders(extra?: HeadersInit): Headers {
    const headers = new Headers(extra ?? {});
    headers.set("accept", "application/json");
    if (this.apiKey) headers.set("authorization", `Bearer ${this.apiKey}`);
    if (this.userId) headers.set("new-api-user", this.userId);
    return headers;
  }

  private async request<T>(method: string, path: string, init: { body?: unknown; query?: Record<string, string | number | boolean | undefined | null>; headers?: HeadersInit; signal?: AbortSignal } = {}): Promise<T> {
    this.ensureEnabled(path, method);
    const url = this.buildUrl(path, init.query);
    const headers = this.authHeaders(init.headers);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    const signal = init.signal ?? this.abortSignalFactory(this.timeoutMs);
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        signal,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    } catch (err) {
      this.logger?.("newapi.network_error", { method, path, error: (err as Error)?.message });
      throw new NewapiNetworkError(`Newapi 网络错误: ${method} ${path}`, { cause: err, endpoint: path, method, timeoutMs: this.timeoutMs });
    }
    const elapsed = Date.now() - startedAt;
    const rawText = await response.text();
    const payload = parseJsonSafe(rawText);
    if (!response.ok) {
      const error = mapHttpError(response, payload, rawText, method, path);
      this.logger?.("newapi.http_error", { method, path, status: response.status, elapsed, message: error.message });
      throw error;
    }
    this.logger?.("newapi.ok", { method, path, status: response.status, elapsed });
    return (payload ?? null) as T;
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined | null>): string {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const base = `${this.baseUrl}${normalized}`;
    if (!query) return base;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      params.set(key, String(value));
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  // 鉴权 --------------------------------------------------------------

  /** 登录获取 access token。成功后返回 token 字符串。 */
  async login(req: NewapiLoginRequest): Promise<NewapiLoginResponse> {
    const result = await this.request<NewapiLoginResponse>("POST", "/api/user/login", { body: req });
    return unwrapNewapiEnvelope<NewapiLoginResponse>(result);
  }

  /** 当前用户信息（依赖 API Key）。 */
  async getSelf(): Promise<NewapiUserSelf> {
    if (!this.apiKey) throw new NewapiConfigError("getSelf 需要 apiKey");
    const result = await this.request<unknown>("GET", "/api/user/self");
    return unwrapNewapiEnvelope<NewapiUserSelf>(result);
  }

  /** 当前用户所在分组（含倍率）。 */
  async getSelfGroups(): Promise<NewapiUserGroup[]> {
    if (!this.apiKey) throw new NewapiConfigError("getSelfGroups 需要 apiKey");
    const result = await this.request<unknown>("GET", "/api/user/self/groups");
    const unwrapped = unwrapNewapiEnvelope<NewapiUserGroup[] | Record<string, NewapiUserGroup>>(result);
    if (Array.isArray(unwrapped)) return unwrapped;
    if (unwrapped && typeof unwrapped === "object") return Object.values(unwrapped as Record<string, NewapiUserGroup>);
    return [];
  }

  /** 余额快照。 */
  async getQuotaBalance(): Promise<NewapiQuotaBalance> {
    if (!this.apiKey) throw new NewapiConfigError("getQuotaBalance 需要 apiKey");
    const result = await this.request<unknown>("GET", "/api/user/topup/self");
    const unwrapped = unwrapNewapiEnvelope<unknown>(result);
    return normalizeQuotaBalance(unwrapped);
  }

  /** 充值信息（min/max、支付方式）。 */
  async getTopupInfo(): Promise<NewapiTopupInfo> {
    if (!this.apiKey) throw new NewapiConfigError("getTopupInfo 需要 apiKey");
    const result = await this.request<unknown>("GET", "/api/user/topup/info");
    return unwrapNewapiEnvelope<NewapiTopupInfo>(result);
  }

  // 模型 --------------------------------------------------------------

  /** OpenAI 兼容：列出可用模型。 */
  async listModels(): Promise<NewapiModelsResponse> {
    const result = await this.request<unknown>("GET", "/v1/models");
    const unwrapped = unwrapNewapiEnvelope<NewapiModelsResponse | NewapiModel[]>(result);
    if (Array.isArray(unwrapped)) return { object: "list", data: unwrapped };
    if (unwrapped && Array.isArray((unwrapped as NewapiModelsResponse).data)) return unwrapped as NewapiModelsResponse;
    return { object: "list", data: [] };
  }

  // 聊天 --------------------------------------------------------------

  /** OpenAI 兼容：chat completions。 */
  async chatCompletions(req: NewapiChatCompletionRequest, opts: { signal?: AbortSignal } = {}): Promise<NewapiChatCompletionResponse> {
    const result = await this.request<NewapiChatCompletionResponse>("POST", "/v1/chat/completions", { body: req, signal: opts.signal });
    return result;
  }

  /** Anthropic 兼容：messages。 */
  async anthropicMessages(req: NewapiAnthropicMessagesRequest, opts: { signal?: AbortSignal } = {}): Promise<NewapiAnthropicMessagesResponse> {
    const result = await this.request<NewapiAnthropicMessagesResponse>("POST", "/v1/messages", { body: req, signal: opts.signal });
    return result;
  }

  /** OpenAI 兼容：embeddings。 */
  async embeddings(req: NewapiEmbeddingsRequest, opts: { signal?: AbortSignal } = {}): Promise<NewapiEmbeddingsResponse> {
    const result = await this.request<NewapiEmbeddingsResponse>("POST", "/v1/embeddings", { body: req, signal: opts.signal });
    return result;
  }

  // Token 管理 ---------------------------------------------------------

  /** 列出当前用户的 API Token。 */
  async listTokens(): Promise<NewapiToken[]> {
    if (!this.apiKey) throw new NewapiConfigError("listTokens 需要 apiKey");
    const result = await this.request<unknown>("GET", "/api/user/token");
    const unwrapped = unwrapNewapiEnvelope<NewapiToken[] | { items?: NewapiToken[] }>(result);
    if (Array.isArray(unwrapped)) return unwrapped;
    if (unwrapped && Array.isArray((unwrapped as { items?: NewapiToken[] }).items)) return (unwrapped as { items: NewapiToken[] }).items;
    return [];
  }

  /** 获取单个 Token 详情。 */
  async getToken(tokenId: string | number): Promise<NewapiToken> {
    if (!this.apiKey) throw new NewapiConfigError("getToken 需要 apiKey");
    const result = await this.request<unknown>("GET", `/api/user/token/${encodeURIComponent(String(tokenId))}`);
    return unwrapNewpiEnvelopeOrFirst<NewapiToken>(result);
  }

  /** 创建新 Token（返回包含真实 key 的对象，调用方必须安全处理）。 */
  async createToken(req: NewapiCreateTokenRequest): Promise<NewapiToken> {
    if (!this.apiKey) throw new NewapiConfigError("createToken 需要 apiKey");
    const result = await this.request<unknown>("POST", "/api/user/token", { body: req });
    return unwrapNewpiEnvelopeOrFirst<NewapiToken>(result);
  }

  /** 更新 Token。 */
  async updateToken(tokenId: string | number, patch: NewapiUpdateTokenRequest): Promise<NewapiToken> {
    if (!this.apiKey) throw new NewapiConfigError("updateToken 需要 apiKey");
    const result = await this.request<unknown>("PUT", `/api/user/token/${encodeURIComponent(String(tokenId))}`, { body: patch });
    return unwrapNewpiEnvelopeOrFirst<NewapiToken>(result);
  }

  /** 删除 Token。 */
  async deleteToken(tokenId: string | number): Promise<{ ok: true }> {
    if (!this.apiKey) throw new NewapiConfigError("deleteToken 需要 apiKey");
    await this.request<unknown>("DELETE", `/api/user/token/${encodeURIComponent(String(tokenId))}`);
    return { ok: true };
  }

  // 用量 ---------------------------------------------------------------

  /** 列出 Token 用量日志。 */
  async listTokenUsage(
    tokenId: string | number,
    opts: { startTime?: number; endTime?: number; model?: string; page?: number; pageSize?: number } = {},
  ): Promise<NewapiTokenUsageLog[]> {
    if (!this.apiKey) throw new NewapiConfigError("listTokenUsage 需要 apiKey");
    const query: Record<string, string | number | undefined> = {
      p: opts.page ?? 0,
      page_size: opts.pageSize ?? 100,
    };
    if (opts.startTime) query.start_timestamp = Math.floor(opts.startTime / 1000);
    if (opts.endTime) query.end_timestamp = Math.floor(opts.endTime / 1000);
    if (opts.model) query.model = opts.model;
    const result = await this.request<unknown>("GET", `/api/user/token/${encodeURIComponent(String(tokenId))}/usage`, { query });
    const unwrapped = unwrapNewapiEnvelope<NewapiTokenUsageLog[] | { items?: NewapiTokenUsageLog[]; data?: NewapiTokenUsageLog[] }>(result);
    if (Array.isArray(unwrapped)) return unwrapped;
    if (unwrapped && Array.isArray((unwrapped as { items?: NewapiTokenUsageLog[] }).items)) return (unwrapped as { items: NewapiTokenUsageLog[] }).items;
    if (unwrapped && Array.isArray((unwrapped as { data?: NewapiTokenUsageLog[] }).data)) return (unwrapped as { data: NewapiTokenUsageLog[] }).data;
    return [];
  }

  /** 聚合用量摘要（自定义聚合，避免依赖服务端聚合端点）。 */
  async getUsageSummary(
    tokenId: string | number,
    opts: { startTime?: number; endTime?: number } = {},
  ): Promise<{
    totalPrompt: number;
    totalCompletion: number;
    totalTokens: number;
    totalQuota: number;
    byModel: Record<string, { prompt: number; completion: number; total: number; quota: number; count: number }>;
    count: number;
  }> {
    const logs = await this.listTokenUsage(tokenId, opts);
    const byModel: Record<string, { prompt: number; completion: number; total: number; quota: number; count: number }> = {};
    let totalPrompt = 0;
    let totalCompletion = 0;
    let totalTokens = 0;
    let totalQuota = 0;
    for (const log of logs) {
      const prompt = Number(log.promptTokens) || 0;
      const completion = Number(log.completionTokens) || 0;
      const total = Number(log.totalTokens) || prompt + completion;
      const quota = Number(log.quota) || 0;
      const model = String(log.model ?? "unknown");
      if (!byModel[model]) byModel[model] = { prompt: 0, completion: 0, total: 0, quota: 0, count: 0 };
      byModel[model].prompt += prompt;
      byModel[model].completion += completion;
      byModel[model].total += total;
      byModel[model].quota += quota;
      byModel[model].count += 1;
      totalPrompt += prompt;
      totalCompletion += completion;
      totalTokens += total;
      totalQuota += quota;
    }
    return { totalPrompt, totalCompletion, totalTokens, totalQuota, byModel, count: logs.length };
  }

  // 成本估算 -----------------------------------------------------------

  /** 估算一次聊天的 quota 消耗（基于 Newapi 1 quota = 1/500000 USD）。 */
  async estimateQuotaCost(req: NewapiChatCompletionRequest): Promise<{ usd: number; quota: number }> {
    // Newapi 没有公开的 quote 端点；采用 usage × model ratio 估算
    const groups = await this.getSelfGroups().catch(() => []);
    const ratio = pickGroupRatio(req.group ?? (groups[0]?.name ?? "default"), groups);
    const promptTokens = estimatePromptTokens(req);
    const completionTokens = req.max_tokens ?? 0;
    // Newapi 默认换算：1 USD ≈ 500000 quota
    const baseUsd = (promptTokens * 0.000003 + completionTokens * 0.000015);
    const usd = baseUsd * ratio;
    const quota = Math.ceil(usd * 500_000);
    return { usd, quota };
  }
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

/** 从包络中拿第一项（如 { data: token }）。 */
function unwrapNewpiEnvelopeOrFirst<T>(value: unknown): T {
  if (value && typeof value === "object" && "data" in value) {
    return unwrapNewapiEnvelope<T>(value);
  }
  return value as T;
}

function parseJsonSafe(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function mapHttpError(response: Response, payload: unknown, rawText: string, method: string, path: string): NewapiError {
  const message = extractErrorMessage(payload, rawText) || `Newapi ${response.status}`;
  const code = extractErrorCode(payload);
  const isAuth = response.status === 401 || response.status === 403;
  if (isAuth) {
    return new NewapiAuthError(message, { status: response.status, payload, endpoint: path, method, code });
  }
  return new NewapiError(message, { status: response.status, code, payload, endpoint: path, method });
}

function extractErrorMessage(payload: unknown, rawText: string): string {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.message === "string" && obj.message) return obj.message;
    if (typeof obj.msg === "string" && obj.msg) return obj.msg;
    if (typeof obj.error === "string" && obj.error) return obj.error;
  }
  if (typeof payload === "string" && payload) return payload;
  if (rawText && rawText.length < 500) return rawText;
  return "";
}

function extractErrorCode(payload: unknown): string | number | undefined {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.code === "string" || typeof obj.code === "number") return obj.code;
    if (typeof obj.error_code === "string" || typeof obj.error_code === "number") return obj.error_code;
  }
  return undefined;
}

function normalizeQuotaBalance(value: unknown): NewapiQuotaBalance {
  if (!value || typeof value !== "object") return { remainQuota: 0 };
  const obj = value as Record<string, unknown>;
  const remainQuota = num(obj.remain_quota ?? obj.remainQuota) ?? 0;
  const usedQuota = num(obj.used_quota ?? obj.usedQuota);
  const totalQuota = num(obj.total_quota ?? obj.totalQuota);
  const currency = typeof obj.currency === "string" ? obj.currency : undefined;
  const usdEquivalent = num(obj.usd_equivalent ?? obj.usdEquivalent) ?? (remainQuota > 0 ? remainQuota / 500_000 : 0);
  const result: NewapiQuotaBalance = { remainQuota, usdEquivalent };
  if (usedQuota !== undefined) result.usedQuota = usedQuota;
  if (totalQuota !== undefined) result.totalQuota = totalQuota;
  if (currency) result.currency = currency;
  return result;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function pickGroupRatio(target: string, groups: NewapiUserGroup[]): number {
  const match = groups.find((g) => g.name === target);
  if (match && typeof match.ratio === "number" && match.ratio > 0) return match.ratio;
  return 1;
}

function estimatePromptTokens(req: NewapiChatCompletionRequest): number {
  let chars = 0;
  for (const msg of req.messages) {
    if (typeof msg.content === "string") chars += msg.content.length;
    else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && typeof part.text === "string") chars += part.text.length;
      }
    }
  }
  // 启发式：英文 1 token ≈ 4 字符，中文 ≈ 1.5 字符
  return Math.max(1, Math.ceil(chars / 3));
}
