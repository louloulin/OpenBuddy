/**
 * cordis-bridge.test.ts — relocated tests for the Pi bridge surface.
 *
 * Phase L.1 of docs/OPENBUDDY_PI_NATIVE_PLAN.md §26. The bridge
 * implementation moved from `electron/main/deepseek/deepseek-pi-bridge.ts`
 * and `electron/main/deepseek/deepseek-pi-capabilities.ts` (both deleted)
 * into `cordis-runtime.ts` here. The test coverage moved with it so the
 * previous `deepseek-pi-bridge.test.ts` and
 * `deepseek-pi-capabilities.test.ts` files (also deleted) are not lost.
 */

import { describe, expect, it, vi } from "vitest";

import {
	createDeepSeekPiBridge,
	createDeepSeekPiCapabilityRuntime,
	createDeepSeekPiLlmInterceptor,
	createDeepSeekPiToolInterceptor,
} from "./cordis-runtime";

function model() {
	return {
		id: "model-a",
		name: "Model A",
		provider: "pi-provider",
		api: "openai-completions",
		input: ["text"],
		reasoning: false,
		contextWindow: 8192,
		maxTokens: 1024,
	} as any;
}

async function collect(source: AsyncIterable<unknown>): Promise<unknown[]> {
	const values: unknown[] = [];
	for await (const value of source) values.push(value);
	return values;
}

