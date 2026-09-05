import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { BuddyIdentity, BuddyTaskEnvelope } from "@openbuddy/collaboration-protocol"
import {
	DurableRelayOutbox,
	JsonRelayOutboxStore,
	JsonRemoteRelayPersistence,
	MemoryRelayOutboxStore,
	MemoryRemoteRelayPersistence,
	RemoteRelayServer,
	RemoteRelayTransport,
	createAes256GcmRelayEnvelopeCodec,
	type BuddyRelayPort,
	type RemoteRelayCredential,
} from "./index"

const requester: BuddyIdentity = { id: "durable-requester", handle: "durable-requester", displayName: "Durable Requester", ownerUserId: "user-1", organizationId: "org", trustLevel: "org", status: "idle" }
const provider: BuddyIdentity = { id: "durable-provider", handle: "durable-provider", displayName: "Durable Provider", ownerUserId: "user-2", organizationId: "org", trustLevel: "org", status: "idle" }
const scope = { communityId: "community", organizationId: "org", roomId: "room" }
const requesterCredential: RemoteRelayCredential = { subject: requester.id, token: "durable-requester-token", expiresAt: "2026-08-30T13:00:00.000Z" }
const providerCredential: RemoteRelayCredential = { subject: provider.id, token: "durable-provider-token", expiresAt: "2026-08-30T13:00:00.000Z" }

function task(messageId = "durable-message"): BuddyTaskEnvelope {
	return {
		protocol: "buddy/1.0", messageType: "task.propose", messageId, traceId: "durable-trace", taskId: "durable-task", nonce: messageId, sender: requester, recipient: provider, roomRef: scope.roomId, createdAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T12:30:00.000Z", objective: "private objective must remain in sender outbox", capability: "research", input: { contextRefs: ["artifact:public"] }, output: { schema: {}, acceptanceTests: [], artifactTypes: ["brief"] }, policy: { dataScopes: ["public:brief"], allowedActions: ["read:public"], forbiddenActions: [], approval: "never", allowDelegation: false, maxDelegationDepth: 0, retention: "task", expiresAt: "2026-08-30T12:30:00.000Z" }, delivery: { acceptedArtifactTypes: ["brief"], retention: "task", redactionRequired: true },
	}
}

