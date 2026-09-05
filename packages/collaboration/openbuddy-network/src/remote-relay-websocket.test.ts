import { describe, expect, it, vi } from "vitest"
import type { BuddyIdentity, BuddyTaskEnvelope } from "@openbuddy/collaboration-protocol"
import { DurableRelayOutbox, MemoryRelayOutboxStore, PresenceLeaseRegistry, RemoteRelayServer, RemoteRelayTransport, issueFederatedRoomGrant, verifyFederatedRoomGrant } from "./index"
import { attachRemoteRelayWebSocket, createResilientWebSocketRemoteRelayWire, createWebSocketRemoteRelayWire, type RelayWebSocketLike } from "./remote-relay-websocket"

class PairSocket implements RelayWebSocketLike {
	readonly readyState = 1
	readonly OPEN = 1
	readonly CONNECTING = 0
	private readonly listeners = new Map<string, Set<(event: { data?: unknown }) => void>>()
	private peer?: PairSocket

	connect(peer: PairSocket): void { this.peer = peer }

	send(data: string): void {
		queueMicrotask(() => {
			for (const listener of this.peer?.listeners.get("message") ?? []) listener({ data })
		})
	}

	close(): void {
		for (const listener of this.listeners.get("close") ?? []) listener({})
		for (const listener of this.peer?.listeners.get("close") ?? []) listener({})
	}

	addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
		const listeners = this.listeners.get(type) ?? new Set()
		listeners.add(listener)
		this.listeners.set(type, listeners)
	}

	removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void { this.listeners.get(type)?.delete(listener) }
}

function socketPair(): [PairSocket, PairSocket] {
	const left = new PairSocket()
	const right = new PairSocket()
	left.connect(right)
	right.connect(left)
	return [left, right]
}

const requester: BuddyIdentity = { id: "ws-requester", handle: "ws-requester", displayName: "WS Requester", ownerUserId: "user-1", organizationId: "org", trustLevel: "org", status: "idle" }
const provider: BuddyIdentity = { id: "ws-provider", handle: "ws-provider", displayName: "WS Provider", ownerUserId: "user-2", organizationId: "org", trustLevel: "org", status: "idle" }
const scope = { communityId: "community", organizationId: "org", roomId: "room" }
const requesterCredential = { subject: requester.id, token: "ws-requester-token", expiresAt: "2026-08-30T13:00:00.000Z" }
const providerCredential = { subject: provider.id, token: "ws-provider-token", expiresAt: "2026-08-30T13:00:00.000Z" }

function task(overrides: Partial<BuddyTaskEnvelope> = {}): BuddyTaskEnvelope {
	return {
		protocol: "buddy/1.0", messageType: "task.propose", messageId: "ws-task-1", traceId: "ws-trace-1", taskId: "ws-task", nonce: "ws-nonce", sender: requester, recipient: provider, roomRef: scope.roomId, createdAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T12:30:00.000Z", objective: "private objective", capability: "research", input: { contextRefs: ["artifact:public"] }, output: { schema: {}, acceptanceTests: [], artifactTypes: ["brief"] }, policy: { dataScopes: ["public:brief"], allowedActions: ["read:public"], forbiddenActions: [], approval: "never", allowDelegation: false, maxDelegationDepth: 0, retention: "task", expiresAt: "2026-08-30T12:30:00.000Z" }, delivery: { acceptedArtifactTypes: ["brief"], retention: "task", redactionRequired: true },
		...overrides,
	}
}

