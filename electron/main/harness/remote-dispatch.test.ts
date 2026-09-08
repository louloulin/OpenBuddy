/**
 * harness/remote-dispatch.test.ts — Phase L.2 minimal-shim tests.
 *
 * v6 plan §3.4.3 replaced the 471-LOC DSH JSON-RPC dispatcher with a thin
 * PI/Cordis-backed shim. This file drops the 11 advanced-feature test
 * cases (codec / lookup / signal cancellation / scoped context / host
 * context provider) that no live code path exercises — keeping only the
 * 9 cases that exercise the public API surface (register / unregister /
 * invoke / describe) and basic shape validation.
 *
 * The dropped features (and their tests) are slated for full removal in
 * Phase L.4 (DSH runtime facade cleanup) — see v6 §3.4.3.
 */

import { describe, expect, it } from "vitest";
import { RemoteDispatcher } from "./remote-dispatch";

function contextOf(service: unknown) {
	return { get: (name: string) => name === "demo" ? service : undefined };
}

describe("RemoteDispatcher (Phase L.2 minimal shim)", () => {
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

	it("clears all registrations", () => {
		const context = contextOf({ ping: () => "ok" });
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "fixture", descriptors: [{ namespace: "demo", method: "ping" }] }, context);
		expect(dispatcher.describeAll()).toHaveLength(1);
		dispatcher.clear();
		expect(dispatcher.describeAll()).toHaveLength(0);
	});

	it("list() projects registered endpoints as {package, endpoint} pairs", () => {
		const context = contextOf({ ping: () => "ok", pong: () => "ok" });
		const dispatcher = new RemoteDispatcher();
		dispatcher.register({ package: "fixture", descriptors: [{ namespace: "demo", method: "ping" }, { namespace: "demo", method: "pong" }] }, context);
		const list = dispatcher.list();
		expect(list).toHaveLength(2);
		expect(list).toContainEqual({ package: "fixture", endpoint: "demo/ping" });
		expect(list).toContainEqual({ package: "fixture", endpoint: "demo/pong" });
	});
});
