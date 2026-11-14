import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { JsonStore, object, text, type Settings } from "./settings.js";

interface Provider {
  id: string;
  providerKind: string;
  label?: string;
  baseUrl: string;
  apiBackend: string;
  authScheme: string;
  contextWindow?: number;
}
type RuntimeModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;
interface Model {
  modelId: string;
  providerId: string;
  name?: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  maxTokens?: number;
  cost?: RuntimeModel["cost"];
  compat?: Record<string, boolean | string>;
  /** Provider value per Pi thinking level; null = unsupported (see Pi `thinkingLevelMap`). */
  thinkingLevelMap?: Partial<Record<PiLevel, string | null>>;
}
const PI_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type PiLevel = (typeof PI_LEVELS)[number];
const THINKING_FORMATS = ["openai", "deepseek", "zai", "qwen", "openrouter", "together", "string-thinking"];
const COMPAT_FLAGS = [
  "supportsUsageInStreaming",
  "supportsDeveloperRole",
  "supportsStore",
  "supportsReasoningEffort",
  "supportsStrictMode",
  "requiresReasoningContentOnAssistantMessages",
];
/** Provider ids double as secret names and Pi provider ids (legacy ids may contain "/"). */
const PROVIDER_ID = /^[^\s\u0000-\u001f]{1,64}$/;

/** A model listed by GET /models, with whatever capabilities the endpoint reported. */
export interface FetchedModel {
  id: string;
  ownedBy?: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  cost?: Model["cost"];
  /** Pi thinking levels this model accepts (from reported effort values). */
  thinkingLevels?: PiLevel[];
  /** Ready to pass to providers_save_model (capabilities + thinking map + compat). */
  suggested: Omit<Model, "modelId" | "providerId">;
}
const num = (...values: unknown[]) => {
  for (const v of values) {
    const n = typeof v === "string" && v.trim() ? Number(v) : v;
    if (typeof n === "number" && Number.isSafeInteger(n) && n > 0) return n;
  }
  return undefined;
};
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
const rec = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
/**
 * Read capabilities from one `/models` entry. Understands the common shapes: OpenAI-style
 * gateways (context_window / max_output_tokens / input_modalities / control_parameters),
 * OpenRouter (context_length / architecture / top_provider / pricing per token) and
 * Anthropic (display_name / max_input_tokens).
 */