describe("remote relay WebSocket carrier", () => {
	it("connects independent requester and provider runtimes through typed frames", async () => {
		const server = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true })
		const [requesterClient, requesterServer] = socketPair()
		const [providerClient, providerServer] = socketPair()
		attachRemoteRelayWebSocket(requesterServer, server)
		attachRemoteRelayWebSocket(providerServer, server)
		const requesterWire = new RemoteRelayTransport({ wire: createWebSocketRemoteRelayWire({ baseUrl: "http://relay.invalid", credential: requesterCredential, webSocket: () => requesterClient }), credential: requesterCredential })
		const providerWire = new RemoteRelayTransport({ wire: createWebSocketRemoteRelayWire({ baseUrl: "http://relay.invalid", credential: providerCredential, webSocket: () => providerClient }), credential: providerCredential })
		const received: string[] = []
		await providerWire.registerEndpoint({ identity: provider, scope, accept: (envelope) => { received.push(envelope.objective) } })
		await requesterWire.send(task(), scope)
		expect(received).toEqual(["private objective"])
		expect(JSON.stringify(await providerWire.query(scope))).not.toContain("private objective")
		requesterWire.close()
		providerWire.close()
	})

	it("forwards a federated project-room grant without letting the carrier bypass verification", async () => {
		const secret = "websocket-federated-secret"
		const projectScope = { communityId: "community", organizationId: "org", roomId: "project-project-1" }
		const grant = issueFederatedRoomGrant({ grantId: "ws-grant", projectId: "project-1", communityId: projectScope.communityId, organizationId: projectScope.organizationId, roomId: projectScope.roomId, taskId: "ws-project-task", requesterOrganizationId: "org", providerOrganizationId: "org", allowedPrincipals: [requester.id, provider.id], allowedCapabilities: ["research"], allowedDataScopes: ["public:*"] , allowedActions: ["read:*"] , allowedOperations: ["endpoint.register", "task.send", "events.query"], issuedAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T12:30:00.000Z", issuerId: "org-authority" }, secret)
		const server = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, verifyRoomGrant: (candidate, expected) => verifyFederatedRoomGrant(candidate, secret, expected, "2026-08-30T12:00:00.000Z") })
		const [requesterClient, requesterServer] = socketPair()
		const [providerClient, providerServer] = socketPair()
		attachRemoteRelayWebSocket(requesterServer, server)
		attachRemoteRelayWebSocket(providerServer, server)
		const requesterWire = new RemoteRelayTransport({ wire: createWebSocketRemoteRelayWire({ baseUrl: "http://relay.invalid", credential: requesterCredential, webSocket: () => requesterClient }), credential: requesterCredential })
		const providerWire = new RemoteRelayTransport({ wire: createWebSocketRemoteRelayWire({ baseUrl: "http://relay.invalid", credential: providerCredential, webSocket: () => providerClient }), credential: providerCredential })
		const received: string[] = []
		await providerWire.registerEndpoint({ identity: provider, scope: projectScope, accept: (receivedEnvelope) => { received.push(receivedEnvelope.messageId) } }, grant)
		await requesterWire.send(task({ messageId: "ws-project-message", taskId: "ws-project-task", roomRef: projectScope.roomId }), projectScope, grant)
		expect(received).toEqual(["ws-project-message"])
		requesterWire.close()
		providerWire.close()
	})

	it("synchronizes Presence between two Relay instances over two WebSocket carriers", async () => {
		let now = "2026-08-30T12:00:00.000Z"
		const sourceServer = new RemoteRelayServer({ now: () => now, allowInsecureLocal: true, presenceAuthorityId: "presence-source" })
		const targetServer = new RemoteRelayServer({ now: () => now, allowInsecureLocal: true, presenceAuthorityId: "presence-source" })
		const [sourceClient, sourceSocket] = socketPair()
		const [sourceAdminClient, sourceAdminSocket] = socketPair()
		const [targetClient, targetSocket] = socketPair()
		attachRemoteRelayWebSocket(sourceSocket, sourceServer)
		attachRemoteRelayWebSocket(sourceAdminSocket, sourceServer)
		attachRemoteRelayWebSocket(targetSocket, targetServer)
		const sourceTransport = new RemoteRelayTransport({ wire: createWebSocketRemoteRelayWire({ baseUrl: "http://source.invalid", credential: providerCredential, webSocket: () => sourceClient }), credential: providerCredential })
		const targetTransport = new RemoteRelayTransport({ wire: createWebSocketRemoteRelayWire({ baseUrl: "http://target.invalid", credential: requesterCredential, webSocket: () => targetClient }), credential: requesterCredential })
		const lease = new PresenceLeaseRegistry(() => now).issue({ identityId: provider.id, scope, ttlMs: 60_000 })
		const unregister = await sourceTransport.registerEndpoint({ identity: provider, scope, lease, accept: () => undefined })
		const sourceAdmin = new RemoteRelayTransport({ wire: createWebSocketRemoteRelayWire({ baseUrl: "http://source.invalid", credential: requesterCredential, webSocket: () => sourceAdminClient }), credential: requesterCredential })
		const batch = await sourceAdmin.queryPresences()
		expect(await targetTransport.applyPresences(batch.presences)).toBe(1)
		expect((await targetTransport.queryPresences()).presences[0]).toMatchObject({ status: "active", lease: { leaseId: lease.leaseId } })
		now = "2026-08-30T12:01:01.000Z"
		const expired = await sourceAdmin.queryPresences(1)
		expect(expired.presences.at(-1)).toMatchObject({ status: "expired" })
		unregister()
		sourceTransport.close()
		sourceAdmin.close()
		targetTransport.close()
	})

	it("does not execute a duplicate message twice when the carrier redelivers it", async () => {
		const server = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true })
		const [providerClient, providerServer] = socketPair()
		attachRemoteRelayWebSocket(providerServer, server)
		const providerWire = new RemoteRelayTransport({ wire: createWebSocketRemoteRelayWire({ baseUrl: "http://relay.invalid", credential: providerCredential, webSocket: () => providerClient }), credential: providerCredential })
		let executions = 0
		await providerWire.registerEndpoint({ identity: provider, scope, accept: async () => { executions += 1 } })
		const providerServerWire = server.connect(providerCredential)
		const endpoint = await providerServerWire.request({ kind: "endpoint.register", requestId: "duplicate-endpoint", credential: providerCredential, identity: provider, scope })
		expect(endpoint.ok).toBe(true)
		const request = server.connect(requesterCredential)
		const first = await request.request({ kind: "task.send", requestId: "duplicate-1", credential: requesterCredential, envelope: task(), scope })
		const second = await request.request({ kind: "task.send", requestId: "duplicate-2", credential: requesterCredential, envelope: task(), scope })
		expect(first.ok).toBe(true)
		expect(second.ok).toBe(true)
		expect(executions).toBe(1)
		providerWire.close()
	})

	it("removes an endpoint when its WebSocket closes so a later registration can recover delivery", async () => {
		const server = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true })
		const [requesterClient, requesterServer] = socketPair()
		const [providerClient, providerServer] = socketPair()
		attachRemoteRelayWebSocket(requesterServer, server)
		attachRemoteRelayWebSocket(providerServer, server)
		const requesterWire = new RemoteRelayTransport({ wire: createWebSocketRemoteRelayWire({ baseUrl: "http://relay.invalid", credential: requesterCredential, webSocket: () => requesterClient }), credential: requesterCredential })
		const providerWire = new RemoteRelayTransport({ wire: createWebSocketRemoteRelayWire({ baseUrl: "http://relay.invalid", credential: providerCredential, webSocket: () => providerClient }), credential: providerCredential })
		await providerWire.registerEndpoint({ identity: provider, scope, accept: () => undefined })
		providerWire.close()
		await expect(requesterWire.send(task({ messageId: "after-provider-close" }), scope)).rejects.toThrow("unavailable")

		const [replacementClient, replacementServer] = socketPair()
		attachRemoteRelayWebSocket(replacementServer, server)
		const replacementWire = new RemoteRelayTransport({ wire: createWebSocketRemoteRelayWire({ baseUrl: "http://relay.invalid", credential: providerCredential, webSocket: () => replacementClient }), credential: providerCredential })
		const received: string[] = []
		await replacementWire.registerEndpoint({ identity: provider, scope, accept: (envelope) => { received.push(envelope.messageId) } })
		await expect(requesterWire.send(task({ messageId: "after-provider-reconnect", nonce: "ws-nonce-reconnect" }), scope)).resolves.toBeUndefined()
		expect(received).toEqual(["after-provider-close", "after-provider-reconnect"])
		replacementWire.close()
		requesterWire.close()
	})

	it("replays a failed WebSocket delivery through the sender Outbox after provider reconnect", async () => {
		const server = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true })
		const [requesterClient, requesterServer] = socketPair()
		const [providerClient, providerServer] = socketPair()
		attachRemoteRelayWebSocket(requesterServer, server)
		attachRemoteRelayWebSocket(providerServer, server)
		const requesterWire = new RemoteRelayTransport({ wire: createWebSocketRemoteRelayWire({ baseUrl: "http://relay.invalid", credential: requesterCredential, webSocket: () => requesterClient }), credential: requesterCredential })
		const providerWire = new RemoteRelayTransport({ wire: createWebSocketRemoteRelayWire({ baseUrl: "http://relay.invalid", credential: providerCredential, webSocket: () => providerClient }), credential: providerCredential })
		await providerWire.registerEndpoint({ identity: provider, scope, accept: () => undefined })
		providerWire.close()
		const outbox = new DurableRelayOutbox({ relay: requesterWire, store: new MemoryRelayOutboxStore(), now: () => "2026-08-30T12:00:00.000Z" })
		await expect(outbox.send(task({ messageId: "outbox-websocket-recovery" }), scope)).rejects.toThrow("unavailable")
		expect(outbox.pending()).toHaveLength(1)

		const [replacementClient, replacementServer] = socketPair()
		attachRemoteRelayWebSocket(replacementServer, server)
		const received: string[] = []
		const replacementWire = new RemoteRelayTransport({ wire: createWebSocketRemoteRelayWire({ baseUrl: "http://relay.invalid", credential: providerCredential, webSocket: () => replacementClient }), credential: providerCredential })
		await replacementWire.registerEndpoint({ identity: provider, scope, accept: (envelope) => { received.push(envelope.messageId) } })
		expect(await outbox.retryPending()).toEqual([{ messageId: "outbox-websocket-recovery", status: "delivered" }])
		expect(received).toEqual(["outbox-websocket-recovery"])
		expect(outbox.pending()).toEqual([])
		replacementWire.close()
		requesterWire.close()
	})

	it("automatically reconnects, restores the endpoint, and replays pending work", async () => {
		const server = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true })
		const sockets: PairSocket[] = []
		const providerWire = createResilientWebSocketRemoteRelayWire({
			baseUrl: "http://relay.invalid",
			credential: providerCredential,
			webSocket: () => {
				const [client, serverSocket] = socketPair()
				sockets.push(client)
				attachRemoteRelayWebSocket(serverSocket, server)
				return client
			},
			reconnect: { maxAttempts: 2, backoffMs: 0 },
		})
		const received: string[] = []
		const providerTransport = new RemoteRelayTransport({ wire: providerWire, credential: providerCredential })
		await providerWire.ready
		await providerTransport.registerEndpoint({ identity: provider, scope, accept: (envelope) => { received.push(envelope.messageId) } })
		const requester = new RemoteRelayTransport({ wire: server.connect(requesterCredential), credential: requesterCredential })
		sockets[0].close()
		await vi.waitFor(() => expect(providerWire.status).toBe("ready"))
		await expect(requester.send(task({ messageId: "automatic-reconnect" }), scope)).resolves.toBeUndefined()
		await vi.waitFor(() => expect(received).toEqual(["automatic-reconnect"]))
		providerTransport.close()
	})
})
