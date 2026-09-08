/**
 * host-modules/models-config/index.test.ts — provider/model persistence unit tests.
 *
 * Batch A extraction — verifies the moved domain survives in isolation using the
 * same stub state factory (`createDefaultAgentHostState`) the harness/realserver
 * tests rely on, so real `state` wiring in agent-host stays untouched.
 */
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAgentHostState } from "../_default-state";
import type { AgentHostState } from "../_state-shape";
import {
  deleteModel,
  deleteProvider,
  installModelConfig,
  readModelsConfig,
  saveModel,
  saveProvider,
} from "./index";

describe("models-config", () => {
  let home: string;
  let state: AgentHostState;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "openbuddy-models-config-"));
    state = createDefaultAgentHostState();
    installModelConfig({
      state,
      piHome: () => home,
    });
  });

  it("readModelsConfig returns empty providers for a fresh dir", async () => {
    await expect(readModelsConfig()).resolves.toEqual({ providers: {} });
  });

  it("saveProvider persists provider + api key auth", async () => {
    await saveProvider({
      id: "minimax",
      providerKind: "minimax",
      label: "MiniMax",
      apiKey: "sk-test",
      apiBackend: "messages",
      authScheme: "bearer",
    });
    const config = await readModelsConfig();
    expect(config.providers.minimax).toMatchObject({
      name: "MiniMax",
      api: "anthropic-messages",
      authHeader: true,
      models: [],
    });
    // api key written to auth.json, not models.json
    const auth = JSON.parse(await readFile(join(home, "auth.json"), "utf8"));
    expect(auth.minimax).toEqual({ type: "api_key", key: "sk-test" });
    expect(config.providers.minimax.apiKey).toBeUndefined();
  });

  it("saveModel throws for an unknown provider and adds a model otherwise", async () => {
    await expect(saveModel({ modelId: "m", providerId: "missing" })).rejects.toThrow(
      /Pi provider not found/,
    );
    await saveProvider({ id: "openai", providerKind: "openai" });
    await saveModel({ modelId: "gpt-x", providerId: "openai", name: "GPT X" });
    const config = await readModelsConfig();
    expect(config.providers.openai.models).toHaveLength(1);
    expect(config.providers.openai.models[0]).toMatchObject({
      id: "gpt-x",
      name: "GPT X",
      reasoning: false,
    });
  });

  it("saveModel preserves a previously stored reasoning flag", async () => {
    await saveProvider({ id: "openai", providerKind: "openai" });
    await saveModel({ modelId: "r1", providerId: "openai", reasoning: true });
    await saveModel({ modelId: "r1", providerId: "openai", name: "R1 renamed" });
    const config = await readModelsConfig();
    expect(config.providers.openai.models[0].reasoning).toBe(true);
  });

  it("deleteModel removes a model for the provider", async () => {
    await saveProvider({ id: "openai", providerKind: "openai" });
    await saveModel({ modelId: "a", providerId: "openai" });
    await saveModel({ modelId: "b", providerId: "openai" });
    await deleteModel("openai", "a");
    const config = await readModelsConfig();
    expect(config.providers.openai.models.map((m: any) => m.id)).toEqual(["b"]);
  });

  it("deleteProvider removes provider + clears stored api key", async () => {
    await saveProvider({ id: "deepseek", providerKind: "deepseek", apiKey: "sk-ds" });
    await deleteProvider("deepseek");
    const config = await readModelsConfig();
    expect(config.providers.deepseek).toBeUndefined();
    const auth = JSON.parse(await readFile(join(home, "auth.json"), "utf8"));
    expect(auth.deepseek).toBeUndefined();
  });

  it("does not write apiKey that is already masked with bullet dots", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    state.modelRuntime = { refresh } as unknown as typeof state['modelRuntime'];
    await saveProvider({ id: "openai", providerKind: "openai", apiKey: "••••1234" });
    // masked apiKey must NOT create/populate auth.json
    await expect(access(join(home, "auth.json"))).rejects.toThrow();
  });
});
