import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * model-bridge.test.ts
 *
 * Phase B.1 round 2 — verify the 6th builtin ExtensionFactory wires
 * up model_select / set_model / before_provider_request handlers and
 * does not crash on missing api surface.
 */

import {
  createModelBridgeExtension,
  modelBridgeFactory,
} from "./model-bridge";

type Handler = (payload: unknown) => unknown | Promise<unknown>;

function makeFakePi() {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    api: {
      on(event: string, handler: Handler) {
        handlers.set(event, handler);
      },
    } as const,
  };
}

describe("model-bridge", () => {
  afterEach(() => {
    delete process.env["OPENBUDDY_BRIDGE_DEBUG"];
  });

  it("is a callable factory (B.1 round 2 sanity)", () => {
    expect(typeof modelBridgeFactory).toBe("function");
    expect(typeof createModelBridgeExtension()).toBe("function");
  });

  it("registers handlers for model_select / set_model / before_provider_request", () => {
    const fake = makeFakePi();
    modelBridgeFactory(fake.api as never);

    expect(fake.handlers.has("model_select")).toBe(true);
    expect(fake.handlers.has("set_model")).toBe(true);
    expect(fake.handlers.has("before_provider_request")).toBe(true);
  });

  it("model_select forwards arbitrary payload (no-op today)", () => {
    const fake = makeFakePi();
    modelBridgeFactory(fake.api as never);
    const handler = fake.handlers.get("model_select");
    expect(handler).toBeDefined();
    expect(handler?.({ modelId: "claude-opus-4", provider: "anthropic" })).toBeUndefined();
  });

  it("set_model forwards arbitrary payload (no-op today)", () => {
    const fake = makeFakePi();
    modelBridgeFactory(fake.api as never);
    const handler = fake.handlers.get("set_model");
    expect(handler).toBeDefined();
    expect(handler?.({ modelId: "gpt-5", sessionId: "abc" })).toBeUndefined();
  });

  it("before_provider_request forwards arbitrary payload (no-op today)", () => {
    const fake = makeFakePi();
    modelBridgeFactory(fake.api as never);
    const handler = fake.handlers.get("before_provider_request");
    expect(handler).toBeDefined();
    expect(handler?.({ url: "https://api.openai.com/v1/chat/completions", method: "POST" })).toBeUndefined();
  });

  it("does not crash when given an api object without `on`", () => {
    expect(() => modelBridgeFactory({} as never)).not.toThrow();
  });

  it("OPENBUDDY_BRIDGE_DEBUG=1 enables console logging (smoke test)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      process.env["OPENBUDDY_BRIDGE_DEBUG"] = "1";
      const fake = makeFakePi();
      modelBridgeFactory(fake.api as never);
      const handler = fake.handlers.get("model_select");
      handler?.({ modelId: "x" });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});