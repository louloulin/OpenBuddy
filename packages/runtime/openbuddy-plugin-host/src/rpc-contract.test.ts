import { describe, expect, it } from "vitest";
import { PendingRpcChannel, RpcId, RpcMethodRegistry, asRpcResult, createRpcId, isReplayableRpcMethod, parseRpcMessage, rpcError, rpcRequestFingerprint, rpcValue, validateRpcRequestPayload } from "./rpc-contract";

describe("DeepSeek RPC contract", () => {
	it("preserves typed success and failure envelopes", () => {
		const id = createRpcId("test");
		expect(RpcId(id)).toBe(id);
		expect(rpcValue({ ready: true })).toEqual({ ok: true, value: { ready: true } });
		expect(asRpcResult({ ok: false, error: { code: "remote-invalid", message: "bad", details: {} } })).toMatchObject({
			ok: false,
			error: { code: "remote-invalid", message: "bad", details: {} },
		});
	});

	it("shares the safe replay policy and canonicalizes request fingerprints", () => {
		expect(isReplayableRpcMethod("session.history")).toBe(true);
		expect(isReplayableRpcMethod("typert.catalog")).toBe(true);
		expect(isReplayableRpcMethod("session.prompt")).toBe(false);
		expect(rpcRequestFingerprint({ method: "workspace.list", payload: { z: 1, nested: { b: true, a: 2 } } }))
			.toBe(rpcRequestFingerprint({ method: "workspace.list", payload: { nested: { a: 2, b: true }, z: 1 } }));
	});

		it("maps remote errors without losing endpoint details", () => {
		const result = rpcError(Object.assign(new Error("missing endpoint"), { code: "endpoint-not-registered", endpoint: "demo/run" }));
		expect(result).toEqual({
			ok: false,
			error: {
				code: "endpoint-not-registered",
				message: "missing endpoint",
				details: { endpoint: "demo/run" },
			},
		});
	});

	it("preserves capability-specific safety error codes", () => {
			const result = rpcError(Object.assign(new Error("must confirm"), { code: "confirmation_required" }));
			expect(result).toMatchObject({ ok: false, error: { code: "confirmation_required", message: "must confirm" } });
		});

	it("enforces non-negative readEvent windows", () => {
		expect(() => validateRpcRequestPayload("session.readEvent", { sessionId: "s1", seq: 2, before: 0, after: 50 })).not.toThrow();
		expect(() => validateRpcRequestPayload("session.readEvent", { sessionId: "s1", seq: -1 })).toThrowError(/validation/u);
		expect(() => validateRpcRequestPayload("session.readEvent", { sessionId: "s1", seq: 2, before: -1 })).toThrowError(/validation/u);
		expect(() => validateRpcRequestPayload("session.readEvent", { sessionId: "s1", seq: 2, after: Number.POSITIVE_INFINITY })).toThrowError(/validation/u);
	});

	it("recognizes durable cache revision conflicts as a wire error", () => {
		const result = rpcError(Object.assign(new Error("stale writer"), { code: "rpc-revision-conflict", details: { expectedRevision: 1, actualRevision: 2 } }));
		expect(result).toMatchObject({ ok: false, error: { code: "rpc-revision-conflict", details: { expectedRevision: 1, actualRevision: 2 } } });
	});

	it("enforces the stable typed request wire without closing dynamic plugin endpoints", () => {
		expect(() => validateRpcRequestPayload("capability.email", { action: "prepare-processing-plan", operations: [{ accountId: "a1", threadIds: ["t1"], kind: "star", value: true, rationale: "test" }], expiresInMs: 300000 })).not.toThrow();
		expect(() => validateRpcRequestPayload("capability.email", { action: "execute-processing-plan", planId: "plan-1", confirmationToken: "email-plan:test" })).not.toThrow();
		expect(() => validateRpcRequestPayload("capability.email", { action: "cancel-processing-plan", planId: "plan-1" })).not.toThrow();
		expect(() => validateRpcRequestPayload("capability.email", { action: "create-reminders-from-analysis", analysisId: "analysis-1", actionIndexes: [0], confirmed: true })).not.toThrow();
		expect(() => validateRpcRequestPayload("capability.email", { action: "save-analysis", accountId: "a1", threadId: "t1", kind: "actions", confidence: 0.9, summary: "summary", facts: [], actions: [], risks: [], replyDraft: undefined, linkedTaskIds: ["task-1"] })).not.toThrow();
		expect(() => validateRpcRequestPayload("session.history", { sessionId: "s1" })).not.toThrow();
		expect(() => validateRpcRequestPayload("host.listDirectory", {})).not.toThrow();
		expect(() => validateRpcRequestPayload("host.createDirectory", { path: "/workspace", name: "new-folder" })).not.toThrow();
		expect(() => validateRpcRequestPayload("host.createDirectory", { path: "/workspace", name: "nested/folder" })).toThrowError(/validation/);
		 expect(() => validateRpcRequestPayload("host.openPath", { path: "/workspace" })).not.toThrow();
		expect(() => validateRpcRequestPayload("deepseek-pi.describe", {})).not.toThrow();
		expect(() => validateRpcRequestPayload("deepseek-pi.describe", { extra: true })).toThrowError(/validation/);
		expect(() => validateRpcRequestPayload("session.history", { sessionId: "s1", extra: true })).toThrowError(/validation/);
		expect(() => validateRpcRequestPayload("session.traceEvent", { sessionId: "s1", seq: -1 })).toThrowError(/validation/);
		expect(() => validateRpcRequestPayload("session.prompt", { sessionId: "s1" })).toThrowError(/validation/);
		expect(() => validateRpcRequestPayload("session.prompt", { sessionId: "s1", content: [{ type: "text", text: "hello" }], mode: "steer" })).not.toThrow();
		expect(() => validateRpcRequestPayload("session.prompt", { sessionId: "s1", content: [{ type: "image", mediaType: "image/png", data: "AAAA" }] })).not.toThrow();
		 expect(() => validateRpcRequestPayload("session.prompt", { sessionId: "s1", content: [{ type: "image", mediaType: "", data: "AAAA" }] })).toThrowError(/validation/);
		expect(() => validateRpcRequestPayload("subagent.list", { parentSessionId: "parent" })).not.toThrow();
		expect(() => validateRpcRequestPayload("subagent.history", { parentSessionId: "parent", childSessionId: "child", mode: "one-shot" })).not.toThrow();
		expect(() => validateRpcRequestPayload("subagent.prompt", { parentSessionId: "parent", childSessionId: "child", mode: "continuable", content: [{ type: "text", text: "continue" }] })).not.toThrow();
		expect(() => validateRpcRequestPayload("subagent.interrupt", { parentSessionId: "parent", childSessionId: "child", mode: "one-shot" })).toThrowError(/validation/);
		expect(() => validateRpcRequestPayload("session.updateQueue", { sessionId: "s1", itemId: "q1", action: { kind: "unknown" } })).toThrowError(/validation/);
		expect(() => validateRpcRequestPayload("session.updateQueue", { sessionId: "s1", itemId: "q1", action: { kind: "edit" } })).toThrowError(/validation/);
		expect(() => validateRpcRequestPayload("session.updateQueue", { sessionId: "s1", itemId: "q1", action: { kind: "remove" } })).not.toThrow();
		expect(() => validateRpcRequestPayload("session.search", { query: "hello", limit: 0 })).toThrowError(/validation/);
		expect(() => validateRpcRequestPayload("workspace.rename", { workspaceId: "w1", title: "Work" })).not.toThrow();
		expect(() => validateRpcRequestPayload("workspace.archiveSession", { sessionId: "s1", archived: "yes" })).toThrowError(/validation/);
		expect(() => validateRpcRequestPayload("remote.custom", { arbitrary: true })).not.toThrow();
		const failure = rpcError(Object.assign(new Error("invalid payload"), { code: "bad-request", details: { issues: [{ path: ["extra"], message: "unknown field" }] } }));
		expect(failure).toMatchObject({ error: { code: "bad-request", details: { issues: [{ path: ["extra"] }] } } });
	});

	it("correlates requests and handles reverse-direction requests", async () => {
		const sent: unknown[] = [];
		const channel = new PendingRpcChannel((message) => { sent.push(message); }, 1000);
		const pending = channel.request("session.list", { cwd: "/workspace" });
		const request = sent[0] as { rpcId: string };
		expect(parseRpcMessage(request)).toMatchObject({ type: "client-request", method: "session.list" });
		await expect(channel.receive({ type: "server-response", rpcId: request.rpcId, result: rpcValue({ items: [] }) })).resolves.toEqual({ accepted: true });
		await expect(pending).resolves.toEqual({ ok: true, value: { items: [] } });

		channel.on("approval.request", async (payload) => ({ approved: Boolean((payload as { approve?: unknown }).approve) }));
		await expect(channel.receive({ type: "server-request", rpcId: "server-1", method: "approval.request", payload: { approve: true } })).resolves.toEqual({ accepted: true });
		expect(sent.at(-1)).toMatchObject({ type: "client-response", rpcId: "server-1", result: { ok: true, value: { approved: true } } });
		channel.dispose();
	});

	it("keeps a reverse-direction request pending until its handler resolves", async () => {
		const sent: unknown[] = [];
		let resolveHandler: ((value: unknown) => void) | undefined;
		const channel = new PendingRpcChannel((message) => { sent.push(message); });
		channel.on("session.question", () => new Promise((resolve) => { resolveHandler = resolve; }));
		const receipt = channel.receive({ type: "server-request", rpcId: "question-1", method: "session.question", payload: { requestId: "question-1" } });
		await Promise.resolve();
		expect(sent).toHaveLength(0);
		resolveHandler?.({ answers: { choice: "yes" } });
		await expect(receipt).resolves.toEqual({ accepted: true });
		expect(sent.at(-1)).toMatchObject({ type: "client-response", rpcId: "question-1", result: { ok: true, value: { answers: { choice: "yes" } } } });
		channel.dispose();
	});

	it("deduplicates in-flight and replayed server requests by rpc id", async () => {
		const sent: unknown[] = [];
		let calls = 0;
		const channel = new PendingRpcChannel((message) => { sent.push(message); });
		channel.on("session.question", async () => {
			calls += 1;
			await Promise.resolve();
			return { answers: { choice: "yes" } };
		});
		const request = { type: "server-request" as const, rpcId: "question-replay", method: "session.question", payload: {} };
		await Promise.all([channel.receive(request), channel.receive(request)]);
		await channel.receive(request);
		expect(calls).toBe(1);
		expect(sent).toHaveLength(3);
		expect(sent.every((message) => (message as { type: string }).type === "client-response")).toBe(true);
		channel.dispose();
	});

	it("returns stable receipts for malformed and duplicate responses", async () => {
		const channel = new PendingRpcChannel(() => undefined, 1000);
		await expect(channel.receive({ type: "server-response", rpcId: "missing", result: rpcValue(null) })).resolves.toEqual({ accepted: false, reason: "not-pending" });
		await expect(channel.receive({ type: "bad", rpcId: "missing" })).resolves.toEqual({ accepted: false, reason: "bad-response" });
		channel.dispose();
	});

	it("preserves Harness Typert boundary error codes across RPC", async () => {
		const channel = new PendingRpcChannel(() => undefined);
		const result = rpcError(new Error("strict definition was withdrawn"), "definition-unavailable", { endpoint: "demo/ping" });
		expect(result).toEqual({ ok: false, error: { code: "definition-unavailable", message: "strict definition was withdrawn", details: { endpoint: "demo/ping" } } });
		const input = rpcError(new Error("bad named arguments"), "input-invalid");
		expect(input).toMatchObject({ ok: false });
		if (!input.ok) expect(input.error.code).toBe("input-invalid");
		channel.dispose();
	});

	it("removes abort listeners after completion and disposal", async () => {
		const sent: unknown[] = [];
		const channel = new PendingRpcChannel((message) => { sent.push(message); }, 1000);
		const controller = new AbortController();
		const pending = channel.request("session.list", {}, controller.signal);
		const id = (sent[0] as { rpcId: string }).rpcId;
		await channel.receive({ type: "server-response", rpcId: id, result: rpcValue({ items: [] }) });
		await expect(pending).resolves.toEqual({ ok: true, value: { items: [] } });
		controller.abort();
		channel.dispose();
	});

	it("provides a typed, disposable method registry", async () => {
		const registry = new RpcMethodRegistry();
		const dispose = registry.register("session.prompt", async (payload) => ({ sessionId: payload.sessionId, accepted: true as const }));
		await expect(registry.dispatch({ type: "server-request", rpcId: RpcId("server-2"), method: "session.prompt", payload: { sessionId: "s1", text: "hello" } })).resolves.toMatchObject({
			type: "client-response", rpcId: "server-2", result: { ok: true, value: { sessionId: "s1", accepted: true } },
		});
		dispose();
		await expect(registry.dispatch({ type: "server-request", rpcId: RpcId("server-3"), method: "session.prompt", payload: {} })).resolves.toMatchObject({ result: { ok: false, error: { code: "method-unavailable" } } });
	});
});
