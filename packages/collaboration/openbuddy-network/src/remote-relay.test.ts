import { describe, expect, it } from "vitest"
import { generateKeyPairSync } from "node:crypto"
import type { BuddyIdentity, BuddyTaskEnvelope } from "@openbuddy/collaboration-protocol"
import { MemoryRemoteRelayPersistence, PresenceLeaseRegistry, RemoteRelayServer, RemoteRelayTransport, agentCardKeyRef, createEd25519RelayCredentialVerifier, createHmacRelayCredentialVerifier, issueFederatedRoomGrant, issueRelayCapabilityToken, issueEd25519RelayCredential, issueEd25519RelayRevocation, issueEd25519RelayDirectoryCard, issueRelayCredential, verifyEd25519RelayDirectoryCard, verifyEd25519RelayRevocation, verifyFederatedRoomGrant, verifyRelayCapabilityToken, type RemoteRelayCredential } from "./index"

const requester: BuddyIdentity = { id: "requester", handle: "requester", displayName: "Requester", ownerUserId: "user-1", organizationId: "org", trustLevel: "org", status: "idle" }
const provider: BuddyIdentity = { id: "provider", handle: "provider", displayName: "Provider", ownerUserId: "user-2", organizationId: "org", trustLevel: "org", status: "idle" }
const scope = { communityId: "community", organizationId: "org", roomId: "room" }
const requesterCredential: RemoteRelayCredential = { subject: requester.id, token: "requester-token", expiresAt: "2026-08-30T13:00:00.000Z" }
const providerCredential: RemoteRelayCredential = { subject: provider.id, token: "provider-token", expiresAt: "2026-08-30T13:00:00.000Z" }

function envelope(overrides: Partial<BuddyTaskEnvelope> = {}): BuddyTaskEnvelope {
	return {
		protocol: "buddy/1.0",
		messageType: "task.propose",
		messageId: "remote-message-1",
		traceId: "remote-trace-1",
		taskId: "task-1",
		nonce: "remote-nonce-1",
		sender: requester,
		recipient: provider,
		roomRef: scope.roomId,
		createdAt: "2026-08-30T12:00:00.000Z",
		expiresAt: "2026-08-30T12:30:00.000Z",
		objective: "private objective must not enter relay events",
		capability: "research",
		input: { contextRefs: ["artifact:public"] },
		output: { schema: {}, acceptanceTests: [], artifactTypes: ["brief"] },
		policy: { dataScopes: ["public:brief"], allowedActions: ["read:public"], forbiddenActions: [], approval: "never", allowDelegation: false, maxDelegationDepth: 0, retention: "task", expiresAt: "2026-08-30T12:30:00.000Z" },
		delivery: { acceptedArtifactTypes: ["brief"], retention: "task", redactionRequired: true },
		...overrides,
	}
}