export function describeFetchedModel(raw: Record<string, any>, apiBackend: string): FetchedModel {
  const id = String(raw.id);
  const name = [raw.display_name, raw.name].find((v) => typeof v === "string" && v && v !== id) as string | undefined;
  const contextWindow = num(raw.context_window, raw.context_length, raw.contextLen, raw.max_input_tokens, raw.top_provider?.context_length);
  const maxTokens = num(raw.max_output_tokens, raw.max_completion_tokens, raw.top_provider?.max_completion_tokens, raw.max_tokens);
  const modalities = strings(raw.input_modalities) ?? strings(raw.architecture?.input_modalities) ?? strings(raw.supported_modalities);
  const image = raw.supports_image_in === true || raw.supports_vision === true || !!modalities?.some((m) => m === "image" || m === "image_url");
  const known = modalities !== undefined || typeof raw.supports_image_in === "boolean" || typeof raw.supports_vision === "boolean";
  const params = strings(raw.supported_parameters);
  const control = rec(rec(raw.control_parameters)[apiBackend === "messages" ? "anthropic" : "openai"]);
  const efforts =
    strings(control.reasoning_effort) ??
    strings(rec(control.output_config).effort) ??
    strings(rec(raw.effort).supported_levels);
  const toggle = strings(rec(control.thinking).type);
  const reasoning =
    typeof raw.supports_reasoning === "boolean" ? raw.supports_reasoning
      : params?.some((p) => p === "reasoning" || p === "reasoning_effort" || p === "include_reasoning") ? true
        : efforts?.length ? true : undefined;
  const suggested: FetchedModel["suggested"] = {};
  if (name) suggested.name = name;
  if (contextWindow) suggested.contextWindow = contextWindow;
  if (maxTokens) suggested.maxTokens = maxTokens;
  if (reasoning !== undefined) suggested.reasoning = reasoning;
  if (known) suggested.input = image ? ["text", "image"] : ["text"];
  const pricing = rec(raw.pricing);
  const perM = (v: unknown) => { const n = typeof v === "string" ? Number(v) : v; return typeof n === "number" && Number.isFinite(n) && n >= 0 ? +(n * 1e6).toFixed(6) : undefined; };
  if (perM(pricing.prompt) !== undefined && perM(pricing.completion) !== undefined)
    suggested.cost = { input: perM(pricing.prompt)!, output: perM(pricing.completion)!, cacheRead: perM(pricing.input_cache_read) ?? 0, cacheWrite: perM(pricing.input_cache_write) ?? 0 };
  let thinkingLevels: PiLevel[] | undefined;
  if (reasoning && efforts?.length) {
    // Each Pi level maps to the same-named provider value when the model reports it;
    // the others are marked unsupported so pickers only offer what really works.
    const map: Partial<Record<PiLevel, string | null>> = {};
    for (const level of PI_LEVELS) {
      if (level === "off") continue;
      if (efforts.includes(level)) map[level] = level;
      else if (level !== "xhigh" && level !== "max") map[level] = null;
    }
    if (toggle && !toggle.includes("disabled")) map.off = null;
    suggested.thinkingLevelMap = map;
    thinkingLevels = PI_LEVELS.filter((l) => (l === "off" ? map.off !== null : typeof map[l] === "string"));
    if (apiBackend !== "messages") suggested.compat = { supportsReasoningEffort: true, ...(toggle ? { thinkingFormat: "deepseek" } : {}) };
  } else if (reasoning && toggle && apiBackend !== "messages") {
    suggested.compat = { thinkingFormat: "deepseek", supportsReasoningEffort: false };
  }
  return {
    id,
    ...(typeof raw.owned_by === "string" ? { ownedBy: raw.owned_by } : {}),
    ...(name ? { name } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(suggested.input ? { input: suggested.input } : {}),
    ...(suggested.cost ? { cost: suggested.cost } : {}),
    ...(thinkingLevels ? { thinkingLevels } : {}),
    suggested,
  };
}
const presets: Record<
  string,
  { baseUrl: string; apiBackend: string; authScheme: string }
> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    apiBackend: "chat_completions",
    authScheme: "bearer",
  },
  grok: {
    baseUrl: "https://api.x.ai/v1",
    apiBackend: "chat_completions",
    authScheme: "bearer",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    apiBackend: "chat_completions",
    authScheme: "bearer",
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiBackend: "chat_completions",
    authScheme: "bearer",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    apiBackend: "messages",
    authScheme: "x_api_key",
  },
};
export function modelKey(providerId: string, modelId: string) {
  return `model:${encodeURIComponent(providerId)}/${encodeURIComponent(modelId)}`;
}
function endpoint(value: string) {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("无效的 API URL");
  return value.replace(/\/$/, "");
}
export class Providers {
  private catalog: JsonStore<{ providers: Provider[]; models: Model[] }>;
  runtime!: ModelRuntime;
  private builtins = new Map<string, RuntimeModel>();
  constructor(private settings: Settings) {
    this.catalog = new JsonStore(join(settings.dir, "providers.json"), () => ({
      providers: [],
      models: [],
    }));
  }
  async initialize() {
    this.runtime = await ModelRuntime.create({
      credentials: {
        read: async () => undefined,
        list: async () => [],
        modify: async (_id, fn) => fn(undefined),
        delete: async () => {},
      },
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    this.builtins = new Map(
      this.runtime
        .getModels()
        .map((model) => [`${model.provider}/${model.id}`, model]),
    );
    await this.sync();
  }
  private builtin(provider: Provider, model: Model) {
    const catalogProvider =
      provider.providerKind === "grok" ? "xai" : provider.providerKind;
    return this.builtins.get(`${catalogProvider}/${model.modelId}`);
  }
  list() {
    const data = this.catalog.read();
    return {
      models: data.models.map((m) => {
        const provider = data.providers.find((p) => p.id === m.providerId),
          builtin = provider ? this.builtin(provider, m) : undefined;
        const cost = m.cost ?? builtin?.cost;
        const runtimeModel = provider ? this.runtime.getModel(m.providerId, m.modelId) : undefined;
        return {
          ...m,
          availableThinkingLevels: runtimeModel ? supportedLevels(runtimeModel) : undefined,
          modelKey: modelKey(m.providerId, m.modelId),
          input: m.input ?? builtin?.input ?? ["text"],
          reasoning: m.reasoning ?? builtin?.reasoning ?? false,
          maxTokens: m.maxTokens ?? builtin?.maxTokens ?? 8192,
          cost,
          pricingKnown: cost !== undefined,
        };
      }),
      providers: data.providers.map((p) => ({
        ...p,
        apiKey: this.settings.secrets.has(`provider:${p.id}`)
          ? "••••"
          : undefined,
      })),
    };
  }
  async sync() {
    for (const id of this.runtime.getRegisteredProviderIds())
      this.runtime.unregisterProvider(id);
    const data = this.catalog.read();
    for (const p of data.providers) {
      if (!["messages", "responses", "chat_completions"].includes(p.apiBackend))
        throw Error(`unsupported_api_backend: ${p.apiBackend}`);
      const api =
        p.apiBackend === "messages"
          ? "anthropic-messages"
          : p.apiBackend === "responses"
            ? "openai-responses"
            : "openai-completions";
      this.runtime.registerProvider(p.id, {
        baseUrl: p.baseUrl,
        api,
        authHeader: p.authScheme === "bearer",
        models: data.models
          .filter((m) => m.providerId === p.id)
          .map((m) => {
            const builtin = this.builtin(p, m);
            return {
              id: m.modelId,
              name: m.name ?? builtin?.name ?? m.modelId,
              reasoning: m.reasoning ?? builtin?.reasoning ?? false,
              input: m.input ?? builtin?.input ?? ["text"],
              // Pi requires a numeric cost for its internal accumulator. Unknown prices
              // are exposed as cost:undefined/pricingKnown:false in providers_list.
              cost: m.cost ??
                builtin?.cost ?? {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
              contextWindow:
                m.contextWindow ??
                p.contextWindow ??
                builtin?.contextWindow ??
                128000,
              maxTokens: m.maxTokens ?? builtin?.maxTokens ?? 8192,
              ...(m.thinkingLevelMap ?? builtin?.thinkingLevelMap ? { thinkingLevelMap: m.thinkingLevelMap ?? builtin?.thinkingLevelMap } : {}),
              compat: {
                ...(api === "openai-completions"
                  ? { supportsDeveloperRole: false, supportsStore: false }
                  : {}),
                ...builtin?.compat,
                ...m.compat,
              },
            };
          }),
      });
      const key = this.settings.secrets.get(`provider:${p.id}`);
      if (key) await this.runtime.setRuntimeApiKey(p.id, key);
      else await this.runtime.removeRuntimeApiKey(p.id);
    }
  }
  async saveProvider(value: unknown) {
    const p = object(value),
      id = text(p.id, "provider.id"),
      kind = text(p.providerKind, "providerKind");
    if (!PROVIDER_ID.test(id)) throw Error("厂商标识不能为空或包含空白字符");
    const data = this.catalog.read(),
      previous = data.providers.find((p) => p.id === id),
      preset = presets[kind];
    const apiBackend = String(
      p.apiBackend ??
        previous?.apiBackend ??
        preset?.apiBackend ??
        (kind === "custom_anthropic" ? "messages" : "chat_completions"),
    );
    const authScheme = String(
      p.authScheme ??
        previous?.authScheme ??
        preset?.authScheme ??
        (apiBackend === "messages" ? "x_api_key" : "bearer"),
    );
    if (!["chat_completions", "responses", "messages"].includes(apiBackend))
      throw Error("不支持的 API 协议");
    if (authScheme !== (apiBackend === "messages" ? "x_api_key" : "bearer"))
      throw Error("当前 SDK 不支持该协议与认证头组合");
    let baseUrl = endpoint(text(p.baseUrl ?? previous?.baseUrl ?? preset?.baseUrl, "baseUrl"));
    // The Anthropic SDK appends /v1/messages itself: a pasted ".../v1" would become /v1/v1.
    if (apiBackend === "messages") baseUrl = baseUrl.replace(/\/v1$/, "");
    const provider: Provider = {
      id,
      providerKind: kind,
      baseUrl,
      apiBackend,
      authScheme,
    };
    if (p.label !== undefined) { if (String(p.label).trim()) provider.label = String(p.label).trim().slice(0, 60); }
    else if (previous?.label) provider.label = previous.label;
    if (p.contextWindow !== undefined && p.contextWindow !== null)
      provider.contextWindow = positive(p.contextWindow);
    if (p.apiKey !== undefined && p.apiKey !== "••••")
      this.settings.secrets.set(
        `provider:${id}`,
        typeof p.apiKey === "string" && p.apiKey ? p.apiKey : undefined,
      );
    data.providers = data.providers.filter((p) => p.id !== id).concat(provider);
    this.catalog.write(data);
    await this.sync();
  }
  async saveModel(value: unknown) {
    const m = object(value),
      model: Model = {
        modelId: text(m.modelId),
        providerId: text(m.providerId),
      };
    const data = this.catalog.read();
    if (!data.providers.some((p) => p.id === model.providerId))
      throw Error("提供商不存在");
    if (m.name) model.name = String(m.name);
    if (m.contextWindow !== undefined)
      model.contextWindow = positive(m.contextWindow);
    if (m.reasoning !== undefined) {
      if (typeof m.reasoning !== "boolean")
        throw Error("reasoning必须为布尔值");
      model.reasoning = m.reasoning;
    }
    if (m.input !== undefined) {
      if (
        !Array.isArray(m.input) ||
        m.input.length === 0 ||
        !m.input.every((v) => v === "text" || v === "image")
      )
        throw Error("input仅支持text/image");
      model.input = [...new Set(m.input)] as ("text" | "image")[];
    }
    if (m.maxTokens !== undefined) model.maxTokens = positive(m.maxTokens);
    if (m.cost !== undefined) {
      const cost = object(m.cost);
      for (const key of ["input", "output", "cacheRead", "cacheWrite"])
        if (
          typeof cost[key] !== "number" ||
          !Number.isFinite(cost[key]) ||
          (cost[key] as number) < 0
        )
          throw Error("cost必须包含非负input/output/cacheRead/cacheWrite");
      model.cost = {
        input: cost.input as number,
        output: cost.output as number,
        cacheRead: cost.cacheRead as number,
        cacheWrite: cost.cacheWrite as number,
      };
    }
    if (m.compat !== undefined && m.compat !== null) {
      const compat = object(m.compat);
      const valid = ([k, v]: [string, unknown]) =>
        (COMPAT_FLAGS.includes(k) && typeof v === "boolean") ||
        (k === "thinkingFormat" && typeof v === "string" && THINKING_FORMATS.includes(v)) ||
        (k === "maxTokensField" && (v === "max_tokens" || v === "max_completion_tokens"));
      if (!Object.entries(compat).every(valid)) throw Error("无效的模型兼容设置");
      if (Object.keys(compat).length) model.compat = compat as Record<string, boolean | string>;
    }
    if (m.thinkingLevelMap !== undefined && m.thinkingLevelMap !== null) {
      const map = object(m.thinkingLevelMap);
      if (!Object.entries(map).every(([k, v]) => (PI_LEVELS as readonly string[]).includes(k) && (v === null || (typeof v === "string" && v.length > 0 && v.length <= 32))))
        throw Error("无效的思考档位映射");
      if (Object.keys(map).length) model.thinkingLevelMap = map as Model["thinkingLevelMap"];
    }
    data.models = data.models
      .filter(
        (m) => m.modelId !== model.modelId || m.providerId !== model.providerId,
      )
      .concat(model);
    this.catalog.write(data);
    await this.sync();
  }
  async deleteProvider(id: string) {
    const data = this.catalog.read();
    data.providers = data.providers.filter((p) => p.id !== id);
    const config = this.settings.config.read();
    const removedDefault = data.models.find(
      (m) =>
        m.providerId === id &&
        (config.defaults.defaultModel === modelKey(id, m.modelId) ||
          (config.defaults.defaultModel === m.modelId &&
            (!config.defaults.defaultProviderId ||
              config.defaults.defaultProviderId === id))),
    );
    if (removedDefault) {
      config.defaults.defaultModel = modelKey(id, removedDefault.modelId);
      config.defaults.defaultProviderId = id;
      this.settings.config.write(config);
    }
    data.models = data.models.filter((m) => m.providerId !== id);
    this.settings.secrets.set(`provider:${id}`, undefined);
    await this.runtime.removeRuntimeApiKey(id);
    this.catalog.write(data);
    await this.sync();
  }
  async deleteModel(id: string, providerId?: string) {
    const selected = this.entry(id, providerId);
    if (!selected) throw Error("model_not_found: 模型不存在");
    const data = this.catalog.read();
    data.models = data.models.filter(
      (m) =>
        m.modelId !== selected.modelId || m.providerId !== selected.providerId,
    );
    this.catalog.write(data);
    const config = this.settings.config.read();
    if (
      config.defaults.defaultModel ===
        modelKey(selected.providerId, selected.modelId) ||
      (config.defaults.defaultModel === selected.modelId &&
        (!config.defaults.defaultProviderId ||
          config.defaults.defaultProviderId === selected.providerId))
    ) {
      config.defaults.defaultModel = modelKey(
        selected.providerId,
        selected.modelId,
      );
      config.defaults.defaultProviderId = selected.providerId;
      this.settings.config.write(config);
    }
    await this.sync();
  }
  entry(id?: string, providerId?: string): Model | undefined {
    const data = this.catalog.read();
    if (!id) {
      const defaults = this.settings.config.read().defaults;
      if (defaults.defaultModel)
        return this.entry(defaults.defaultModel, defaults.defaultProviderId);
      return (
        data.models.find((m) =>
          this.settings.secrets.has(`provider:${m.providerId}`),
        ) ?? data.models[0]
      );
    }
    const exact = data.models.find(
      (m) =>
        modelKey(m.providerId, m.modelId) === id &&
        (!providerId || m.providerId === providerId),
    );
    if (exact) return exact;
    const matches = data.models.filter(
      (m) => m.modelId === id && (!providerId || m.providerId === providerId),
    );
    if (matches.length > 1)
      throw Error("ambiguous_model: 请同时指定providerId和modelId");
    return matches[0];
  }
  model(id?: string, providerId?: string) {
    const m = this.entry(id, providerId);
    return m ? this.runtime.getModel(m.providerId, m.modelId) : undefined;
  }
  defaults() {
    const defaults = this.settings.config.read().defaults;
    if (!defaults.defaultModel)
      return {
        ...defaults,
        defaultProviderId: undefined,
        invalidDefault: false,
      };
    let entry: Model | undefined;
    try {
      entry = this.entry(defaults.defaultModel, defaults.defaultProviderId);
    } catch {
      return { ...defaults, invalidDefault: true };
    }
    if (!entry) return { ...defaults, invalidDefault: true };
    return {
      ...defaults,
      defaultModel: modelKey(entry.providerId, entry.modelId),
      defaultProviderId: entry.providerId,
      invalidDefault: false,
    };
  }
  async authStatus() {
    const list = this.list();
    const ready = list.models.some((m) =>
      this.settings.secrets.has(`provider:${m.providerId}`),
    );
    return {
      ready,
      hasAuthFile: false,
      providers: list.models.map((m) => m.modelId),
      reason: ready ? undefined : "请配置模型和 API Key",
    };
  }
  /**
   * GET <baseUrl>/models. With `providerId` the saved connection (and key) is used unless
   * the caller passes a new key / URL — so 拉取模型 never asks for the key again.
   */
  async fetchModels(p: Record<string, unknown>): Promise<FetchedModel[]> {
    return (await this.listRemote(p)).models;
  }
  private async listRemote(p: Record<string, unknown>): Promise<{ models: FetchedModel[]; baseUrl: string }> {
    const saved = typeof p.providerId === "string" ? this.catalog.read().providers.find((x) => x.id === p.providerId) : undefined;
    const kind = typeof p.providerKind === "string" ? p.providerKind : saved?.providerKind ?? "";
    const apiBackend = typeof p.apiBackend === "string" ? p.apiBackend : saved?.apiBackend ?? (kind.includes("anthropic") ? "messages" : "chat_completions");
    const base = endpoint(text(p.baseUrl || saved?.baseUrl || presets[kind]?.baseUrl, "baseUrl"));
    const typed = typeof p.apiKey === "string" && p.apiKey && p.apiKey !== "••••" ? p.apiKey : undefined;
    const key = typed ?? (saved ? this.settings.secrets.get(`provider:${saved.id}`) : undefined);
    if (!key) throw Error("请填写 API Key");
    const anthropic = apiBackend === "messages";
    const headers: Record<string, string> = anthropic
      ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${key}` };
    // OpenAI-style gateways are usually served under /v1 (Pi appends /chat/completions to the
    // base as is), so ".../coding" is retried as ".../coding/v1"; the first answer that lists
    // models wins and is reported back so the editor can store the working base.
    const candidates = anthropic ? [base] : base.endsWith("/v1") ? [base] : [base, `${base}/v1`];
    let failure = "";
    for (const candidate of candidates) {
      const url = `${anthropic && !candidate.endsWith("/v1") ? `${candidate}/v1` : candidate}/models`;
      let response: Response;
      try {
        response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      } catch (error) {
        failure = `无法连接到 ${new URL(url).host}：${error instanceof Error ? error.message : String(error)}`;
        continue;
      }
      if (!response.ok) {
        // A gateway can answer 401 for an unknown path: keep the first error unless a later
        // candidate gives a better one.
        const status = `模型列表请求失败 HTTP ${response.status}${response.status === 401 || response.status === 403 ? "（API Key 无效或无权限）" : response.status === 404 ? "（Base URL 不对？）" : ""}`;
        if (!failure || candidate === base) failure = status;
        continue;
      }
      const json = (await response.json().catch(() => ({}))) as { data?: Array<Record<string, any>> };
      if (!Array.isArray(json.data)) { failure ||= "响应缺少 data 数组（不是 OpenAI / Anthropic 兼容的模型列表）"; continue; }
      return {
        baseUrl: candidate,
        models: json.data
          .filter((m) => m && typeof m.id === "string" && (m.type === undefined || m.type === "chat" || m.type === "model"))
          .map((m) => describeFetchedModel(m, apiBackend)),
      };
    }
    throw Error(failure || "模型列表请求失败");
  }
  /**
   * 测试连接. With a saved model: one tiny real request through the same Pi path a chat
   * uses. Without one (the editor, before saving): list the endpoint's models.
   */
  async test(p: Record<string, unknown>) {
    const started = Date.now();
    const providerId = typeof p.providerId === "string" ? p.providerId : undefined;
    const modelId = typeof p.modelId === "string" ? p.modelId : undefined;
    if (providerId && modelId) {
      const model = this.runtime.getModel(providerId, modelId);
      if (!model) throw Error("model_not_found: 模型不存在");
      if (!this.settings.secrets.has(`provider:${providerId}`)) throw Error("该厂商还没有保存 API Key");
      const reply = await this.runtime.completeSimple(
        model,
        { messages: [{ role: "user", content: "Reply with: OK", timestamp: Date.now() }] },
        { maxTokens: model.reasoning ? 256 : 16, signal: AbortSignal.timeout(60000) },
      );
      if (reply.stopReason === "error" || reply.stopReason === "aborted")
        return { ok: false, latencyMs: Date.now() - started, error: reply.errorMessage ?? "请求失败" };
      const text = reply.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("").trim();
      return { ok: true, latencyMs: Date.now() - started, reply: text.slice(0, 120), usage: { input: reply.usage.input, output: reply.usage.output } };
    }
    const remote = await this.listRemote(p);
    return { ok: true, latencyMs: Date.now() - started, modelCount: remote.models.length, baseUrl: remote.baseUrl };
  }
}
/** Same rule as Pi's getSupportedThinkingLevels. */
function supportedLevels(model: { reasoning?: boolean; thinkingLevelMap?: Partial<Record<string, string | null>> }): PiLevel[] {
  if (!model.reasoning) return ["off"];
  return PI_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}
function positive(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw Error("contextWindow 必须为正整数");
  return value;
}
