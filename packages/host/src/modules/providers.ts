import { text } from "@openbuddy/services/settings/settings";
import { modelKey } from "@openbuddy/services/providers/providers";
import { DEFAULT_LOCAL_MODEL_CONFIG, LOCAL_MODEL_PROVIDER_ID, type LocalModelConfig, type LocalModelState } from "@openbuddy/protocol/local-model";
import type { Handler, HostContext, HostModule } from "../module.js";

/** Normalize a llama.cpp server address to the OpenAI-compatible `/v1` root. */
function localEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}
function asInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/** §5.3 `providers` module. Provider and model catalog, auth status, legacy account key. */
export function providersModule(ctx: HostContext): HostModule {
  const { settings, emit, engine } = ctx;

  const localState = (): LocalModelState => {
    const stored = settings.config.read().localModel;
    const config: LocalModelConfig = { ...DEFAULT_LOCAL_MODEL_CONFIG, ...(stored ?? {}) };
    return {
      config,
      providerId: LOCAL_MODEL_PROVIDER_ID,
      models: engine.providers.list().models
        .filter((model) => model.providerId === LOCAL_MODEL_PROVIDER_ID)
        .map((model) => ({ modelId: model.modelId, ...(model.name ? { name: model.name } : {}) })),
    };
  };

  const commands: Record<string, Handler> = {
    agent_auth_status: () => engine.providers.authStatus(),
    providers_list: () => engine.providers.list(),
    providers_save_provider: async (p) => {
      await engine.providers.saveProvider(p.provider);
      emit("agent://models-update", {});
    },
    providers_save_model: async (p) => {
      await engine.providers.saveModel(p.model);
      emit("agent://models-update", {});
    },
    providers_delete_provider: async (p) => {
      await engine.providers.deleteProvider(text(p.id));
      emit("agent://models-update", {});
    },
    providers_delete_model: async (p) => {
      await engine.providers.deleteModel(
        text(p.modelId),
        typeof p.providerId === "string" ? p.providerId : undefined,
      );
      emit("agent://models-update", {});
    },
    providers_fetch_models: (p) => engine.providers.fetchModels(p),
    providers_test: (p) => engine.providers.test(p),
    // 本地模型 (W8): probe an OpenAI-compatible llama-server and materialize it as a provider.
    providers_local_get: () => localState(),
    providers_local_probe: async (p) => {
      const endpoint = localEndpoint(text(p.baseUrl));
      const started = Date.now();
      try {
        const response = await fetch(`${endpoint}/models`, { signal: AbortSignal.timeout(4000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
        const models = (body.data ?? []).map((entry) => entry?.id).filter((id): id is string => typeof id === "string");
        return { ok: true, models, endpoint, ms: Date.now() - started };
      } catch (error) {
        return { ok: false, models: [], endpoint, ms: Date.now() - started, error: String((error as Error)?.message ?? error) };
      }
    },
    providers_local_set: async (p) => {
      const endpoint = localEndpoint(text(p.baseUrl));
      const config: LocalModelConfig = {
        enabled: p.enabled === true,
        baseUrl: endpoint,
        model: typeof p.model === "string" ? p.model.trim() : "",
        contextWindow: asInt(p.contextWindow, DEFAULT_LOCAL_MODEL_CONFIG.contextWindow),
        maxTokens: asInt(p.maxTokens, DEFAULT_LOCAL_MODEL_CONFIG.maxTokens),
        setDefault: p.setDefault === true,
      };
      settings.config.write({ ...settings.config.read(), localModel: config });
      if (!config.enabled) {
        await engine.providers.deleteProvider(LOCAL_MODEL_PROVIDER_ID).catch(() => {});
        emit("agent://models-update", {});
        return localState();
      }
      if (!config.model) throw Error("invalid_payload: model");
      await engine.providers.saveProvider({
        id: LOCAL_MODEL_PROVIDER_ID,
        providerKind: "custom",
        label: "本地模型 (llama.cpp)",
        baseUrl: endpoint,
        apiBackend: "chat_completions",
        authScheme: "bearer",
        apiKey: "sk-local",
      });
      await engine.providers.saveModel({
        providerId: LOCAL_MODEL_PROVIDER_ID,
        modelId: config.model,
        name: config.model,
        reasoning: false,
        input: ["text"],
        contextWindow: config.contextWindow,
        maxTokens: config.maxTokens,
      });
      if (config.setDefault) {
        settings.config.write({
          ...settings.config.read(),
          defaults: {
            ...settings.config.read().defaults,
            defaultModel: modelKey(LOCAL_MODEL_PROVIDER_ID, config.model),
            defaultProviderId: LOCAL_MODEL_PROVIDER_ID,
          },
        });
      }
      emit("agent://models-update", {});
      return localState();
    },
    account_get_api_key: () =>
      settings.secrets.has("provider:grok") ? "••••" : null,
    account_set_api_key: async (p) => {
      if (p.key !== null && typeof p.key !== "string")
        throw Error("key必须为字符串或null");
      if (p.key !== "••••")
        settings.secrets.set("provider:grok", p.key as string | undefined);
      await engine.providers.sync();
    },
  };
  return { id: "providers", commands };
}
