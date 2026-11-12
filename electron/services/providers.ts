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
  compat?: Record<string, boolean>;
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
export function modelKey(providerId:string,modelId:string) {return `model:${encodeURIComponent(providerId)}/${encodeURIComponent(modelId)}`;}
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
        return {
          ...m,
          modelKey: modelKey(m.providerId,m.modelId),
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
      if(!['messages','responses','chat_completions'].includes(p.apiBackend))throw Error(`unsupported_api_backend: ${p.apiBackend}`);
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
    const provider: Provider = {
      id,
      providerKind: kind,
      baseUrl: endpoint(
        text(p.baseUrl ?? previous?.baseUrl ?? preset?.baseUrl, "baseUrl"),
      ),
      apiBackend,
      authScheme,
    };
    if (p.label !== undefined) provider.label = String(p.label);
    if (p.contextWindow !== undefined)
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
    if (m.compat !== undefined) {
      const compat = object(m.compat),
        allowed = [
          "supportsUsageInStreaming",
          "supportsDeveloperRole",
          "supportsStore",
          "supportsReasoningEffort",
          "supportsStrictMode",
        ];
      if (
        Object.entries(compat).some(
          ([k, v]) => !allowed.includes(k) || typeof v !== "boolean",
        )
      )
        throw Error("无效的模型兼容设置");
      model.compat = compat as Record<string, boolean>;
    }
    data.models = data.models
      .filter((m) => m.modelId !== model.modelId || m.providerId !== model.providerId)
      .concat(model);
    this.catalog.write(data);
    await this.sync();
  }
  async deleteProvider(id: string) {
    const data = this.catalog.read();
    data.providers = data.providers.filter((p) => p.id !== id);
    const config=this.settings.config.read();
    const removedDefault=data.models.find(m=>m.providerId===id&&(config.defaults.defaultModel===modelKey(id,m.modelId)||(config.defaults.defaultModel===m.modelId&&(!config.defaults.defaultProviderId||config.defaults.defaultProviderId===id))));
    if(removedDefault){config.defaults.defaultModel=modelKey(id,removedDefault.modelId);config.defaults.defaultProviderId=id;this.settings.config.write(config);}
    data.models = data.models.filter((m) => m.providerId !== id);
    this.settings.secrets.set(`provider:${id}`, undefined);
    await this.runtime.removeRuntimeApiKey(id);
    this.catalog.write(data);
    await this.sync();
  }
  async deleteModel(id: string,providerId?:string) {
    const selected=this.entry(id,providerId);if(!selected)throw Error('model_not_found: 模型不存在');
    const data = this.catalog.read();
    data.models = data.models.filter((m) => m.modelId !== selected.modelId || m.providerId !== selected.providerId);
    this.catalog.write(data);
    const config=this.settings.config.read();
    if(config.defaults.defaultModel===modelKey(selected.providerId,selected.modelId)||(config.defaults.defaultModel===selected.modelId&&(!config.defaults.defaultProviderId||config.defaults.defaultProviderId===selected.providerId))){config.defaults.defaultModel=modelKey(selected.providerId,selected.modelId);config.defaults.defaultProviderId=selected.providerId;this.settings.config.write(config);}
    await this.sync();
  }
  entry(id?:string,providerId?:string):Model|undefined {
    const data=this.catalog.read();
    if(!id){const defaults=this.settings.config.read().defaults;if(defaults.defaultModel)return this.entry(defaults.defaultModel,defaults.defaultProviderId);return data.models.find(m=>this.settings.secrets.has(`provider:${m.providerId}`))??data.models[0];}
    const exact=data.models.find(m=>modelKey(m.providerId,m.modelId)===id&&(!providerId||m.providerId===providerId));if(exact)return exact;
    const matches=data.models.filter(m=>m.modelId===id&&(!providerId||m.providerId===providerId));
    if(matches.length>1)throw Error('ambiguous_model: 请同时指定providerId和modelId');
    return matches[0];
  }
  model(id?: string,providerId?:string) {
    const m=this.entry(id,providerId);
    return m?this.runtime.getModel(m.providerId,m.modelId):undefined;
  }
  defaults() {
    const defaults=this.settings.config.read().defaults;
    if(!defaults.defaultModel)return {...defaults,defaultProviderId:undefined,invalidDefault:false};
    let entry:Model|undefined;
    try{entry=this.entry(defaults.defaultModel,defaults.defaultProviderId);}catch{return {...defaults,invalidDefault:true};}
    if(!entry)return {...defaults,invalidDefault:true};
    return {...defaults,defaultModel:modelKey(entry.providerId,entry.modelId),defaultProviderId:entry.providerId,invalidDefault:false};
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
  async fetchModels(p: Record<string, unknown>) {
    const kind = text(p.providerKind),
      base = endpoint(text(p.baseUrl ?? presets[kind]?.baseUrl, "baseUrl")),
      key = text(p.apiKey, "apiKey");
    if (key === "••••") throw Error("请重新填写 API Key");
    const headers: Record<string, string> = kind.includes("anthropic")
      ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${key}` };
    const response = await fetch(
      `${base.endsWith("/v1") || !kind.includes("anthropic") ? base : `${base}/v1`}/models`,
      { headers, signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok) throw Error(`模型列表请求失败 HTTP ${response.status}`);
    const json = (await response.json()) as {
      data?: Array<{ id?: string; owned_by?: string }>;
    };
    if (!Array.isArray(json.data)) throw Error("响应缺少 data 数组");
    return json.data
      .filter((m) => typeof m.id === "string")
      .map((m) => ({ id: m.id!, ownedBy: m.owned_by }));
  }
}
function positive(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw Error("contextWindow 必须为正整数");
  return value;
}