describe("durable relay state", () => {
	it("reloads redacted relay events without persisting the private objective", async () => {
		const directory = await mkdtemp(join(tmpdir(), "openbuddy-relay-"))
		try {
			const persistence = new JsonRemoteRelayPersistence(join(directory, "relay.json"))
			const server = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, persistence })
			const relay = new RemoteRelayTransport({ wire: server.connect(requesterCredential), credential: requesterCredential })
			const providerRelay = new RemoteRelayTransport({ wire: server.connect(providerCredential), credential: providerCredential })
			await providerRelay.registerEndpoint({ identity: provider, scope, accept: () => undefined })
			await relay.send(task(), scope)
			await server.flush()
			const persisted = await readFile(join(directory, "relay.json"), "utf8")
			expect(persisted).not.toContain("private objective")
			const restored = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, persistence })
			expect(restored.query(scope)).toHaveLength(1)
			const duplicate = new RemoteRelayTransport({ wire: restored.connect(requesterCredential), credential: requesterCredential })
			const restoredProviderRelay = new RemoteRelayTransport({ wire: restored.connect(providerCredential), credential: providerCredential })
			await restoredProviderRelay.registerEndpoint({ identity: provider, scope, accept: () => undefined })
			await expect(duplicate.send(task(), scope)).resolves.toBeUndefined()
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})

	it("keeps failed deliveries in a JSON outbox and removes them after retry", async () => {
		const directory = await mkdtemp(join(tmpdir(), "openbuddy-outbox-"))
		try {
			const path = join(directory, "outbox.json")
			let available = false
			const sent: string[] = []
			const relay: BuddyRelayPort = {
				registerEndpoint: () => () => undefined,
				send: async (envelope) => {
					if (!available) throw new Error("endpoint unavailable")
					sent.push(envelope.messageId)
				},
			}
			const outbox = new DurableRelayOutbox({ relay, store: new JsonRelayOutboxStore(path), now: () => "2026-08-30T12:00:00.000Z" })
			await expect(outbox.send(task(), scope)).rejects.toThrow("endpoint unavailable")
			expect(outbox.pending()).toHaveLength(1)
			await outbox.flush()
			expect(await readFile(path, "utf8")).toContain("private objective")
			available = true
			expect(await outbox.retryPending()).toEqual([{ messageId: "durable-message", status: "delivered" }])
			expect(outbox.pending()).toEqual([])
			expect(sent).toEqual(["durable-message"])
			await outbox.flush()
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})

	it("restores encrypted pending deliveries after relay restart", async () => {
		const persistence = new MemoryRemoteRelayPersistence()
		const codec = createAes256GcmRelayEnvelopeCodec("relay-encryption-secret")
		const first = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, persistence, envelopeCodec: codec })
		const requesterRelay = new RemoteRelayTransport({ wire: first.connect(requesterCredential), credential: requesterCredential })
		await expect(requesterRelay.send(task("restart-pending"), scope)).rejects.toThrow("unavailable")
		const persisted = persistence.load()
		expect(persisted?.encryptedDeliveries).toHaveLength(1)
		expect(JSON.stringify(persisted)).not.toContain("private objective")

		const restarted = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, persistence, envelopeCodec: codec })
		const providerRelay = new RemoteRelayTransport({ wire: restarted.connect(providerCredential), credential: providerCredential })
		const received: string[] = []
		await providerRelay.registerEndpoint({ identity: provider, scope, accept: (envelope) => { received.push(envelope.messageId) } })
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(received).toEqual(["restart-pending"])
		expect(persistence.load()?.encryptedDeliveries).toEqual([])
		expect(persistence.load()?.deliveries).toEqual([expect.objectContaining({ messageId: "restart-pending", status: "delivered", attempts: 2 })])
	})

	it("rejects tampered encrypted delivery records", () => {
		const codec = createAes256GcmRelayEnvelopeCodec("relay-encryption-secret")
		const record = codec.encrypt({ deliveryId: "delivery-1", envelope: task("tamper-task"), scope, updatedAt: "2026-08-30T12:00:00.000Z" })
		record.ciphertext = `${record.ciphertext}x`
		expect(() => codec.decrypt(record)).toThrow()
	})

	it("serializes retries and restores pending entries from memory state", async () => {
		let fail = true
		const sent: string[] = []
		const relay: BuddyRelayPort = {
			registerEndpoint: () => () => undefined,
			send: async (envelope) => {
				if (fail) throw new Error("offline")
				sent.push(envelope.messageId)
			},
		}
		const store = new MemoryRelayOutboxStore()
		const first = new DurableRelayOutbox({ relay, store, now: () => "2026-08-30T12:00:00.000Z" })
		await expect(first.send(task("retry-1"), scope)).rejects.toThrow("offline")
		const second = new DurableRelayOutbox({ relay, store, now: () => "2026-08-30T12:00:00.000Z" })
		fail = false
		expect(await second.retryPending()).toEqual([{ messageId: "retry-1", status: "delivered" }])
		expect(sent).toEqual(["retry-1"])
	})

	it("drops expired tasks instead of retrying them forever", async () => {
		const relay: BuddyRelayPort = { registerEndpoint: () => () => undefined, send: async () => { throw new Error("offline") } }
		const store = new MemoryRelayOutboxStore()
		const outbox = new DurableRelayOutbox({ relay, store, now: () => "2026-08-30T13:00:00.000Z" })
		const expired = task("expired-message")
		await expect(outbox.send(expired, scope)).rejects.toThrow("relay task has expired")
		expect(await outbox.retryPending()).toEqual([])
		expect(outbox.pending()).toEqual([])
	})
})
