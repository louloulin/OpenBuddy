import { text } from "@openbuddy/services/settings/settings";
import type { Handler, HostContext, HostModule } from "../module.js";
/** §5.3 `providers` module. Provider and model catalog, auth status, legacy account key. */
export function providersModule(ctx: HostContext): HostModule {
  const { settings, emit, engine } = ctx;
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
