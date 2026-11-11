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
