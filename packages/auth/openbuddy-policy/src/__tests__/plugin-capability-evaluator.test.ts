/**
 * plugin-capability-evaluator.test.ts — PluginCapabilityEvaluator 单元测试
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { PluginCapabilityEvaluator } from "../evaluators/plugin-capability-evaluator";

beforeEach(() => vi.restoreAllMocks());

describe("PluginCapabilityEvaluator — matches()", () => {
  it("matches when context.plugin is present", () => {
    const e = new PluginCapabilityEvaluator({ isPluginAllowed: () => true });
    expect(e.matches({ subject: "u", action: "execute", resource: "r", context: { plugin: "my-plugin" } })).toBe(true);
  });

  it("does not match when context.plugin is missing or empty", () => {
    const e = new PluginCapabilityEvaluator({ isPluginAllowed: () => true });
    expect(e.matches({ subject: "u", action: "x", resource: "y" })).toBe(false);
    expect(e.matches({ subject: "u", action: "x", resource: "y", context: {} })).toBe(false);
    expect(e.matches({ subject: "u", action: "x", resource: "y", context: { plugin: "" } })).toBe(false);
  });
});

describe("PluginCapabilityEvaluator — evaluate()", () => {
  it("returns PLUGIN_CAPABILITY_ALLOWED when isPluginAllowed returns true", async () => {
    const e = new PluginCapabilityEvaluator({ isPluginAllowed: () => true });

    const result = await e.evaluate({
      subject: "u", action: "execute", resource: "tool",
      context: { plugin: "my-plugin" },
    });

    expect(result).toMatchObject({
      allowed: true,
      code: "PLUGIN_CAPABILITY_ALLOWED",
      source: "plugin_capability",
      matchedRule: "my-plugin:execute",
    });
  });

  it("returns PLUGIN_CAPABILITY_DENIED when isPluginAllowed returns false", async () => {
    const e = new PluginCapabilityEvaluator({ isPluginAllowed: () => false });

    const result = await e.evaluate({
      subject: "u", action: "execute", resource: "tool",
      context: { plugin: "blocked-plugin" },
    });

    expect(result).toMatchObject({
      allowed: false,
      code: "PLUGIN_CAPABILITY_DENIED",
      source: "plugin_capability",
      matchedRule: "blocked-plugin:execute",
    });
  });

  it("passes both plugin and action to isPluginAllowed", async () => {
    const isPluginAllowed = vi.fn().mockReturnValue(true);
    const e = new PluginCapabilityEvaluator({ isPluginAllowed });

    await e.evaluate({
      subject: "u", action: "register", resource: "r",
      context: { plugin: "alpha-plugin" },
    });

    expect(isPluginAllowed).toHaveBeenCalledWith("alpha-plugin", "register");
  });

  it("supports async isPluginAllowed", async () => {
    const e = new PluginCapabilityEvaluator({
      isPluginAllowed: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return false;
      },
    });

    const result = await e.evaluate({
      subject: "u", action: "execute", resource: "r",
      context: { plugin: "async-plugin" },
    });

    expect(result?.code).toBe("PLUGIN_CAPABILITY_DENIED");
  });

  it("properties: name='plugin_capability', priority=20", () => {
    const e = new PluginCapabilityEvaluator({ isPluginAllowed: () => true });
    expect(e.name).toBe("plugin_capability");
    expect(e.priority).toBe(20);
  });
});
