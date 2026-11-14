// §5.3 `providers` module: providers_*, agent_auth_status, account_get_api_key / account_set_api_key.
import { invoke } from "../ipc";
import type { AuthStatus } from "./session";

export async function agentAuthStatus(): Promise<AuthStatus> {
  return invoke<AuthStatus>("agent_auth_status");
}

// ---------- provider config (BYOK) ----------

export type ProviderKind =
  | "anthropic"
  | "openai"
  | "grok"
  | "deepseek"
  | "qwen"
  | "custom"
  | "custom_anthropic";


export type ApiBackend = "chat_completions" | "responses" | "messages";


export type AuthScheme = "bearer" | "x_api_key";

/**
 * One connection/auth profile — written to `[model_providers.<id>]`. A single
 * provider holds one api_key / base_url shared by every model that references
 * it via `providerId`.
 */
export interface ModelProviderEntry {
  /** Stable id derived from providerKind (e.g. "openai", "custom-2"). */
  id: string;
  providerKind: ProviderKind;
  label?: string;
  /** Masked "••••" when read back; the real secret when saving. */
  apiKey?: string;
  baseUrl?: string;
  apiBackend?: ApiBackend;
  authScheme?: AuthScheme;
  /** Max context window in tokens, shared by all referencing models. */
  contextWindow?: number;
}

/** Pi thinking levels (`max` only where the model maps it). */
export type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const PI_THINKING_LEVELS: PiThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export const THINKING_LABELS: Record<string, string> = { off: "关闭", minimal: "最少", low: "低", medium: "中", high: "高", xhigh: "超高", max: "极限" };
export interface ModelCompat {
  thinkingFormat?: string;
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  supportsReasoningEffort?: boolean;
  supportsDeveloperRole?: boolean;
  requiresReasoningContentOnAssistantMessages?: boolean;
  supportsUsageInStreaming?: boolean;
  supportsStore?: boolean;
  supportsStrictMode?: boolean;
}

/**
 * One model catalog entry — written to `[model.<modelId>]` with a
 * `model_provider = "<providerId>"` reference. Carries only model-specific
 * fields; connection config lives on the provider.
 */
export interface ModelEntry {
  modelKey?: string;
  availableThinkingLevels?: string[];
  /** The `[model.<id>]` key AND the model slug sent in requests. */
  modelId: string;
  /** References a ModelProviderEntry.id. */
  providerId: string;
  
  name?: string;
  /** Per-model context-window override (wins over the provider's value). */
  contextWindow?: number;
  input?: ("text" | "image")[];
  reasoning?: boolean;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  pricingKnown?: boolean;
  compat?: ModelCompat;
  /** Provider value per thinking level; null marks a level unsupported. */
  thinkingLevelMap?: Partial<Record<PiThinkingLevel, string | null>>;
}

/** Result of providers_list: every provider + every model, joined by providerId. */
export interface ProviderListModel {
  providers: ModelProviderEntry[];
  models: ModelEntry[];
}

/**
 * Convenience: flatten the joined list back into per-model option rows for
 * pickers that only need { id, label }. Each model is joined with its
 * provider so consumers keep using a flat array.
 */
export interface ModelOptionRow {
  id: string;
  modelId: string;
  providerLabel: string;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  contextWindow?: number;
  availableThinkingLevels?: string[];
  label: string;
  providerKind: ProviderKind;
  providerId: string;
}

/** Flatten a ProviderListModel into per-model rows (id + label + provider). */
export function flattenModels(list: ProviderListModel): ModelOptionRow[] {
  return list.models.map((m) => {
    const provider = list.providers.find((p) => p.id === m.providerId);
    return {
      id: m.modelKey ?? `model:${encodeURIComponent(m.providerId)}/${encodeURIComponent(m.modelId)}`,
      modelId: m.modelId,
      providerLabel: provider?.label || provider?.id || m.providerId,
      reasoning: m.reasoning,
      input: m.input,
      contextWindow: m.contextWindow ?? provider?.contextWindow,
      availableThinkingLevels: m.availableThinkingLevels,
      label: m.name || m.modelId,
      providerKind: (provider?.providerKind ?? "custom") as ProviderKind,
      providerId: m.providerId,
    };
  });
}

export async function providersList(): Promise<ProviderListModel> {
  return invoke<ProviderListModel>("providers_list");
}

export async function providersSaveProvider(provider: ModelProviderEntry): Promise<void> {
  await invoke<void>("providers_save_provider", { provider });
}

export async function providersSaveModel(model: ModelEntry): Promise<void> {
  await invoke<void>("providers_save_model", { model });
}

export async function providersDeleteProvider(id: string): Promise<void> {
  await invoke<void>("providers_delete_provider", { id });
}

export async function providersDeleteModel(modelId: string, providerId?: string): Promise<void> {
  await invoke<void>("providers_delete_model", { modelId, providerId });
}

/** One model entry returned by a provider's GET /models endpoint, with reported capabilities. */
export interface FetchedModel {
  id: string;
  ownedBy?: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  cost?: ModelEntry["cost"];
  thinkingLevels?: PiThinkingLevel[];
  /** Fields to save with the model (capabilities, thinking map, compat). */
  suggested: Partial<ModelEntry>;
}

export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  reply?: string;
  modelCount?: number;
  /** The base URL that answered (e.g. ".../v1" appended) — store this one. */
  baseUrl?: string;
  usage?: { input: number; output: number };
}
/**
 * 测试连接: `{ providerId, modelId }` sends one tiny real request through the chat path;
 * connection fields alone (editor before saving) list the endpoint's models.
 */
export async function providersTest(input: { providerId?: string; modelId?: string; providerKind?: ProviderKind; apiBackend?: ApiBackend; baseUrl?: string; apiKey?: string }): Promise<ProviderTestResult> {
  return invoke<ProviderTestResult>("providers_test", clean(input));
}
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;

/**
 * Fetch the list of available models from a provider's `/models` endpoint.
 * Works for any OpenAI-compatible endpoint and for Anthropic. The `apiKey` is
 * used only for this request — it is never persisted. Pass `baseUrl` to
 * override the provider's preset (required for `custom`).
 */
export async function providersFetchModels(
  providerKind: ProviderKind,
  apiKey: string,
  baseUrl?: string,
  more: { providerId?: string; apiBackend?: ApiBackend } = {},
): Promise<FetchedModel[]> {
  // With providerId and no key, the saved key is used (never sent back to the renderer).
  return invoke<FetchedModel[]>("providers_fetch_models", clean({ providerKind, apiKey, baseUrl, ...more }));
}

// ---------- xAI API Key 管理 (x.ai/getApiKey / x.ai/setApiKey) ----------
// accountGetAuthUrl/accountCancelAuth）已随 OAuth 功能移除。OpenBuddy 仅保留
// xAI API Key（BYOK）认证路径。


export async function accountGetApiKey(): Promise<string | null> {
  return invoke<string | null>("account_get_api_key");
}

/** Set or clear the xAI API key. Empty/null clears it. */
export async function accountSetApiKey(key: string | null): Promise<void> {
  await invoke<void>("account_set_api_key", { key });
}
