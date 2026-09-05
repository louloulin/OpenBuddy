import { describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CollaborationRuntime } from "./collaboration-runtime";
import { A2ARuntimeFacade } from "./a2a-runtime-adapter";

const sender = {
	id: "remote-buddy",
	handle: "remote",
	displayName: "Remote Buddy",
	ownerUserId: "remote-user",
	trustLevel: "known_peer" as const,
	status: "idle" as const,
};
const now = new Date("2027-08-30T00:00:00.000Z");

describe("A2ARuntimeFacade", () => {
	it("exposes a runtime-owned card without exposing private session data", async () => {
		const runtime = new CollaborationRuntime({ storagePath: "/tmp/openbuddy-a2a-card-test.jsonl", now: () => new Date(now) });

		await runtime.ready;
		const facade = new A2ARuntimeFacade(runtime, () => new Date(now));
		const card = facade.getAgentCard();

		expect(card.metadata.openbuddy.identityId).toBe("buddy-local");
		expect(card.metadata.openbuddy.agentCardStatus).toBe("unverified");
		expect(JSON.stringify(card)).not.toContain("private:");
		expect(JSON.stringify(card)).not.toContain("credential:");
	});

	it("maps an A2A request into the network proposal projection", async () => {
		const runtime = new CollaborationRuntime({ storagePath: "/tmp/openbuddy-a2a-submit-test.jsonl", now: () => new Date(now) });

		await runtime.ready;
		runtime.registerNetworkPeer({ identity: sender, capabilities: [] });
		runtime.setNetworkPeerTrust(sender.id, "known");
		const facade = new A2ARuntimeFacade(runtime, () => new Date(now));
		const result = facade.submitTask({
			id: "a2a-request-1",
			skillId: "research",
			objective: "Compare two public reports",
			sender,
			dataScopes: ["room:personal-room"],
			allowedActions: ["read:artifact"],
			artifactTypes: ["brief"],
			expiresAt: "2027-08-30T01:00:00.000Z",
		});

		expect(result.requestId).toBe("a2a-request-1");
		expect(result.runtimeTaskId).toMatch(/^proposal-/);
		expect(result.view.status.state).toBe("submitted");
		expect(result.view.metadata.openbuddy.taskId).toBe(result.runtimeTaskId);
		expect(facade.getTask(result.runtimeTaskId).id).toBe(result.runtimeTaskId);
	});

	it("rejects network requests carrying private scopes", async () => {
		const runtime = new CollaborationRuntime({ storagePath: "/tmp/openbuddy-a2a-private-test.jsonl", now: () => new Date(now) });

		await runtime.ready;
		runtime.registerNetworkPeer({ identity: sender, capabilities: [] });
		runtime.setNetworkPeerTrust(sender.id, "known");
		const facade = new A2ARuntimeFacade(runtime, () => new Date(now));
		expect(() => facade.submitTask({
			id: "a2a-private",
			skillId: "research",
			objective: "Read private notes",
			sender,
			dataScopes: ["private:notes"],
			allowedActions: [],
			artifactTypes: ["brief"],
			expiresAt: "2027-08-30T01:00:00.000Z",
		})).toThrow(/private/);
	});

	it("is idempotent for retries and rejects request-id or nonce reuse", async () => {
		const runtime = new CollaborationRuntime({ storagePath: "/tmp/openbuddy-a2a-idempotency-test.jsonl", now: () => new Date(now) });

		await runtime.ready;
		runtime.registerNetworkPeer({ identity: sender, capabilities: [] });
		runtime.setNetworkPeerTrust(sender.id, "trusted");
		const facade = new A2ARuntimeFacade(runtime, () => new Date(now));
		const request = {
			id: "a2a-idempotent",
			skillId: "research",
			objective: "Compare two public reports",
			sender,
			dataScopes: ["room:personal-room"],
			allowedActions: ["read:artifact"],
			artifactTypes: ["brief"],
			expiresAt: "2027-08-30T01:00:00.000Z",
		};
		const first = facade.submitTask(request);
		expect(facade.submitTask(request)).toEqual(first);
		expect(() => facade.submitTask({ ...request, objective: "different" })).toThrow(/request id/);
		expect(() => facade.submitTask({ ...request, id: "a2a-other", nonce: "a2a-nonce-reused" })).not.toThrow();
		expect(() => facade.submitTask({ ...request, id: "a2a-third", nonce: "a2a-nonce:a2a-idempotent" })).toThrow(/nonce/);
	});

	it("rejects a request addressed to another Buddy", async () => {
		const runtime = new CollaborationRuntime({ storagePath: "/tmp/openbuddy-a2a-recipient-test.jsonl", now: () => new Date(now) });

		await runtime.ready;
		const facade = new A2ARuntimeFacade(runtime, () => new Date(now));
		expect(() => facade.submitTask({
			id: "a2a-wrong-recipient",
			skillId: "research",
			objective: "Compare two public reports",
			sender,
			recipient: { ...sender, id: "another-buddy" },
			dataScopes: ["room:personal-room"],
			allowedActions: [],
			artifactTypes: ["brief"],
			expiresAt: "2027-08-30T01:00:00.000Z",
		})).toThrow(/recipient/);
	});

	it("requires the sender to be a known or trusted local peer", async () => {
		const runtime = new CollaborationRuntime({ storagePath: "/tmp/openbuddy-a2a-untrusted-test.jsonl", now: () => new Date(now) });

		await runtime.ready;
		const facade = new A2ARuntimeFacade(runtime, () => new Date(now));
		expect(() => facade.submitTask({
			id: "a2a-untrusted",
			skillId: "research",
			objective: "Compare two public reports",
			sender,
			dataScopes: ["room:personal-room"],
			allowedActions: [],
			artifactTypes: ["brief"],
			expiresAt: "2027-08-30T01:00:00.000Z",
		})).toThrow(/authorized local peer/);
	});

	it("restores request idempotency and nonce replay protection after runtime restart", async () => {
		const storagePath = join(tmpdir(), `openbuddy-a2a-restart-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
		try {
			const firstRuntime = new CollaborationRuntime({ storagePath, now: () => new Date(now) });

			await firstRuntime.ready;
			firstRuntime.registerNetworkPeer({ identity: sender, capabilities: [] });
			firstRuntime.setNetworkPeerTrust(sender.id, "trusted");
			const request = {
				id: "a2a-restart",
				skillId: "research",
				objective: "Compare two public reports",
				sender,
				dataScopes: ["room:personal-room"],
				allowedActions: ["read:artifact"],
				artifactTypes: ["brief"],
				expiresAt: "2027-08-30T01:00:00.000Z",
				nonce: "restart-nonce",
			};
			const firstFacade = new A2ARuntimeFacade(firstRuntime, () => new Date(now));
			const first = firstFacade.submitTask(request);
			await firstFacade.flush();
			await firstRuntime.flushPendingIO();

			const secondRuntime = new CollaborationRuntime({ storagePath, now: () => new Date(now) });


			await secondRuntime.ready;
			secondRuntime.registerNetworkPeer({ identity: sender, capabilities: [] });
			secondRuntime.setNetworkPeerTrust(sender.id, "trusted");
			const secondFacade = new A2ARuntimeFacade(secondRuntime, () => new Date(now));
			await secondFacade.init();
			expect(secondFacade.submitTask(request)).toMatchObject({ requestId: request.id, runtimeTaskId: first.runtimeTaskId });
			expect(() => secondFacade.submitTask({ ...request, id: "a2a-restart-other" })).toThrow(/nonce/);
		} finally {
			rmSync(storagePath, { force: true });
			rmSync(`${storagePath}.a2a.json`, { force: true });
			rmSync(`${storagePath}.contracts.json`, { force: true });
			rmSync(`${storagePath}.workflows.json`, { force: true });
			rmSync(`${storagePath}.cursor.json`, { force: true });
		}
	});

	it("restores an accepted request without revalidating its original expiry", async () => {
		const storagePath = join(tmpdir(), `openbuddy-a2a-expiry-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
		try {
			const firstRuntime = new CollaborationRuntime({ storagePath, now: () => new Date(now) });

			await firstRuntime.ready;
			firstRuntime.registerNetworkPeer({ identity: sender, capabilities: [] });
			firstRuntime.setNetworkPeerTrust(sender.id, "trusted");
			const request = {
				id: "a2a-expiry-restart",
				skillId: "research",
				objective: "Persist a public research request",
				sender,
				dataScopes: ["room:personal-room"],
				allowedActions: ["read:artifact"],
				artifactTypes: ["brief"],
				expiresAt: "2027-08-30T00:01:00.000Z",
			};
			const firstFacade = new A2ARuntimeFacade(firstRuntime, () => new Date("2027-08-30T00:00:00.000Z"));
			const first = firstFacade.submitTask(request);
			await firstFacade.flush();
			await firstRuntime.flushPendingIO();
			const secondRuntime = new CollaborationRuntime({ storagePath, now: () => new Date("2027-08-30T00:02:00.000Z") });

			await secondRuntime.ready;
			secondRuntime.registerNetworkPeer({ identity: sender, capabilities: [] });
			secondRuntime.setNetworkPeerTrust(sender.id, "trusted");
			const second = new A2ARuntimeFacade(secondRuntime, () => new Date("2027-08-30T00:02:00.000Z"));
			await second.init();
			expect(second.submitTask(request)).toMatchObject({ runtimeTaskId: first.runtimeTaskId });
		} finally {
			rmSync(storagePath, { force: true });
			rmSync(`${storagePath}.a2a.json`, { force: true });
			rmSync(`${storagePath}.contracts.json`, { force: true });
			rmSync(`${storagePath}.workflows.json`, { force: true });
			rmSync(`${storagePath}.cursor.json`, { force: true });
		}
	});
});
