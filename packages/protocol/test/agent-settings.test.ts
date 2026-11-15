// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateCommandPayload } from "../src/contract";

const key = "model:fixture/fixture-model";

describe("settings_agent_set payload (pii W0.4)", () => {
  it("accepts a partial patch of known fields", () => {
    for (const patch of [
      {},
      { autoCompaction: { enabled: false } },
      { autoCompaction: { reserveTokens: 8192, keepRecentTokens: 20000 } },
      { autoRetry: { enabled: true, maxRetries: 0 } },
      { steeringMode: "all", followUpMode: "one-at-a-time" },
      { cacheWarming: "off" },
      { favoriteModels: [key, "model:other/a%2Fb"] },
      { favoriteModels: [] },
      { builtins: { mode: false, "todo-list": true } },
    ])
      expect(() => validateCommandPayload("settings_agent_set", { patch })).not.toThrow();
  });

  it("rejects a missing patch, unknown fields, wrong types and out-of-range numbers", () => {
    for (const patch of [
      undefined,
      [],
      "x",
      { unknown: true },
      { autoCompaction: true },
      { autoCompaction: { enabled: "no" } },
      { autoCompaction: { threshold: 3 } },
      { autoCompaction: { reserveTokens: 10 } },
      { autoCompaction: { keepRecentTokens: 1.5 } },
      { autoRetry: { maxRetries: 11 } },
      { autoRetry: { maxRetries: -1 } },
      { steeringMode: "batch" },
      { followUpMode: 1 },
      { cacheWarming: "always" },
      { favoriteModels: "model:a/b" },
      { favoriteModels: ["fixture/fixture-model"] },
      { favoriteModels: [key, key] },
      { favoriteModels: Array.from({ length: 51 }, (_, i) => `model:p/m${i}`) },
      { builtins: [] },
      { builtins: { mode: "off" } },
      { builtins: { "Bad Id": true } },
    ])
      expect(() => validateCommandPayload("settings_agent_set", { patch }), JSON.stringify(patch)).toThrow("invalid_payload");
  });

  it("settings_agent_get takes no fields", () => {
    expect(() => validateCommandPayload("settings_agent_get", {})).not.toThrow();
    expect(() => validateCommandPayload("settings_agent_get", undefined)).not.toThrow();
  });
});

describe("agent_cycle_model payload (pii W1.6)", () => {
  it("needs a session id and an optional direction", () => {
    expect(() => validateCommandPayload("agent_cycle_model", { sessionId: "s1" })).not.toThrow();
    expect(() => validateCommandPayload("agent_cycle_model", { sessionId: "s1", direction: "backward" })).not.toThrow();
    expect(() => validateCommandPayload("agent_cycle_model", {})).toThrow("invalid_payload");
    expect(() => validateCommandPayload("agent_cycle_model", { sessionId: "s1", direction: "up" })).toThrow("invalid_payload");
    expect(() => validateCommandPayload("agent_cycle_model", { sessionId: "x".repeat(300) })).toThrow("invalid_payload");
  });
});
