// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { providersModule } from "./providers";
import type { HostContext } from "../module";

function setup() {
  const provider = { value: null as unknown };
  const models: unknown[] = [];
  const config = { defaults: { defaultModel: "", defaultPermission: "ask" }, sessions: {} } as Record<string, unknown>;
  const ctx = {
    settings: { config: { read: () => config, write: (next: Record<string, unknown>) => Object.assign(config, next) }, secrets: { has: () => false } },
    emit: vi.fn(),
    engine: {
      providers: {
        authStatus: () => ({ ready: true }),
        list: () => ({ providers: provider.value ? [provider.value] : [], models }),
        saveProvider: async (value: unknown) => { provider.value = value; },
        saveModel: async (value: unknown) => { models.push(value); },
        deleteProvider: async () => { provider.value = null; },
        fetchModels: vi.fn(),
        test: vi.fn(),
      },
      reload: vi.fn(),
    },
  } as unknown as HostContext;
  return { commands: providersModule(ctx).commands, provider, models, config };
}

afterEach(() => vi.unstubAllGlobals());

describe("本地模型 (pii W8)", () => {
  it("probes an OpenAI-compatible /v1/models endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ id: "qwen2.5-7b" }, { id: "llama-3-8b" }] }) })));
    const { commands } = setup();
    const result = (await commands.providers_local_probe({ baseUrl: "http://127.0.0.1:8080" })) as { ok: boolean; models: string[]; endpoint: string };
    expect(result.ok).toBe(true);
    expect(result.endpoint).toBe("http://127.0.0.1:8080/v1");
    expect(result.models).toEqual(["qwen2.5-7b", "llama-3-8b"]);
  });

  it("returns ok:false (not a rejection) when the server is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const { commands } = setup();
    const result = (await commands.providers_local_probe({ baseUrl: "http://127.0.0.1:9" })) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("registers the local model as a provider and can make it the default", async () => {
    const { commands, provider, models, config } = setup();
    await commands.providers_local_set({ enabled: true, baseUrl: "http://localhost:8080/v1", model: "qwen2.5-7b", contextWindow: 16384, maxTokens: 2048, setDefault: true });
    expect(provider.value).toMatchObject({ id: "llama.cpp", baseUrl: "http://localhost:8080/v1", apiBackend: "chat_completions", authScheme: "bearer" });
    expect(models[0]).toMatchObject({ providerId: "llama.cpp", modelId: "qwen2.5-7b", contextWindow: 16384, maxTokens: 2048 });
    expect(config.defaults).toMatchObject({ defaultProviderId: "llama.cpp", defaultModel: "model:llama.cpp/qwen2.5-7b" });
    const state = (await commands.providers_local_get({})) as { config: { enabled: boolean }; models: Array<{ modelId: string }> };
    expect(state.config.enabled).toBe(true);
    expect(state.models.map((model) => model.modelId)).toEqual(["qwen2.5-7b"]);
  });

  it("deleting the provider when disabled", async () => {
    const { commands, provider } = setup();
    await commands.providers_local_set({ enabled: true, baseUrl: "http://localhost:8080", model: "m", setDefault: false });
    expect(provider.value).not.toBeNull();
    await commands.providers_local_set({ enabled: false, baseUrl: "http://localhost:8080", model: "", setDefault: false });
    expect(provider.value).toBeNull();
  });
});
