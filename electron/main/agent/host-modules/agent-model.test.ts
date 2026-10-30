import { describe, expect, it } from "vitest";

import { installAgentModel, providerCatalog, resolveModelReference } from "./agent-model";
import { createDefaultAgentHostState } from "./_default-state";

interface FakeModel {
  provider: string;
  id: string;
  auth?: boolean;
}

/**
 * Minimal structural stand-in for ModelRegistry. `resolveModelReference`
 * only uses find/getAll/hasConfiguredAuth, so a real ModelRuntime (and its
 * network/catalog bootstrap) would add nothing to these cases.
 */
function registry(models: FakeModel[]) {
  return {
    find: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id),
    getAll: () => models,
    hasConfiguredAuth: (model: FakeModel) => models.some((candidate) => candidate.provider === model.provider && candidate.auth),
  } as unknown as Parameters<typeof resolveModelReference>[0];
}

describe("resolveModelReference", () => {
  it("resolves the canonical provider/modelId form", () => {
    const model = { provider: "minimax", id: "MiniMax-M3" };
    expect(resolveModelReference(registry([model]), "minimax/MiniMax-M3")).toBe(model);
  });

  it("keeps slashes inside the model id", () => {
    const model = { provider: "custom_anthropic", id: "vendor/MiniMax-M3" };
    expect(resolveModelReference(registry([model]), "custom_anthropic/vendor/MiniMax-M3")).toBe(model);
  });

  it("resolves a bare model id when it is unique", () => {
    const model = { provider: "minimax", id: "MiniMax-M3" };
    expect(resolveModelReference(registry([model]), "MiniMax-M3")).toBe(model);
  });

  it("prefers a provider with configured auth when the bare id is ambiguous", () => {
    const withoutAuth = { provider: "proxy-a", id: "shared-model" };
    const withAuth = { provider: "proxy-b", id: "shared-model", auth: true };
    expect(resolveModelReference(registry([withoutAuth, withAuth]), "shared-model")).toBe(withAuth);
  });

  it("returns undefined for an unknown reference", () => {
    expect(resolveModelReference(registry([{ provider: "minimax", id: "MiniMax-M3" }]), "minimax/missing")).toBeUndefined();
    expect(resolveModelReference(registry([{ provider: "minimax", id: "MiniMax-M3" }]), "missing")).toBeUndefined();
  });
});

describe("providerCatalog 环境变量凭据过滤", () => {
  /**
   * 复现 2026-10-30 真机缺陷:开发 shell 继承的 ANTHROPIC_AUTH_TOKEN 让
   * hasConfiguredAuth("anthropic") 为 true,选择器于是列出 14 个用户从未
   * 配置的 Claude 模型。目录必须只认真正落盘的凭据(listCredentials)。
   */
  it("只列出有落盘凭据或 models.json 配置的 provider,忽略纯环境变量凭据", async () => {
    const runtime = {
      // hasConfiguredAuth 对两个 provider 都返回 true —— 模拟 anthropic
      // 只有环境变量凭据、minimax 只有环境变量凭据(都"已配置")。
      hasConfiguredAuth: () => true,
      listCredentials: async () => [{ providerId: "minimax", type: "api_key" as const }],
      getModels: () => [
        { provider: "anthropic", id: "claude-opus-4-8", name: "Claude Opus 4.8" },
        { provider: "minimax", id: "MiniMax-M2.7", name: "MiniMax-M2.7" },
      ],
      getRegisteredProviderIds: () => [],
      getRegisteredProviderConfig: () => undefined,
    };
    const state = { ...createDefaultAgentHostState(), modelRuntime: runtime } as unknown as Parameters<typeof installAgentModel>[0]["state"];
    installAgentModel({
      state,
      emitRendererEvent: () => undefined,
      piHome: () => "/tmp/openbuddy-test-agent",
      readModelsConfig: async () => ({ providers: { minimax: { api: "anthropic-messages" } } }),
    });

    const catalog = await providerCatalog();
    const providerIds = catalog.providers.map((p) => p.id);
    const modelIds = catalog.models.map((m) => `${m.providerId}/${m.modelId}`);
    expect(providerIds).toEqual(["minimax"]);
    expect(modelIds).toEqual(["minimax/MiniMax-M2.7"]);
    expect(catalog.providers[0]?.apiKey).toBe("••••••••");
  });

  it("listCredentials 失败时目录退化为仅 models.json 配置的 provider", async () => {
    const runtime = {
      hasConfiguredAuth: () => true,
      listCredentials: async () => { throw new Error("cred helper unavailable"); },
      getModels: () => [{ provider: "anthropic", id: "claude-opus-4-8", name: "Claude Opus 4.8" }],
      getRegisteredProviderIds: () => [],
      getRegisteredProviderConfig: () => undefined,
    };
    const state = { ...createDefaultAgentHostState(), modelRuntime: runtime } as unknown as Parameters<typeof installAgentModel>[0]["state"];
    installAgentModel({
      state,
      emitRendererEvent: () => undefined,
      piHome: () => "/tmp/openbuddy-test-agent",
      readModelsConfig: async () => ({ providers: {} }),
    });

    const catalog = await providerCatalog();
    expect(catalog.providers).toEqual([]);
    expect(catalog.models).toEqual([]);
  });
});
