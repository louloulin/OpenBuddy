// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettings } from "../../services/settings.js";
import { Providers } from "../../services/providers.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "openbuddy-models-"));
  roots.push(root);
  const settings = createSettings(root, {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString(),
  });
  const providers = new Providers(settings);
  await providers.initialize();
  return providers;
}
it("inherits known vision and context capabilities for built-in model ids under a custom provider id", async () => {
  const p = await setup();
  await p.saveProvider({
    id: "company-proxy",
    providerKind: "openai",
    baseUrl: "https://proxy.example/v1",
  });
  await p.saveModel({ providerId: "company-proxy", modelId: "gpt-4o" });
  expect(p.model("gpt-4o")).toMatchObject({
    provider: "company-proxy",
    input: ["text", "image"],
    contextWindow: 128000,
    maxTokens: 16384,
  });
  expect(p.list().models[0]).toMatchObject({
    input: ["text", "image"],
    pricingKnown: true,
    cost: { input: 2.5, output: 10 },
  });
});
it("preserves two providers with the same slash-containing model slug and rejects ambiguous legacy identities", async () => {
  const p = await setup();
  for (const id of ["first/provider", "second"])
    await p.saveProvider({
      id,
      providerKind: "custom",
      baseUrl: "http://127.0.0.1:1234/v1",
    });
  await p.saveModel({ providerId: "first/provider", modelId: "org/shared" });
  await p.saveModel({ providerId: "second", modelId: "org/shared" });
  expect(p.list().models).toHaveLength(2);
  expect(() => p.model("org/shared")).toThrow(/ambiguous/);
  expect(p.model("org/shared", "second")?.provider).toBe("second");
  const first = p.list().models.find((m) => m.providerId === "first/provider")!;
  expect(first.modelKey).toBe("model:first%2Fprovider/org%2Fshared");
  expect(p.model(first.modelKey)?.provider).toBe("first/provider");
  await expect(p.deleteModel("org/shared")).rejects.toThrow(/ambiguous/);
  await p.deleteModel("org/shared", "second");
  expect(p.list().models).toHaveLength(1);
  expect(p.model("org/shared")?.provider).toBe("first/provider");
});
it("preserves explicit custom capabilities and rejects invalid model fields without saving them", async () => {
  const p = await setup();
  await p.saveProvider({
    id: "custom",
    providerKind: "custom",
    baseUrl: "http://127.0.0.1:1234/v1",
  });
  await p.saveModel({
    providerId: "custom",
    modelId: "local-vision",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 65536,
    maxTokens: 4096,
    compat: { supportsUsageInStreaming: true },
  });
  expect(p.model("local-vision")).toMatchObject({
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 65536,
    maxTokens: 4096,
    compat: { supportsUsageInStreaming: true },
  });
  expect(p.list().models[0]).toMatchObject({ pricingKnown: false });
  expect(p.list().models[0].cost).toBeUndefined();
  for (const fields of [
    { input: ["video"] },
    { maxTokens: 0 },
    { reasoning: "yes" },
    { cost: { input: -1 } },
    { compat: { supportsUsageInStreaming: "false" } },
  ])
    await expect(
      p.saveModel({ providerId: "custom", modelId: "invalid", ...fields }),
    ).rejects.toThrow();
  expect(p.list().models).toHaveLength(1);
});

