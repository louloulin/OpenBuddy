import { describe, expect, it } from "vitest";
import { RemoteDispatcher } from "./remote-dispatch";

function contextOf(service: unknown) {
	return { get: (name: string) => name === "demo" ? service : undefined };
}

describe("RemoteDispatcher", () => {
	it("requires registration and dispatches only registered service methods", async () => {
		const service = { ping: (value: string) => ({ value }), secret: () => "nope" };
		const context = contextOf(service);
		const dispatcher = new RemoteDispatcher();
		await expect(dispatcher.invoke({ package: "fixture", namespace: "demo", method: "ping", args: ["before"] }, context)).rejects.toThrow("not registered");
		dispatcher.register({ package: "fixture", descriptors: [{ namespace: "demo", method: "ping" }] }, context);
		await expect(dispatcher.invoke({ package: "fixture", namespace: "demo", method: "ping", args: ["after"] }, context)).resolves.toEqual({ value: "after" });
		await expect(dispatcher.invoke({ package: "fixture", namespace: "demo", method: "secret" }, context)).rejects.toThrow("not registered");
	});

	it("rejects duplicate endpoints and prototype lifecycle methods", () => {
		const context = contextOf({ ping: () => undefined });
		const dispatcher = new RemoteDispatcher();
		expect(() => dispatcher.register({ package: "one", descriptors: [{ namespace: "demo", method: "ping" }] }, context)).not.toThrow();
		expect(() => dispatcher.register({ package: "two", descriptors: [{ namespace: "demo", method: "ping" }] }, context)).toThrow("already registered");
		expect(() => dispatcher.register({ package: "bad", descriptors: [{ namespace: "demo", method: "constructor" }] }, context)).toThrow("method is invalid");
	});

	it("idempotently replaces a same-package registration when the endpoint set changes", async () => {
		const service = { ping: () => "first", pong: () => "second" };
		const context = contextOf(service);
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "fixture", descriptors: [{ namespace: "demo", method: "ping" }] }, context);
		// Re-registering the same package with an extra endpoint must NOT throw:
		// renderer reloads and capability additions can ship a larger shape and
		// must succeed without forcing the user to restart Electron.
		expect(() => dispatcher.register({ package: "fixture", descriptors: [{ namespace: "demo", method: "ping" }, { namespace: "demo", method: "pong" }] }, context)).not.toThrow();
		await expect(dispatcher.invoke({ package: "fixture", namespace: "demo", method: "ping" }, context)).resolves.toBe("first");
		await expect(dispatcher.invoke({ package: "fixture", namespace: "demo", method: "pong" }, context)).resolves.toBe("second");
		// Endpoint collisions across DIFFERENT packages still must throw.
		expect(() => dispatcher.register({ package: "other", descriptors: [{ namespace: "demo", method: "ping" }] }, context)).toThrow("already registered");
	});

	it("keeps the previous registration when a replacement collides", async () => {
		const context = contextOf({ ping: () => "ping", pong: () => "pong" });
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "fixture", descriptors: [{ namespace: "demo", method: "ping" }] }, context);
		dispatcher.register({ package: "other", descriptors: [{ namespace: "demo", method: "pong" }] }, context);

		expect(() => dispatcher.register({ package: "fixture", descriptors: [{ namespace: "demo", method: "pong" }] }, context)).toThrow("already registered");
		await expect(dispatcher.invoke({ package: "fixture", namespace: "demo", method: "ping" }, context)).resolves.toBe("ping");
		await expect(dispatcher.invoke({ package: "other", namespace: "demo", method: "pong" }, context)).resolves.toBe("pong");
	});

	it("removes a package registration", async () => {
		const context = contextOf({ ping: () => "ok" });
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "fixture", descriptors: [{ namespace: "demo", method: "ping" }] }, context);
		dispatcher.unregister("fixture");
		await expect(dispatcher.invoke({ package: "fixture", namespace: "demo", method: "ping" }, context)).rejects.toThrow("not registered");
	});

	it("projects registered endpoints as Harness descriptors", () => {
		const context = contextOf({ ping: () => "ok" });
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "@fixture/remote", descriptors: [{ namespace: "demo", method: "ping", parameters: [{ name: "value" }] }] }, context);

		expect(dispatcher.describe("demo/ping")).toMatchObject({ package: "@fixture/remote", namespace: "demo", method: "ping" });
		expect(dispatcher.describeAll()).toHaveLength(1);
		expect(dispatcher.describe("demo/missing")).toBeUndefined();
	});

	it("accepts Harness named arguments and endpoint calls without a package", async () => {
		const service = { rename: (id: string, title: string) => `${id}:${title}` };
		const context = contextOf(service);
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "@fixture/goals", descriptors: [{ namespace: "demo", method: "rename", parameters: [{ name: "id" }, { name: "title" }] }] }, context);
		await expect(dispatcher.invoke({ namespace: "demo", method: "rename", args: { id: "g1", title: "Goal" } }, context)).resolves.toBe("g1:Goal");
	});

	it("accepts generated Harness acceptsUndefined parameters when omitted", async () => {
		const service = { greet: (name: string, suffix?: string) => `${name}${suffix ?? ""}` };
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "@fixture/greetings", descriptors: [{
			namespace: "greetings",
			method: "greet",
			service: "demo",
			parameters: [
				{ name: "name", wire: "name", source: "json" },
				{ name: "suffix", wire: "suffix", source: "json", acceptsUndefined: true },
			],
		}] }, contextOf(service));
		await expect(dispatcher.invoke({ namespace: "greetings", method: "greet", args: { name: "Pi" } }, contextOf(service))).resolves.toBe("Pi");
	});

	it("resolves a generated endpoint through its Cordis service and implementation names", async () => {
		const context = { get: (name: string) => name === "goalService" ? { renameGoal: (id: string) => `renamed:${id}` } : undefined };
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "@fixture/goals", descriptors: [{ namespace: "goals", method: "rename", service: "goalService", implementation: "renameGoal", parameters: [{ wire: "id" }] }] }, context);
		await expect(dispatcher.invoke({ namespace: "goals", method: "rename", args: { id: "g1" } }, context)).resolves.toBe("renamed:g1");
	});

	it("discovers methods owned directly by a plain service object", async () => {
		const service = { ping: (value: string) => `pong:${value}` };
		const context = contextOf(service);
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "fixture", descriptors: [{ namespace: "demo", method: "ping" }] }, context);
		await expect(dispatcher.invoke({ namespace: "demo", method: "ping", args: ["ok"] }, context)).resolves.toBe("pong:ok");
	});

	it("enforces named argument descriptors and injects context and cancellation", async () => {
		const calls: unknown[] = [];
		const service = {
			run: (...args: unknown[]) => { calls.push(args); return "done"; },
		};
		const scopedContext = { get: (name: string) => name === "runner" ? service : undefined };
		const context = { get: (name: string) => name === "agent" ? scopedContext : undefined };
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "fixture", descriptors: [{
			namespace: "runner",
			method: "run",
			service: "runner",
			parameters: [{ name: "value" }],
			invocation: { kind: "context", context: "agent" },
			cancellation: true,
		}] }, context);
		await expect(dispatcher.invoke({ namespace: "runner", method: "run", args: { value: 3 } }, context)).resolves.toBe("done");
		expect(calls[0]).toSatisfy((args) => Array.isArray(args) && args[0] === 3 && args[1] instanceof AbortSignal);
		await expect(dispatcher.invoke({ namespace: "runner", method: "run", args: {} }, context)).rejects.toMatchObject({ code: "arguments-invalid" });
	});

	it("accepts generated Harness cancellation descriptors", async () => {
		const service = { run: (value: number, signal: AbortSignal) => signal instanceof AbortSignal ? value : -1 };
		const context = contextOf(service);
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "@fixture/generated", descriptors: [{
			namespace: "demo", method: "run", service: "demo",
			parameters: [{ name: "value", wire: "value", source: "json", acceptsUndefined: false }],
			cancellation: { parameter: "signal" },
		}] }, context);
		await expect(dispatcher.invoke({ namespace: "demo", method: "run", args: { value: 7 } }, context)).resolves.toBe(7);
	});

	it("resolves Harness lookup parameters through the typert registry", async () => {
		const calls: unknown[] = [];
		const service = { rename: (goal: { id: string }, title: string) => { calls.push([goal, title]); return `${goal.id}:${title}`; } };
		const context = {
			get: (name: string) => name === "goals" ? service : name === "typert" ? {
				lookups: { get: (key: string) => key === "goal" ? { resolve: async (id: string) => ({ id }) } : undefined },
			} : undefined,
		};
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "@fixture/goals", descriptors: [{
			namespace: "goals",
			method: "rename",
			service: "goals",
			parameters: [{ name: "goal", wire: "goalId", source: "lookup", lookup: "goal" }, { name: "title" }],
		}] }, context);
		await expect(dispatcher.invoke({ namespace: "goals", method: "rename", args: { goalId: "g1", title: "Goal" } }, context)).resolves.toBe("g1:Goal");
		expect(calls).toEqual([[{ id: "g1" }, "Goal"]]);
	});

	it("reports unavailable and unresolved lookup providers", async () => {
		const context = contextOf({ use: (value: unknown) => value });
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "fixture", descriptors: [{ namespace: "demo", method: "use", parameters: [{ name: "id", source: "lookup", lookup: "missing" }] }] }, context);
		await expect(dispatcher.invoke({ namespace: "demo", method: "use", args: { id: "x" } }, context)).rejects.toMatchObject({ code: "lookup-unavailable" });

		const resolvedContext = { get: (name: string) => name === "demo" ? { use: (value: unknown) => value } : name === "typert" ? { lookups: { get: () => ({ resolve: () => undefined }) } } : undefined };
		const second = new RemoteDispatcher();
		second.register({ package: "fixture", descriptors: [{ namespace: "demo", method: "use", parameters: [{ name: "id", source: "lookup", lookup: "goal" }] }] }, resolvedContext);
		await expect(second.invoke({ namespace: "demo", method: "use", args: { id: "x" } }, resolvedContext)).rejects.toMatchObject({ code: "lookup-not-found" });
	});

	it("passes a caller AbortSignal to cancellation-aware remotes", async () => {
		let received: AbortSignal | undefined;
		const context = contextOf({ run: (signal: AbortSignal) => { received = signal; return "done"; } });
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "fixture", descriptors: [{ namespace: "demo", method: "run", cancellation: true }] }, context);
		const controller = new AbortController();
		await expect(dispatcher.invoke({ namespace: "demo", method: "run", signal: controller.signal }, context)).resolves.toBe("done");
		expect(received).toBe(controller.signal);
		controller.abort();
		await expect(dispatcher.invoke({ namespace: "demo", method: "run", signal: controller.signal }, context)).rejects.toMatchObject({ code: "cancelled" });
	});

	it("resolves a scoped remote through a registered Host Context provider", async () => {
		const scopedService = { inspect: (id: string) => `scoped:${id}` };
		const scopedContext = { get: (name: string) => name === "goals" ? scopedService : undefined };
		const context = {
			get: (name: string) => name === "typert" ? {
				contexts: { getHost: (key: string) => key === "agent" ? { wire: "agentId", resolve: async (id: string) => id === "a1" ? scopedContext : undefined } : undefined },
			} : undefined,
		};
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "fixture", descriptors: [{
			namespace: "goals",
			method: "inspect",
			service: "goals",
			invocation: { kind: "context", context: "agent", wire: "agentId" },
			parameters: [{ name: "value", wire: "value" }],
		}] }, context);
		await expect(dispatcher.invoke({ namespace: "goals", method: "inspect", args: { agentId: "a1", value: "x" } }, context)).resolves.toBe("scoped:x");
		await expect(dispatcher.invoke({ namespace: "goals", method: "inspect", args: { agentId: "missing", value: "x" } }, context)).rejects.toMatchObject({ code: "context-unavailable" });
	});

	it("uses the provider wire when a scoped descriptor omits it", async () => {
		const scopedContext = { get: (name: string) => name === "goals" ? { inspect: (value: string) => value } : undefined };
		const context = {
			get: (name: string) => name === "typert" ? { contexts: { getHost: () => ({ wire: "scopeId", resolve: async (id: string) => id === "s1" ? scopedContext : undefined }) } } : undefined,
		};
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "fixture", descriptors: [{ namespace: "goals", method: "inspect", service: "goals", invocation: { kind: "context", context: "agent" }, parameters: [{ name: "value" }] }] }, context);
		await expect(dispatcher.invoke({ namespace: "goals", method: "inspect", args: { scopeId: "s1", value: "ok" } }, context)).resolves.toBe("ok");
	});

	it("validates strict codec arguments and results at the Host boundary", async () => {
		const context = contextOf({
			echo: (value: { count: number }) => ({ accepted: value.count > 0 }),
		});
		const codec = { mode: "strict" as const, typeSymbol: "fixture/Count", schema: {
			type: "object" as const,
			properties: { count: { schema: { type: "integer" as const } } },
		} };
		const resultCodec = { mode: "strict" as const, typeSymbol: "fixture/Result", schema: {
			type: "object" as const,
			properties: { accepted: { schema: { type: "boolean" as const } } },
		} };
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "fixture", descriptors: [{ namespace: "demo", method: "echo", parameters: [{ name: "value", codec }], result: resultCodec }] }, context);
		await expect(dispatcher.invoke({ namespace: "demo", method: "echo", args: { value: { count: 2 } } }, context)).resolves.toEqual({ accepted: true });
		await expect(dispatcher.invoke({ namespace: "demo", method: "echo", args: { value: { count: "bad" } } }, context)).rejects.toMatchObject({ code: "remote-invalid" });
	});

	it("rejects malformed strict codec schemas during registration", () => {
		const dispatcher = new RemoteDispatcher();
		expect(() => dispatcher.register({ package: "fixture", descriptors: [{ namespace: "demo", method: "echo", result: { mode: "strict", typeSymbol: "fixture/Result", schema: { type: "nope" } } }] }, contextOf({ echo: () => true }))).toThrow("invalid Remote schema");
	});

	it("validates strict scoped identities before Host context lookup", async () => {
		const scopedContext = { get: (name: string) => name === "demo" ? { inspect: (id: number) => id } : undefined };
		const context = {
			get: (name: string) => name === "typert" ? { contexts: { getHost: () => ({ wire: "agentId", resolve: async (id: number) => id === 7 ? scopedContext : undefined }) } } : undefined,
		};
		const identityCodec = { mode: "strict" as const, typeSymbol: "fixture/AgentId", schema: { type: "integer" as const } };
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "fixture", descriptors: [{ namespace: "demo", method: "inspect", service: "demo", invocation: { kind: "context", context: "agent", wire: "agentId", codec: identityCodec }, parameters: [{ name: "value", codec: identityCodec }] }] }, context);
		await expect(dispatcher.invoke({ namespace: "demo", method: "inspect", args: { agentId: "bad", value: 7 } }, context)).rejects.toMatchObject({ code: "remote-invalid", field: "agentId" });
		await expect(dispatcher.invoke({ namespace: "demo", method: "inspect", args: { agentId: 7, value: 7 } }, context)).resolves.toBe(7);
	});
});