describe("Phase L.1 relocated Pi bridge", () => {
	it("projects Pi runtime state without exposing runtime objects", async () => {
		const current = model();
		const bridge = createDeepSeekPiBridge({
			getSession: () => ({ sessionId: "session-a", cwd: "/workspace", modelId: current.id }),
			listPersistedSessions: async () => [{ sessionId: "session-a" }],
			getProviders: () => [{ id: current.provider, name: "Pi Provider" }],
			getModels: () => [current],
			getModel: () => current,
			getCurrentModel: () => current,
			listTools: () => [{ name: "read", label: "Read", description: "Read a file" }],
			executeTool: vi.fn(async () => ({ ok: true })),
			prompt: vi.fn(async () => undefined),
			abort: vi.fn(async () => undefined),
		});

		expect(bridge.runtime).toBe("pi");
		expect(bridge.get()).toEqual({ sessionId: "session-a", cwd: "/workspace", modelId: "model-a" });
		expect(bridge.listModels()).toEqual([expect.objectContaining({ id: "model-a", provider: "pi-provider" })]);
		expect(bridge.listTools()).toEqual([{ name: "read", label: "Read", description: "Read a file" }]);
		await expect(bridge.prompt("hello")).resolves.toEqual({ sessionId: "session-a" });
	});

	it("exposes versioned JSON-safe capability facades with fail-closed dispatch", async () => {
		const invoke = vi.fn(async (capability: string, method: string, args?: unknown) => ({ capability, method, args }));
		const bridge = createDeepSeekPiBridge({
			getSession: () => ({ sessionId: "session-a" }),
			listPersistedSessions: async () => [],
			getProviders: () => [],
			getModels: () => [],
			getModel: () => undefined,
			getCurrentModel: () => undefined,
			listTools: () => [],
			executeTool: async () => undefined,
			prompt: async () => undefined,
			abort: async () => undefined,
			capability: {
				capabilities: {
					session: ["get", "list", "listWorkspaces"],
					web: ["status", "search", "fetch"],
					subagent: ["list", "getConfig", "setConfig", "prompt", "interrupt"],
				},
				invoke,
			},
		});

		expect(bridge.capabilities.web).toContain("search");
		await expect(bridge.invokeCapability("web", "search", { query: "pi" })).resolves.toEqual({ capability: "web", method: "search", args: { query: "pi" } });
		expect(invoke).toHaveBeenCalledWith("web", "search", { query: "pi" });
		await expect(bridge.invokeCapability("web", "shell", {})).rejects.toThrow("capability method is unavailable");
	});

	it("maps Pi assistant events to DeepSeek stream chunks and falls back for unknown models", async () => {
		const current = model();
		const piEvents = [
			{ type: "text_start", contentIndex: 0 },
			{ type: "text_delta", contentIndex: 0, delta: "hello" },
			{ type: "text_end", contentIndex: 0, content: "hello" },
			{ type: "done", reason: "stop", message: { usage: { input: 2, output: 3, totalTokens: 5 } } },
		];
		const stream = vi.fn(() => (async function* () { yield* piEvents; })());
		const interceptor = createDeepSeekPiLlmInterceptor({ getModel: (provider, id) => provider === current.provider && id === current.id ? current : undefined }, stream);
		const next = vi.fn(() => (async function* () { yield { type: "fallback" }; })());
		const chunks = await collect(interceptor({
			provider: current.provider,
			model: current.id,
			messages: [{ role: "user", content: "hello" }],
		}, next));

		expect(stream).toHaveBeenCalledWith(current, expect.objectContaining({
			messages: [expect.objectContaining({ role: "user", content: "hello" })],
		}), expect.any(Object));
		expect(chunks).toEqual([
			{ type: "block-start", index: 0, blockType: "text" },
			{ type: "text-delta", index: 0, text: "hello" },
			{ type: "block-end", index: 0, block: { type: "text", text: "hello" } },
			{ type: "usage", usage: { inputTokens: 2, outputTokens: 3 } },
			{ type: "finish", reason: { kind: "stop" } },
		]);

		await expect(collect(interceptor({ provider: "unknown", model: "missing" }, next))).resolves.toEqual([{ type: "fallback" }]);
		expect(next).toHaveBeenCalledTimes(1);
	});

	it("preserves tool calls and provider failures", async () => {
		const current = model();
		const stream = (_model: unknown, _context: unknown, _options: unknown) => (async function* () {
			yield { type: "toolcall_start", contentIndex: 1, partial: { content: [{}, { type: "toolCall", id: "call-1", name: "read", arguments: {} }] } };
			yield { type: "toolcall_delta", contentIndex: 1, delta: '{"path":"a"}', partial: { content: [{}, { type: "toolCall", id: "call-1", name: "read", arguments: {} }] } };
			yield { type: "toolcall_end", contentIndex: 1, toolCall: { id: "call-1", name: "read", arguments: { path: "a" } } };
			yield { type: "error", reason: "error", errorMessage: "provider down" };
		})();
		const interceptor = createDeepSeekPiLlmInterceptor({ getModel: () => current }, stream);
		await expect(collect(interceptor({ provider: current.provider, model: current.id }, () => (async function* () {})()))).resolves.toEqual([
			{ type: "block-start", index: 1, blockType: "tool-call" },
			{ type: "tool-call-delta", index: 1, id: "call-1", name: "read", argumentsDelta: "" },
			{ type: "tool-call-delta", index: 1, id: "call-1", name: "read", argumentsDelta: '{"path":"a"}' },
			{ type: "block-end", index: 1, block: { type: "tool-call", id: "call-1", name: "read", arguments: '{"path":"a"}' } },
			{ type: "finish", reason: { kind: "error", failure: { code: "PI_PROVIDER_ERROR", message: "provider down" } } },
		]);
	});

	it("routes official tool execution through Pi and preserves fallback behavior", async () => {
		const executeTool = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }], details: { path: "a" } }));
		const interceptor = createDeepSeekPiToolInterceptor({
			listTools: () => [{ name: "read" }],
			executeTool,
		});
		const next = vi.fn(async () => ({ isError: false, value: "official" }));
		await expect(interceptor({ name: "read", arguments: { path: "a" } }, next)).resolves.toEqual({
			isError: false,
			value: { path: "a" },
			content: [{ type: "text", text: "ok" }],
		});
		expect(executeTool).toHaveBeenCalledWith("read", { path: "a" }, undefined);
		await expect(interceptor({ name: "other", arguments: {} }, next)).resolves.toEqual({ isError: false, value: "official" });
		expect(next).toHaveBeenCalledTimes(1);
	});
});

describe("Phase L.1 relocated Pi capability facade", () => {
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