it("reads capabilities and thinking levels from a gateway's /models entry", async () => {
  const { describeFetchedModel } = await import("../../services/providers.js");
  const taotokenLike = {
    id: "deepseek-flash", display_name: "deepseek-flash", context_window: 1000000, max_output_tokens: 384000,
    supports_reasoning: true, input_modalities: ["text", "image"], type: "chat",
    control_parameters: { openai: { reasoning_effort: ["high", "max"], thinking: { type: ["enabled", "disabled"] } } },
    effort: { supported_levels: ["low", "high", "max"] },
  };
  const m = describeFetchedModel(taotokenLike, "chat_completions");
  expect(m).toMatchObject({ id: "deepseek-flash", contextWindow: 1000000, maxTokens: 384000, reasoning: true, input: ["text", "image"], thinkingLevels: ["off", "high", "max"] });
  expect(m.name).toBeUndefined(); // same as the id
  expect(m.suggested.thinkingLevelMap).toEqual({ minimal: null, low: null, medium: null, high: "high", max: "max" });
  expect(m.suggested.compat).toEqual({ supportsReasoningEffort: true, thinkingFormat: "deepseek" });
  // Thinking that cannot be switched off.
  const glm = describeFetchedModel({ id: "glm-5.3-flash", display_name: "GLM-5.3-Flash", supports_reasoning: true, control_parameters: { openai: { reasoning_effort: ["low", "high", "max"], thinking: { type: ["enabled"] } } } }, "chat_completions");
  expect(glm.name).toBe("GLM-5.3-Flash");
  expect(glm.thinkingLevels).toEqual(["low", "high", "max"]);
  // OpenRouter shape: per-token prices become per-million.
  const or = describeFetchedModel({ id: "x/y", context_length: 200000, architecture: { input_modalities: ["text"] }, top_provider: { max_completion_tokens: 8192 }, supported_parameters: ["reasoning"], pricing: { prompt: "0.000003", completion: "0.000015" } }, "chat_completions");
  expect(or).toMatchObject({ contextWindow: 200000, maxTokens: 8192, reasoning: true, input: ["text"], cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 } });
  expect(or.thinkingLevels).toBeUndefined();
});

it("saves thinking maps and compat, only offering the levels the model supports", async () => {
  const p = await setup();
  await p.saveProvider({ id: "taotoken", providerKind: "custom", label: "  淘 Token ", baseUrl: "https://gw.example/coding/v1", apiKey: "k" });
  await p.saveModel({ providerId: "taotoken", modelId: "deepseek-flash", reasoning: true, thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" }, compat: { thinkingFormat: "deepseek", supportsReasoningEffort: true } });
  const listed = p.list();
  expect(listed.providers[0]).toMatchObject({ id: "taotoken", label: "淘 Token", apiKey: "••••" });
  expect(listed.models[0].availableThinkingLevels).toEqual(["off", "high", "max"]);
  expect(p.model("deepseek-flash")).toMatchObject({ thinkingLevelMap: { high: "high", max: "max" }, compat: { thinkingFormat: "deepseek" } });
  await expect(p.saveModel({ providerId: "taotoken", modelId: "bad", thinkingLevelMap: { turbo: "x" } })).rejects.toThrow("思考档位");
  await expect(p.saveModel({ providerId: "taotoken", modelId: "bad", compat: { thinkingFormat: "nope" } })).rejects.toThrow("兼容");
  // Editing the connection keeps the name; a pasted /v1 is dropped for Anthropic-style APIs.
  await p.saveProvider({ id: "taotoken", providerKind: "custom", baseUrl: "https://gw.example/coding/v1" });
  expect(p.list().providers[0].label).toBe("淘 Token");
  await p.saveProvider({ id: "ant", providerKind: "custom_anthropic", baseUrl: "https://gw.example/coding/v1", apiKey: "k" });
  expect(p.list().providers.find((x) => x.id === "ant")?.baseUrl).toBe("https://gw.example/coding");
});

it("finds the /v1 base of an OpenAI-style gateway with the saved key and tests the connection", async () => {
  const { createServer } = await import("node:http");
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.url} ${req.headers.authorization}`);
    if (req.url === "/coding/v1/models" && req.headers.authorization === "Bearer saved-key") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "m1", context_window: 32000, type: "chat" }, { id: "img", type: "image" }] }));
      return;
    }
    res.writeHead(401); res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  try {
    const port = (server.address() as { port: number }).port;
    const p = await setup();
    await p.saveProvider({ id: "gw", providerKind: "custom", baseUrl: `http://127.0.0.1:${port}/coding`, apiKey: "saved-key" });
    const models = await p.fetchModels({ providerId: "gw" });
    expect(models.map((m) => m.id)).toEqual(["m1"]); // non-chat entries are skipped
    expect(seen).toEqual([`/coding/models Bearer saved-key`, `/coding/v1/models Bearer saved-key`]);
    expect(await p.test({ providerKind: "custom", baseUrl: `http://127.0.0.1:${port}/coding`, apiKey: "saved-key" })).toMatchObject({ ok: true, modelCount: 1, baseUrl: `http://127.0.0.1:${port}/coding/v1` });
    await expect(p.fetchModels({ providerKind: "custom", baseUrl: `http://127.0.0.1:${port}/coding`, apiKey: "wrong" })).rejects.toThrow("401");
  } finally {
    server.close();
  }
});
