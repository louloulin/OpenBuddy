import { describe, expect, it, vi } from "vitest";
import { createDeepSeekPiCapabilityRuntime } from "./deepseek-pi-capabilities";

function runtime() {
  return createDeepSeekPiCapabilityRuntime({
    session: {
      get: () => ({ sessionId: "session-a" }),
      list: async (cwd) => [{ cwd }],
      listWorkspaces: async () => [{ cwd: "/workspace" }],
    },
    web: {
      status: async () => ({ enabled: true }),
      search: async (query, maxResults) => ({ query, ...(maxResults === undefined ? {} : { maxResults }) }),
      fetch: async (url) => ({ url }),
    },
    subagent: {
      list: async (parentSessionId) => [{ parentSessionId }],
      prompt: async (parentSessionId, childSessionId, text) => ({ parentSessionId, childSessionId, text }),
      interrupt: async (parentSessionId, childSessionId) => ({ parentSessionId, childSessionId, accepted: true }),
    },
  });
}

describe("DeepSeek Pi capability facade", () => {
  it("dispatches session, web, and subagent methods through typed arguments", async () => {
    const facade = runtime();
    await expect(facade.invoke("session", "get", {})).resolves.toEqual({ sessionId: "session-a" });
    await expect(facade.invoke("session", "list", { cwd: "/workspace" })).resolves.toEqual([{ cwd: "/workspace" }]);
    await expect(facade.invoke("web", "search", { query: "pi", maxResults: 3 })).resolves.toEqual({ query: "pi", maxResults: 3 });
    await expect(facade.invoke("subagent", "prompt", { parentSessionId: "parent", childSessionId: "child", text: "hello" })).resolves.toEqual({ parentSessionId: "parent", childSessionId: "child", text: "hello" });
  });

  it("rejects unknown methods, fields, and non-JSON arguments before handlers run", async () => {
    const handler = vi.fn(async () => undefined);
    const facade = createDeepSeekPiCapabilityRuntime({
      ...runtimeHandlers(),
      web: { status: handler, search: handler, fetch: handler },
    });
    await expect(facade.invoke("web", "shell", {})).rejects.toThrow("method is unavailable");
    await expect(facade.invoke("web", "search", { query: "pi", extra: true })).rejects.toThrow("does not accept extra");
    await expect(facade.invoke("web", "search", { query: new Date() })).rejects.toThrow("JSON-safe object");
    expect(handler).not.toHaveBeenCalled();
  });

  it("audits malformed and unknown capability calls without invoking a handler", async () => {
    const audit: Array<{ capability: string; method: string; outcome: string }> = [];
    const facade = createDeepSeekPiCapabilityRuntime(runtimeHandlers(), { onAudit: (entry) => audit.push(entry) });
    await expect(facade.invoke("web", "search", new Date())).rejects.toThrow("JSON-safe object");
    await expect((facade.invoke as (capability: string, method: string, args?: unknown) => Promise<unknown>)("unknown", "search", {})).rejects.toThrow("capability is unavailable");
    expect(audit).toEqual([
      { capability: "web", method: "search", outcome: "failure", durationMs: expect.any(Number) },
      { capability: "unknown", method: "search", outcome: "failure", durationMs: expect.any(Number) },
    ]);
  });

  it("emits redacted audit entries without argument contents", async () => {
    const audit: Array<{ capability: string; method: string; outcome: string }> = [];
    const facade = createDeepSeekPiCapabilityRuntime({
      ...runtimeHandlers(),
      web: { status: async () => ({ enabled: true }), search: async (query, maxResults) => ({ query, ...(maxResults === undefined ? {} : { maxResults }) }), fetch: async (url) => ({ url }) },
    }, { onAudit: (entry) => audit.push(entry) });
    await facade.invoke("web", "search", { query: "secret query", maxResults: 2 });
    await expect(facade.invoke("web", "search", { query: 42 })).rejects.toThrow();
    expect(audit).toEqual([
      { capability: "web", method: "search", outcome: "success", durationMs: expect.any(Number) },
      { capability: "web", method: "search", outcome: "failure", durationMs: expect.any(Number) },
    ]);
    expect(JSON.stringify(audit)).not.toContain("secret query");
  });

  it("rejects non-JSON-safe service results at the plugin boundary", async () => {
    const facade = createDeepSeekPiCapabilityRuntime({
      ...runtimeHandlers(),
      web: { status: async () => ({ status: "ok" }), search: async () => ({}), fetch: async () => ({}) },
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const unsafe = createDeepSeekPiCapabilityRuntime({
      ...runtimeHandlers(),
      web: { status: async () => circular, search: async () => undefined, fetch: async () => undefined },
    });
    await expect(facade.invoke("web", "status", {})).resolves.toEqual({ status: "ok" });
    await expect(unsafe.invoke("web", "status", {})).rejects.toThrow("non-JSON-safe");
  });

  it("propagates cancellation and applies a bounded timeout", async () => {
    let observedSignal: AbortSignal | undefined;
    const facade = createDeepSeekPiCapabilityRuntime({
      ...runtimeHandlers(),
      web: {
        status: async (context) => {
          observedSignal = context.signal;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { enabled: true };
        },
        search: async () => ({}),
        fetch: async () => ({}),
      },
    }, { timeoutMs: 5 });
    await expect(facade.invoke("web", "status", {})).rejects.toThrow(/timed out|cancelled/);
    expect(observedSignal?.aborted).toBe(true);

    const controller = new AbortController();
    controller.abort();
    await expect(facade.invoke("web", "status", {}, { signal: controller.signal, requestId: "cancel-1", caller: "test" })).rejects.toThrow("cancelled");
  });
});

function runtimeHandlers() {
  return {
    session: { get: () => undefined, list: async () => [], listWorkspaces: async () => [] },
    web: { status: async () => undefined, search: async () => undefined, fetch: async () => undefined },
    subagent: {
      list: async () => [],
      prompt: async () => undefined,
      interrupt: async () => undefined,
    },
  };
}