describe("remote relay seam", () => {
	it("routes between independent connections, redacts events, and replays after subscription reconnect", async () => {
		const server = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true })
		const requesterRelay = new RemoteRelayTransport({ wire: server.connect(requesterCredential), credential: requesterCredential })
		const providerRelay = new RemoteRelayTransport({ wire: server.connect(providerCredential), credential: providerCredential })
		const received: string[] = []
		await providerRelay.registerEndpoint({ identity: provider, scope, accept: (task) => { received.push(task.objective) } })
		await requesterRelay.send(envelope(), scope)
		await requesterRelay.send(envelope(), scope)
		expect(received).toEqual(["private objective must not enter relay events"])
		const events = await providerRelay.query(scope)
		expect(events).toHaveLength(1)
		expect(JSON.stringify(events)).not.toContain("private objective")
		const replayed: string[] = []
		const unsubscribe = providerRelay.subscribe(scope, (event) => replayed.push(event.id))
		expect(replayed).toEqual([events[0].id])
		unsubscribe()
		await requesterRelay.send(envelope({ messageId: "remote-message-2", taskId: "task-2", nonce: "remote-nonce-2" }), scope)
		const resumed: string[] = []
		const reconnect = providerRelay.subscribe(scope, (event) => resumed.push(event.id), { sinceEventId: events[0].id })
		expect(resumed).toHaveLength(1)
		expect(resumed[0]).not.toBe(events[0].id)
		reconnect()
		requesterRelay.close()
		providerRelay.close()
	})

	it("rejects mismatched identities, expired credentials, and revoked credentials", async () => {
		let now = "2026-08-30T12:00:00.000Z"
		const server = new RemoteRelayServer({ now: () => now, allowInsecureLocal: true })
		const relay = new RemoteRelayTransport({ wire: server.connect(requesterCredential), credential: requesterCredential })
		await expect(relay.send(envelope({ sender: provider }), scope)).rejects.toThrow("sender identity")
		now = "2026-08-30T13:01:00.000Z"
		await expect(relay.send(envelope({ messageId: "expired" }), scope)).rejects.toThrow("expired")
		const freshNow = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true })
		freshNow.revoke(requesterCredential.token)
		const revoked = new RemoteRelayTransport({ wire: freshNow.connect(requesterCredential), credential: requesterCredential })
		await expect(revoked.query(scope)).rejects.toThrow("revoked")
	})

	it("verifies signed credentials and task-bound capability tokens", async () => {
		const secret = "relay-test-secret"
		const signedRequester = issueRelayCredential({ subject: requester.id, token: "signed-requester", issuedAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z" }, secret)
		const signedProvider = issueRelayCredential({ subject: provider.id, token: "signed-provider", issuedAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z" }, secret)
		const capabilityToken = issueRelayCapabilityToken({ jti: "cap-1", subject: requester.id, communityId: scope.communityId, organizationId: scope.organizationId, roomId: scope.roomId, taskId: "signed-task", capability: "research", dataScopes: ["public:brief"], allowedActions: ["read:public"], issuedAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T12:30:00.000Z" }, secret)
		const server = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", verifyCredential: createHmacRelayCredentialVerifier(secret, () => "2026-08-30T12:00:00.000Z"), verifyCapability: (token, expected) => { verifyRelayCapabilityToken(token, secret, expected, "2026-08-30T12:00:00.000Z") } })
		const requesterRelay = new RemoteRelayTransport({ wire: server.connect(signedRequester), credential: signedRequester })
		const providerRelay = new RemoteRelayTransport({ wire: server.connect(signedProvider), credential: signedProvider })
		await providerRelay.registerEndpoint({ identity: provider, scope, accept: () => undefined })
		await requesterRelay.send(envelope({ taskId: "signed-task", capabilityToken }), scope)
		await expect(requesterRelay.send(envelope({ messageId: "bad-capability", taskId: "signed-task", capabilityToken: `${capabilityToken}x` }), scope)).rejects.toThrow("signature is invalid")
		server.revokeCapability(capabilityToken)
		await expect(requesterRelay.send(envelope({ messageId: "revoked-capability", taskId: "signed-task", capabilityToken }), scope)).rejects.toThrow("capability token is revoked")
		const tamperedCredential = { ...signedRequester, expiresAt: "2026-08-30T12:45:00.000Z" }
		const tamperedWire = server.connect(signedRequester)
		await expect(tamperedWire.request({ kind: "events.query", requestId: "tampered", credential: tamperedCredential, scope })).resolves.toMatchObject({ ok: false, error: { message: "relay credential does not match connection" } })
	})

	it("publishes and queries a redacted Agent Directory card across relay restart", async () => {
		const persistence = new MemoryRemoteRelayPersistence()
		const server = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, persistence })
		const transport = new RemoteRelayTransport({ wire: server.connect(requesterCredential), credential: requesterCredential })
		await transport.publishDirectoryCard({
			identity: requester,
			communityId: scope.communityId,
			capabilities: [{ id: "research", description: "公开研究", allowedDataScopes: ["public:brief"], allowedActions: ["read:public"], acceptedArtifactTypes: ["brief"], approval: "before_external_commit" }],
			agentCard: { protocol: "agent-card/1", digest: "card-digest", issuedAt: "2026-08-30T11:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z" },
			updatedAt: "2026-08-30T12:00:00.000Z",
		})
		const cards = await transport.queryDirectory(scope.communityId, "research")
		expect(cards).toHaveLength(1)
		expect(cards[0]?.identity.id).toBe(requester.id)
		expect(cards[0]?.capabilities[0]?.id).toBe("research")
		const restored = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, persistence })
		const restoredTransport = new RemoteRelayTransport({ wire: restored.connect(requesterCredential), credential: requesterCredential })
		expect(await restoredTransport.queryDirectory(scope.communityId)).toHaveLength(1)
	})

	it("requires a trusted signed directory card in secure relay mode", async () => {
		const { privateKey, publicKey } = generateKeyPairSync("ed25519")
		const keyRef = agentCardKeyRef(publicKey)
		const signedRequester = issueEd25519RelayCredential({ subject: requester.id, token: "signed-directory-requester", issuedAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z" }, privateKey)
		const server = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", verifyCredential: createEd25519RelayCredentialVerifier(() => publicKey, () => "2026-08-30T12:00:00.000Z"), directoryPublicKeyResolver: (resolvedKeyRef) => resolvedKeyRef === keyRef ? publicKey : undefined })
		const relay = new RemoteRelayTransport({ wire: server.connect(signedRequester), credential: signedRequester })
		const card = issueEd25519RelayDirectoryCard({ identity: { ...requester, publicKeyRef: keyRef }, communityId: scope.communityId, capabilities: [{ id: "research", description: "公开研究", allowedDataScopes: ["public:brief"], allowedActions: ["read:public"], acceptedArtifactTypes: ["brief"], approval: "never" }], agentCard: { protocol: "agent-card/1", keyRef, digest: "signed-card", issuedAt: "2026-08-30T11:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z" }, updatedAt: "2026-08-30T12:00:00.000Z" }, privateKey, keyRef)
		await relay.publishDirectoryCard(card)
		expect((await relay.queryDirectory(scope.communityId))[0]?.signature?.keyRef).toBe(keyRef)
		const tampered = { ...card, capabilities: [{ ...card.capabilities[0]!, allowedActions: ["external:send"] }], signature: { ...card.signature! } }
		await expect(relay.publishDirectoryCard(tampered)).rejects.toThrow("signature is invalid")
		verifyEd25519RelayDirectoryCard(card, (resolvedKeyRef) => resolvedKeyRef === keyRef ? publicKey : undefined, "2026-08-30T12:00:00.000Z")
	})

	it("verifies Ed25519 relay credentials with a rotatable trust root", async () => {
		const first = generateKeyPairSync("ed25519")
		const second = generateKeyPairSync("ed25519")
		const firstRef = "ed25519:relay-key-1"
		const secondRef = "ed25519:relay-key-2"
		const trusted = new Map([[firstRef, first.publicKey], [secondRef, second.publicKey]])
		let now = "2026-08-30T12:00:00.000Z"
		const credential = issueEd25519RelayCredential({ subject: requester.id, token: "ed25519-requester", issuedAt: now, expiresAt: "2026-08-30T13:00:00.000Z", keyRef: firstRef }, first.privateKey)
		const server = new RemoteRelayServer({ now: () => now, verifyCredential: createEd25519RelayCredentialVerifier((keyRef) => trusted.get(keyRef), () => now) })
		const relay = new RemoteRelayTransport({ wire: server.connect(credential), credential })
		await expect(relay.query(scope)).resolves.toEqual([])

		trusted.delete(firstRef)
		await expect(relay.query(scope)).rejects.toThrow("not trusted")
		const rotated = issueEd25519RelayCredential({ subject: requester.id, token: "ed25519-requester-rotated", issuedAt: now, expiresAt: "2026-08-30T13:00:00.000Z", keyRef: secondRef }, second.privateKey)
		const rotatedRelay = new RemoteRelayTransport({ wire: server.connect(rotated), credential: rotated })
		await expect(rotatedRelay.query(scope)).resolves.toEqual([])

		now = "2026-08-30T13:01:00.000Z"
		await expect(rotatedRelay.query(scope)).rejects.toThrow("expired")
	})

	it("propagates ordered revocations between independent relay instances", async () => {
		const source = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, revocationAuthorityId: "relay-a" })
		const target = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, revocationAuthorityId: "relay-b" })
		const admin: RemoteRelayCredential = { subject: "relay-admin", token: "relay-admin-token", expiresAt: "2026-08-30T13:00:00.000Z" }
		const sourceAdmin = new RemoteRelayTransport({ wire: source.connect(admin), credential: admin })
		const targetAdmin = new RemoteRelayTransport({ wire: target.connect(admin), credential: admin })
		const targetRequester = new RemoteRelayTransport({ wire: target.connect(requesterCredential), credential: requesterCredential })

		source.revoke(requesterCredential.token)
		const batch = await sourceAdmin.queryRevocations()
		expect(batch.revocations).toHaveLength(1)
		expect(batch.revocations[0]).toMatchObject({ authorityId: "relay-a", sequence: 1, kind: "credential" })
		expect(await targetAdmin.applyRevocations(batch.revocations)).toBe(1)
		expect(await targetAdmin.applyRevocations(batch.revocations)).toBe(0)
		await expect(targetRequester.query(scope)).rejects.toThrow("revoked")
	})

	it("pulls authority state without writing the feed back to the source relay by default", async () => {
		const source = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, revocationAuthorityId: "relay-source" })
		const target = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, revocationAuthorityId: "relay-target" })
		const admin: RemoteRelayCredential = { subject: "relay-admin", token: "relay-admin-token", expiresAt: "2026-08-30T13:00:00.000Z" }
		const sourceTransport = new RemoteRelayTransport({ wire: source.connect(admin), credential: admin })
		const targetTransport = new RemoteRelayTransport({ wire: target.connect(admin), credential: admin })
		source.revoke(requesterCredential.token)
		const result = await sourceTransport.syncAuthorityState({ version: 1, revocationSequence: 0, presenceSequence: 0 })
		expect(result.revocations).toHaveLength(1)
		await expect(targetTransport.queryRevocations()).resolves.toMatchObject({ revocations: [] })
		await targetTransport.applyRevocations(result.revocations)
		await expect(targetTransport.queryRevocations()).resolves.toMatchObject({ revocations: [] })
	})

	it("enforces pulled revocations locally before relay-side denylist replication", async () => {
		const source = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, revocationAuthorityId: "authority-source" })
		const target = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, revocationAuthorityId: "authority-target" })
		const admin: RemoteRelayCredential = { subject: "relay-admin", token: "relay-admin-token", expiresAt: "2026-08-30T13:00:00.000Z" }
		const credential = { ...requesterCredential, token: "pulled-revoked-credential" }
		const sourceTransport = new RemoteRelayTransport({ wire: source.connect(admin), credential: admin })
		const targetTransport = new RemoteRelayTransport({ wire: target.connect(credential), credential })
		source.revoke(credential.token)
		const result = await sourceTransport.syncAuthorityState({ version: 1, revocationSequence: 0, presenceSequence: 0 })
		targetTransport.applyLocalRevocations(result.revocations)
		await expect(targetTransport.send(envelope({ messageId: "locally-revoked" }), scope)).rejects.toThrow("credential is revoked")
		expect(result.revocations).toHaveLength(1)
	})

	it("requires an independently signed authority for secure revocation propagation", async () => {
		const { privateKey, publicKey } = generateKeyPairSync("ed25519")
		const source = new RemoteRelayServer({
			now: () => "2026-08-30T12:00:00.000Z",
			allowInsecureLocal: true,
			revocationAuthorityId: "authority-a",
			signRevocation: (record) => issueEd25519RelayRevocation(record, privateKey, "ed25519:authority-a"),
		})
		const target = new RemoteRelayServer({
			now: () => "2026-08-30T12:00:00.000Z",
			allowInsecureLocal: true,
			authorizeRevocation: (credential) => { if (credential.subject !== "relay-admin") throw new Error("relay revocation authority is not authorized") },
			revocationPublicKeyResolver: (keyRef, record) => keyRef === "ed25519:authority-a" && record.authorityId === "authority-a" ? publicKey : undefined,
		})
		const admin: RemoteRelayCredential = { subject: "relay-admin", token: "relay-admin", expiresAt: "2026-08-30T13:00:00.000Z" }
		const sourceAdmin = new RemoteRelayTransport({ wire: source.connect(admin), credential: admin })
		const targetAdmin = new RemoteRelayTransport({ wire: target.connect(admin), credential: admin })
		source.revoke("revoked-secure-token")
		const batch = await sourceAdmin.queryRevocations()
		expect(batch.revocations[0]?.signature?.algorithm).toBe("Ed25519")
		expect(await targetAdmin.applyRevocations(batch.revocations)).toBe(1)
		await expect(targetAdmin.applyRevocations([{ ...batch.revocations[0], signature: { ...batch.revocations[0]!.signature!, value: "tampered" } }])).rejects.toThrow("signature")
		const unsigned = { ...batch.revocations[0] }
		delete unsigned.signature
		await expect(targetAdmin.applyRevocations([unsigned])).rejects.toThrow("signature")
		const forged = issueEd25519RelayRevocation({ ...unsigned, authorityId: "authority-b" }, privateKey, "ed25519:authority-a")
		await expect(targetAdmin.applyRevocations([forged])).rejects.toThrow("trusted")
		const ordinary = new RemoteRelayTransport({ wire: target.connect({ subject: "ordinary", token: "ordinary", expiresAt: "2026-08-30T13:00:00.000Z" }), credential: { subject: "ordinary", token: "ordinary", expiresAt: "2026-08-30T13:00:00.000Z" } })
		await expect(ordinary.applyRevocations([batch.revocations[0]!])).rejects.toThrow("not authorized")
		verifyEd25519RelayRevocation(batch.revocations[0]!, (keyRef, record) => keyRef === "ed25519:authority-a" && record.authorityId === "authority-a" ? publicKey : undefined, "2026-08-30T12:00:00.000Z")
	})

	it("stops replay when a provider presence lease expires", async () => {
		let now = "2026-08-30T12:00:00.000Z"
		const presence = new PresenceLeaseRegistry(() => now)
		const lease = presence.issue({ identityId: provider.id, scope, ttlMs: 60_000 })
		const server = new RemoteRelayServer({ now: () => now, allowInsecureLocal: true })
		const requesterRelay = new RemoteRelayTransport({ wire: server.connect(requesterCredential), credential: requesterCredential })
		await expect(requesterRelay.send(envelope({ messageId: "lease-offline" }), scope)).rejects.toThrow("unavailable")
		const providerRelay = new RemoteRelayTransport({ wire: server.connect(providerCredential), credential: providerCredential })
		const received: string[] = []
		await providerRelay.registerEndpoint({ identity: provider, scope, lease, accept: (receivedEnvelope) => { received.push(receivedEnvelope.messageId) } })
		now = "2026-08-30T12:01:01.000Z"
		await expect(requesterRelay.send(envelope({ messageId: "lease-expired" }), scope)).rejects.toThrow("presence lease")
		expect(received).toEqual(["lease-offline"])
	})

	it("propagates presence leases with ordered active and expiry records", async () => {
		let now = "2026-08-30T12:00:00.000Z"
		const persistence = new MemoryRemoteRelayPersistence()
		const source = new RemoteRelayServer({ now: () => now, allowInsecureLocal: true, persistence, presenceAuthorityId: "presence-a" })
		const target = new RemoteRelayServer({ now: () => now, allowInsecureLocal: true, presenceAuthorityId: "presence-a", authorizePresence: (credential) => { if (credential.subject !== "relay-admin") throw new Error("presence authority is not authorized") } })
		const admin: RemoteRelayCredential = { subject: "relay-admin", token: "relay-admin", expiresAt: "2026-08-30T13:00:00.000Z" }
		const sourceAdmin = new RemoteRelayTransport({ wire: source.connect(admin), credential: admin })
		const targetAdmin = new RemoteRelayTransport({ wire: target.connect(admin), credential: admin })
		const lease = new PresenceLeaseRegistry(() => now).issue({ identityId: provider.id, scope, ttlMs: 60_000 })
		const unregister = await new RemoteRelayTransport({ wire: source.connect(providerCredential), credential: providerCredential }).registerEndpoint({ identity: provider, scope, lease, accept: () => undefined })
		const activeBatch = await sourceAdmin.queryPresences()
		expect(activeBatch.presences).toHaveLength(1)
		expect(activeBatch.presences[0]).toMatchObject({ authorityId: "presence-a", status: "active", lease: { identityId: provider.id } })
		expect(await targetAdmin.applyPresences(activeBatch.presences)).toBe(1)
		expect(await targetAdmin.applyPresences(activeBatch.presences)).toBe(0)
		now = "2026-08-30T12:01:01.000Z"
		const expiredBatch = await sourceAdmin.queryPresences(1)
		expect(expiredBatch.presences.at(-1)).toMatchObject({ status: "expired", lease: { leaseId: lease.leaseId } })
		expect(await targetAdmin.applyPresences(expiredBatch.presences)).toBe(1)
		const ordinary = new RemoteRelayTransport({ wire: target.connect(providerCredential), credential: providerCredential })
		await expect(ordinary.applyPresences(expiredBatch.presences)).rejects.toThrow("not authorized")
		unregister()
		expect(JSON.stringify(persistence.load())).toContain("presence-a")
	})

	it("keeps an offline recipient retryable without duplicating the redacted event", async () => {
		const server = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true })
		const requesterRelay = new RemoteRelayTransport({ wire: server.connect(requesterCredential), credential: requesterCredential })
		await expect(requesterRelay.send(envelope({ messageId: "offline-message" }), scope)).rejects.toThrow("unavailable")
		const providerRelay = new RemoteRelayTransport({ wire: server.connect(providerCredential), credential: providerCredential })
		const received: string[] = []
		await providerRelay.registerEndpoint({ identity: provider, scope, accept: (task) => { received.push(task.messageId) } })
		await requesterRelay.send(envelope({ messageId: "offline-message" }), scope)
		await requesterRelay.send(envelope({ messageId: "offline-message" }), scope)
		expect(received).toEqual(["offline-message"])
		expect((await providerRelay.query(scope))).toHaveLength(1)
	})

	it("replays a pending delivery automatically when an in-memory provider reconnects", async () => {
		const server = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true })
		const requesterRelay = new RemoteRelayTransport({ wire: server.connect(requesterCredential), credential: requesterCredential })
		await expect(requesterRelay.send(envelope({ messageId: "automatic-replay" }), scope)).rejects.toThrow("unavailable")
		const received: string[] = []
		const providerRelay = new RemoteRelayTransport({ wire: server.connect(providerCredential), credential: providerCredential })
		await providerRelay.registerEndpoint({ identity: provider, scope, accept: (receivedEnvelope) => { received.push(receivedEnvelope.messageId) } })
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(received).toEqual(["automatic-replay"])
		expect(server.query(scope)).toHaveLength(1)
	})

	it("persists delivery metadata across relay restart without persisting the envelope", async () => {
		const persistence = new MemoryRemoteRelayPersistence()
		const first = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, persistence })
		const requester = new RemoteRelayTransport({ wire: first.connect(requesterCredential), credential: requesterCredential })
		await expect(requester.send(envelope({ messageId: "persisted-delivery" }), scope)).rejects.toThrow("unavailable")
		const state = persistence.load()
		expect(state?.deliveries).toEqual([expect.objectContaining({ messageId: "persisted-delivery", status: "failed", attempts: 1, lastError: "relay recipient endpoint is unavailable" })])
		expect(JSON.stringify(state)).not.toContain("private objective")

		const restarted = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, persistence })
		const providerRelay = new RemoteRelayTransport({ wire: restarted.connect(providerCredential), credential: providerCredential })
		const received: string[] = []
		await providerRelay.registerEndpoint({ identity: provider, scope, accept: (receivedEnvelope) => { received.push(receivedEnvelope.messageId) } })
		const retried = new RemoteRelayTransport({ wire: restarted.connect(requesterCredential), credential: requesterCredential })
		await retried.send(envelope({ messageId: "persisted-delivery" }), scope)
		expect(received).toEqual(["persisted-delivery"])
		expect(persistence.load()?.deliveries).toEqual([expect.objectContaining({ messageId: "persisted-delivery", status: "delivered", attempts: 2 })])
	})

	it("requires the relay host to authorize each requested scope", async () => {
		const server = new RemoteRelayServer({
			now: () => "2026-08-30T12:00:00.000Z",
			authorize: () => undefined,
			authorizeScope: (credential, requestedScope) => {
				if (credential.subject === requester.id && requestedScope.organizationId !== "org") throw new Error("organization scope denied")
			},
		})
		const relay = new RemoteRelayTransport({ wire: server.connect(requesterCredential), credential: requesterCredential })
		await expect(relay.query({ communityId: "community", organizationId: "other-org", roomId: "room" })).rejects.toThrow("scope denied")
	})

	it("requires a signed, task-bound grant for cross-organization project rooms", async () => {
		const secret = "federated-room-secret"
		let now = "2026-08-30T12:00:00.000Z"
		const projectScope = { communityId: "community", organizationId: "org", roomId: "project-project-1" }
		const grant = issueFederatedRoomGrant({
			grantId: "grant-project-1",
			projectId: "project-1",
			communityId: projectScope.communityId,
			organizationId: projectScope.organizationId,
			roomId: projectScope.roomId,
			taskId: "project-task-1",
			requesterOrganizationId: "org",
			providerOrganizationId: "provider-org",
			allowedPrincipals: [requester.id, provider.id],
			allowedCapabilities: ["research"],
			allowedDataScopes: ["public:*"],
			allowedActions: ["read:*"],
			allowedOperations: ["endpoint.register", "task.send", "events.query"],
			issuedAt: now,
			expiresAt: "2026-08-30T12:30:00.000Z",
			issuerId: "org-authority",
		}, secret)
		const server = new RemoteRelayServer({ now: () => now, allowInsecureLocal: true, verifyRoomGrant: (candidate, expected) => verifyFederatedRoomGrant(candidate, secret, expected, now) })
		const requesterRelay = new RemoteRelayTransport({ wire: server.connect(requesterCredential), credential: requesterCredential })
		const providerRelay = new RemoteRelayTransport({ wire: server.connect(providerCredential), credential: providerCredential })
		const received: string[] = []
		await providerRelay.registerEndpoint({ identity: provider, scope: projectScope, accept: (task) => { received.push(task.messageId) } }, grant)
		await requesterRelay.send(envelope({ messageId: "project-message", taskId: "project-task-1", roomRef: projectScope.roomId }), projectScope, grant)
		expect(received).toEqual(["project-message"])

		await expect(requesterRelay.send(envelope({ messageId: "wrong-capability", taskId: "project-task-1", roomRef: projectScope.roomId, capability: "email.send" }), projectScope, grant)).rejects.toThrow("capability")
		await expect(requesterRelay.send(envelope({ messageId: "wrong-org", taskId: "project-task-1", roomRef: projectScope.roomId, sender: { ...requester, organizationId: "other-org" } }), projectScope, grant)).rejects.toThrow("organization")
		await expect(requesterRelay.send(envelope({ messageId: "wrong-data-scope", taskId: "project-task-1", roomRef: projectScope.roomId, input: { contextRefs: ["artifact:private"] }, policy: { ...envelope().policy, dataScopes: ["private:secret"] } }), projectScope, grant)).rejects.toThrow("data scope")
		await expect(requesterRelay.send(envelope({ messageId: "wrong-room", taskId: "project-task-1", roomRef: "project-other" }), { ...projectScope, roomId: "project-other" }, grant)).rejects.toThrow("scope")

		now = "2026-08-30T12:31:00.000Z"
		await expect(requesterRelay.send(envelope({ messageId: "expired-grant", taskId: "project-task-1", roomRef: projectScope.roomId }), projectScope, grant)).rejects.toThrow("expired")
		now = "2026-08-30T12:00:00.000Z"
		server.revokeRoomGrant(grant.grantId)
		await expect(requesterRelay.send(envelope({ messageId: "revoked-grant", taskId: "project-task-1", roomRef: projectScope.roomId }), projectScope, grant)).rejects.toThrow("revoked")
	})

	it("rejects nonce reuse across different messages and persists the replay guard", async () => {
		const persistence = new MemoryRemoteRelayPersistence()
		const server = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, persistence })
		const relay = new RemoteRelayTransport({ wire: server.connect(requesterCredential), credential: requesterCredential })
		const providerRelay = new RemoteRelayTransport({ wire: server.connect(providerCredential), credential: providerCredential })
		await providerRelay.registerEndpoint({ identity: provider, scope, accept: () => undefined })
		const first = envelope({ messageId: "nonce-first", nonce: "nonce-reused" })
		await relay.send(first, scope)
		await expect(relay.send(envelope({ messageId: "nonce-second", nonce: "nonce-reused" }), scope)).rejects.toThrow("nonce")
		expect(persistence.load()?.replayNonces).toEqual([expect.objectContaining({ messageId: "nonce-first" })])
	})

	it("persists credential, capability, and room-grant revocations across restart without storing secrets", async () => {
		const credentialPersistence = new MemoryRemoteRelayPersistence()
		const credentialServer = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, persistence: credentialPersistence })
		credentialServer.revoke(requesterCredential.token)
		const restartedCredentialServer = new RemoteRelayServer({ now: () => "2026-08-30T12:00:00.000Z", allowInsecureLocal: true, persistence: credentialPersistence })
		const revokedCredentialRelay = new RemoteRelayTransport({ wire: restartedCredentialServer.connect(requesterCredential), credential: requesterCredential })
		await expect(revokedCredentialRelay.query(scope)).rejects.toThrow("revoked")

		const secret = "restart-revocation-secret"
		const signedRequester = issueRelayCredential({ subject: requester.id, token: "restart-signed-requester", issuedAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z" }, secret)
		const signedProvider = issueRelayCredential({ subject: provider.id, token: "restart-signed-provider", issuedAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z" }, secret)
		const capabilityToken = issueRelayCapabilityToken({ jti: "restart-capability", subject: requester.id, communityId: scope.communityId, organizationId: scope.organizationId, roomId: scope.roomId, taskId: "restart-capability-task", capability: "research", dataScopes: ["public:brief"], allowedActions: ["read:public"], issuedAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T12:30:00.000Z" }, secret)
		const capabilityPersistence = new MemoryRemoteRelayPersistence()
		const createCapabilityServer = () => new RemoteRelayServer({
			now: () => "2026-08-30T12:00:00.000Z",
			persistence: capabilityPersistence,
			verifyCredential: createHmacRelayCredentialVerifier(secret, () => "2026-08-30T12:00:00.000Z"),
			verifyCapability: (token, expected) => verifyRelayCapabilityToken(token, secret, expected, "2026-08-30T12:00:00.000Z"),
		})
		const capabilityServer = createCapabilityServer()
		const capabilityProvider = new RemoteRelayTransport({ wire: capabilityServer.connect(signedProvider), credential: signedProvider })
		await capabilityProvider.registerEndpoint({ identity: provider, scope, accept: () => undefined })
		capabilityServer.revokeCapability(capabilityToken)
		const restartedCapabilityServer = createCapabilityServer()
		const restartedCapabilityProvider = new RemoteRelayTransport({ wire: restartedCapabilityServer.connect(signedProvider), credential: signedProvider })
		await restartedCapabilityProvider.registerEndpoint({ identity: provider, scope, accept: () => undefined })
		const revokedCapabilityRequester = new RemoteRelayTransport({ wire: restartedCapabilityServer.connect(signedRequester), credential: signedRequester })
		await expect(revokedCapabilityRequester.send(envelope({ messageId: "restart-revoked-capability", taskId: "restart-capability-task", capabilityToken }), scope)).rejects.toThrow("capability token is revoked")

		const projectScope = { communityId: "community", organizationId: "org", roomId: "project-restart" }
		const grant = issueFederatedRoomGrant({
			grantId: "restart-grant",
			projectId: "restart-project",
			communityId: projectScope.communityId,
			organizationId: projectScope.organizationId,
			roomId: projectScope.roomId,
			taskId: "restart-project-task",
			requesterOrganizationId: "org",
			providerOrganizationId: "org",
			allowedPrincipals: [requester.id, provider.id],
			allowedCapabilities: ["research"],
			allowedDataScopes: ["public:*"] ,
			allowedActions: ["read:*"] ,
			allowedOperations: ["endpoint.register", "task.send", "events.query"],
			issuedAt: "2026-08-30T12:00:00.000Z",
			expiresAt: "2026-08-30T12:30:00.000Z",
			issuerId: "restart-authority",
		}, secret)
		const grantPersistence = new MemoryRemoteRelayPersistence()
		const createGrantServer = () => new RemoteRelayServer({
			now: () => "2026-08-30T12:00:00.000Z",
			allowInsecureLocal: true,
			persistence: grantPersistence,
			verifyRoomGrant: (candidate, expected) => verifyFederatedRoomGrant(candidate, secret, expected, "2026-08-30T12:00:00.000Z"),
		})
		const grantServer = createGrantServer()
		grantServer.revokeRoomGrant(grant.grantId)
		const restartedGrantServer = createGrantServer()
		const revokedGrantProvider = new RemoteRelayTransport({ wire: restartedGrantServer.connect(providerCredential), credential: providerCredential })
		await expect(revokedGrantProvider.registerEndpoint({ identity: provider, scope: projectScope, accept: () => undefined }, grant)).rejects.toThrow("federated room grant is revoked")

		const persistedState = JSON.stringify({ credential: credentialPersistence.load(), capability: capabilityPersistence.load(), grant: grantPersistence.load() })
		expect(persistedState).not.toContain(requesterCredential.token)
		expect(persistedState).not.toContain(capabilityToken)
		expect(persistedState).not.toContain("restart-authority")
		expect(persistedState).not.toContain("provider-org")
		expect(capabilityPersistence.load()?.revokedCapabilityDigests).toHaveLength(1)
		expect(grantPersistence.load()?.revokedRoomGrantIds).toEqual([grant.grantId])
	})
})
