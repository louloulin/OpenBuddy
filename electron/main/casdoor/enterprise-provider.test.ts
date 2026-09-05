import { describe, expect, it } from "vitest";
import { buildEnterpriseProviderConfig } from "./enterprise-provider";

describe("buildEnterpriseProviderConfig", () => {
  it("creates a Gateway-backed provider from the current catalog", () => {
    expect(buildEnterpriseProviderConfig(undefined, "https://gateway.test/v1/tenants/tenant-a/ai", [
      { id: "MiniMax-M3", ownedBy: "minimax" },
      { id: "MiniMax-M3", ownedBy: "duplicate" },
      { id: "deepseek-v4-flash" },
    ])).toEqual({
      name: "OpenBuddy Enterprise",
      baseUrl: "https://gateway.test/v1/tenants/tenant-a/ai",
      api: "openai-completions",
      authHeader: false,
      models: [
        { id: "MiniMax-M3", name: "MiniMax-M3", contextWindow: 128000, maxTokens: 16384, ownedBy: "minimax" },
        { id: "deepseek-v4-flash", name: "deepseek-v4-flash", contextWindow: 128000, maxTokens: 16384 },
      ],
    });
  });

  it("replaces stale models without retaining credentials", () => {
    const config = buildEnterpriseProviderConfig({ apiKey: "must-not-persist", models: [{ id: "stale" }] }, "http://gateway.test/ai", [{ id: "current" }]);
    expect(config.models.map((model) => model.id)).toEqual(["current"]);
    expect(config).not.toHaveProperty("apiKey");
  });
});
