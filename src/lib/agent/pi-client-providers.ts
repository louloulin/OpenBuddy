import { invoke } from "@/lib/platform/electron-api";

/**
 * OpenBuddy pi-client provider/model surface — typed IPC wrappers for the
 * BYOK provider registry (agent:providers-*) plus the pure type model and
 * flattenModels projection.
 *
 * Extracted from pi-client.ts (Stage 3 architecture split): this surface only
 * depends on the typed preload IPC (`invoke`) and pure provider/model types,
 * so it can be authored and tested independently. pi-client.ts re-exports it
 * via `export *`.
 */

// ---------- provider config (BYOK) ----------

export type ProviderKind =
  | "anthropic"
  | "openai"
  | "pi"
  | "deepseek"
  | "qwen"
  | "minimax"
  | "minimax_openai"
  | "new_api"
  | "orcarouter"
  | "minimax_cn"
  | "custom"
  | "custom_anthropic";

/** API wire protocol. Mirrors pi's ApiBackend enum (snake_case). */
export type ApiBackend = "chat_completions" | "responses" | "messages";

/** HTTP auth header style. Mirrors pi's AuthScheme enum (snake_case). */
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

/**
 * One model catalog entry — written to `[model.<modelId>]` with a
 * `model_provider = "<providerId>"` reference. Carries only model-specific
 * fields; connection config lives on the provider.
 */
export interface ModelEntry {
  /** The model slug used by the provider and stored in models.json. */
  modelId: string;
  /** References a ModelProviderEntry.id. */
  providerId: string;
  /** Human-readable display name (pi's `name` field). */
  name?: string;
  /** Per-model context-window override (wins over the provider's value). */
  contextWindow?: number;
  /**
   * Whether the model supports reasoning / extended thinking. Pi's Model type
   * requires this, and `setThinkingLevel` clamps to "off" when it is false, so
   * omitting it for a reasoning-capable model (e.g. MiniMax-M3) silently
   * disables the thinking-level control and the 深度思考 display.
   */
  reasoning?: boolean;
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
  label: string;
  providerKind: ProviderKind;
  providerId: string;
  /**
   * Wire protocol carried by the provider so the model picker can render the
   * matching badge without re-resolving the provider list. `undefined` when
   * the provider has no apiBackend configured (legacy / unknown preset).
   */
  apiBackend?: ApiBackend;
}

/** Flatten a ProviderListModel into per-model rows (id + label + provider). */
export function flattenModels(list: ProviderListModel): ModelOptionRow[] {
  return list.models.map((m) => {
    const provider = list.providers.find((p) => p.id === m.providerId);
    return {
      id: `${m.providerId}/${m.modelId}`,
      label: m.name || m.modelId,
      providerKind: (provider?.providerKind ?? "custom") as ProviderKind,
      providerId: m.providerId,
      apiBackend: provider?.apiBackend,
    };
  });
}

export async function providersList(): Promise<ProviderListModel> {
  return invoke<ProviderListModel>("agent:providers-list");
}

export async function providersSaveProvider(provider: ModelProviderEntry): Promise<void> {
  await invoke<void>("agent:providers-save-provider", { provider });
}

export async function providersSaveModel(model: ModelEntry): Promise<void> {
  await invoke<void>("agent:providers-save-model", { model });
}

export async function providersDeleteProvider(id: string): Promise<void> {
  await invoke<void>("agent:providers-delete-provider", { id });
}

export async function providersDeleteModel(providerId: string, modelId: string): Promise<void> {
  await invoke<void>("agent:providers-delete-model", { providerId, modelId });
}

/** One model entry returned by a provider's GET /models endpoint. */
export interface FetchedModel {
  id: string;
  ownedBy?: string;
}

/**
 * Fetch the list of available models from a provider's `/models` endpoint.
 * Works for any OpenAI-compatible endpoint and for Anthropic. The `apiKey` is
 * used only for this request — it is never persisted. Pass `baseUrl` to
 * override the provider's preset (required for `custom`).
 */
export async function providersFetchModels(
  providerKind: ProviderKind,
  apiKey?: string,
  baseUrl?: string,
): Promise<FetchedModel[]> {
  return invoke<FetchedModel[]>("agent:providers-fetch-models", {
    providerKind,
    apiKey,
    baseUrl: baseUrl ?? null,
  });
}
