/**
 * OpenBuddy NewAPI Provider Adapter (Path A · 用户侧 BYOK)
 *
 * 目的：让用户可以在 OpenBuddy 设置里把 NewAPI 实例（自托管或第三方）
 *       作为 Provider，无需走 Resource Gateway + 企业积分账本。
 *
 * 与 Resource Gateway 的关系（Path B）：
 *   - 本文件               → 用户配置 Provider 视角（Pi/Agent Runtime 注入 + 模型发现）
 *   - services/casdoor-resource-gateway/src/index.ts
 *                          → 服务端网关视角（REST API 调用 + usage 解析 + 积分账本）
 *   - 两条路径互不替代：BYOK 直接 User↔NewAPI；Path B 经 Gateway 走积分账本
 *
 * NewAPI 兼容性（基于 docs.newapi.pro）：
 *   - 鉴权：Bearer sk-xxx （OpenAI 兼容）
 *   - 端点：POST {baseUrl}/v1/chat/completions
 *   - 协议：chat_completions（推荐）、responses、completions、embeddings、rerank
 *   - 模型列表：GET {baseUrl}/v1/models（Bearer sk-）
 *   - 支持流式 SSE + stream_options.include_usage
 *   - usage 字段：prompt_tokens + completion_tokens + cached_tokens
 *   - 渠道聚合：NewAPI Channel/Group（服务端 Path B 才使用）
 *
 * 本适配器只负责 Provider 注册与模型发现，不参与商业计费。
 * 商业计费（积分/钱包/账本）必须走 Resource Gateway（参见 services/casdoor-resource-gateway）。
 */

export const NEWAPI_PROVIDER_ID = "newapi" as const;

export interface NewapiProviderDefaults {
  /** 推荐的 base URL（用户可改）。 */
  defaultBaseUrl: string;
  /** 推荐的鉴权 scheme。 */
  defaultAuthScheme: "bearer";
  /** 推荐的 API backend。 */
  defaultApiBackend: "chat_completions" | "responses";
  /** 默认上下文窗口（NewAPI 多数渠道 128k）。 */
  defaultContextWindow: number;
  /** 用户在设置 UI 显示的提示。 */
  setupHint: string;
  /** Provider 显示名。 */
  displayName: string;
}

export const NEWAPI_PROVIDER_DEFAULTS: NewapiProviderDefaults = {
  defaultBaseUrl: "http://124.221.146.145:3000/v1",
  defaultAuthScheme: "bearer",
  defaultApiBackend: "chat_completions",
  defaultContextWindow: 128_000,
  setupHint:
    "NewAPI 是 OpenAI 兼容的模型聚合网关。填入 baseUrl（去掉 /v1 后会自动补 /v1），" +
    "以及 NewAPI 控制台 /api/token 创建的 sk-xxx。模型列表可在「模型」页一键拉取。",
  displayName: "NewAPI（自托管模型聚合网关）",
};

/** NewAPI /v1/models 返回的单个模型条目（节选）。 */
export interface NewapiModelEntry {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

/** NewAPI /v1/models 响应（OpenAI 兼容）。 */
export interface NewapiModelsResponse {
  object?: string;
  data: NewapiModelEntry[];
}

/**
 * 把用户填的 baseUrl 标准化为 NewAPI 兼容的 /v1 根。
 * 接受 "http://x:3000" / "http://x:3000/" / "http://x:3000/v1" 三种输入。
 */
export function normalizeNewapiBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("NewAPI baseUrl 不能为空");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`NewAPI baseUrl 不是合法 URL: ${input}`);
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("NewAPI baseUrl 必须以 http:// 或 https:// 开头");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("NewAPI baseUrl 不允许携带 userinfo / query / fragment");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/") return `${url.protocol}//${url.host}/v1`;
  if (path === "/v1") return `${url.protocol}//${url.host}/v1`;
  // 允许自定义路径前缀，但最终必须保留 /v1
  return `${url.protocol}//${url.host}${path}/v1`;
}

/** 校验 API key（NewAPI 接受任意非空 sk- 开头的 key）。 */
export function isValidNewapiKey(key: string): boolean {
  return typeof key === "string" && key.trim().length >= 6;
}

/**
 * 把 NewAPI 模型条目转为 OpenBuddy ModelEntry。
 * 仅当用户选择 NewAPI provider 时调用。
 */
export function newapiModelToEntry(
  model: NewapiModelEntry,
  providerId: string,
  contextWindow?: number,
): {
  modelId: string;
  providerId: string;
  name?: string;
  contextWindow?: number;
} {
  return {
    modelId: model.id,
    providerId,
    name: model.id,
    contextWindow: contextWindow ?? NEWAPI_PROVIDER_DEFAULTS.defaultContextWindow,
  };
}

/** 浏览器/Node fetch 拉取 NewAPI /v1/models。 */
export async function fetchNewapiModels(
  baseUrl: string,
  apiKey: string,
  options: { fetchImpl?: typeof fetch; abortSignalFactory?: (ms: number) => AbortSignal; timeoutMs?: number } = {},
): Promise<NewapiModelEntry[]> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const abortFactory = options.abortSignalFactory ?? ((ms: number) => AbortSignal.timeout(ms));
  const url = `${normalizeNewapiBaseUrl(baseUrl)}/models`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    signal: options.timeoutMs ? abortFactory(options.timeoutMs) : undefined,
  });
  if (!response.ok) {
    throw new Error(`NewAPI /v1/models 返回 ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as NewapiModelsResponse;
  if (!body || !Array.isArray(body.data)) {
    throw new Error("NewAPI /v1/models 响应缺少 data 数组");
  }
  return body.data.filter((m) => typeof m?.id === "string" && m.id.length > 0);
}

/** Provider 设置页默认值生成器。 */
export function newapiProviderDefaultsForUi(): {
  providerKind: "newapi";
  label: string;
  baseUrl: string;
  apiKey: string;
  authScheme: "bearer";
  apiBackend: "chat_completions" | "responses";
  contextWindow: number;
} {
  return {
    providerKind: "newapi",
    label: NEWAPI_PROVIDER_DEFAULTS.displayName,
    baseUrl: NEWAPI_PROVIDER_DEFAULTS.defaultBaseUrl,
    apiKey: "",
    authScheme: "bearer",
    apiBackend: NEWAPI_PROVIDER_DEFAULTS.defaultApiBackend,
    contextWindow: NEWAPI_PROVIDER_DEFAULTS.defaultContextWindow,
  };
}
