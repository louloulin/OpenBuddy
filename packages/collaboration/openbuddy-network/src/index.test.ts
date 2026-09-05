import { describe, expect, it } from "vitest"
import { generateKeyPairSync } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BuddyCapability, BuddyIdentity } from "@openbuddy/collaboration-protocol"
import { agentCardKeyRef, createEd25519AgentCardVerifier, issueEd25519AgentCard, issueEd25519FederatedRoomGrant, issueFederatedRoomGrant, JsonAgentCardTrustStore, JsonAgentDirectoryAdapter, LocalRelay, MemoryAgentCardTrustStore, MemoryAgentDirectoryAdapter, OpenNetworkCoordinator, PeerDirectory, PresenceLeaseRegistry, verifyEd25519FederatedRoomGrant, verifyFederatedRoomGrant } from "./index"

const local: BuddyIdentity = { id: "local", handle: "local", displayName: "Local", ownerUserId: "user", organizationId: "org", trustLevel: "local", status: "idle" }
const peer: BuddyIdentity = { id: "peer", handle: "peer", displayName: "Peer", ownerUserId: "peer-user", organizationId: "peer-org", trustLevel: "known_peer", status: "idle" }
const capability: BuddyCapability = {
	id: "research",
	providerId: peer.id,
	description: "research",
	inputSchema: {},
	outputSchema: {},
	procedure: [],
	allowedDataScopes: ["public:brief"],
	forbiddenDataScopes: ["private:vault"],
	allowedActions: ["read:public"],
	forbiddenActions: ["external:send"],
	acceptanceTests: [],
	requiredApproval: "never",
	allowDelegation: false,
	maxDelegationDepth: 0,
	visibility: "directory",
}

describe("open network coordination", () => {
	it("projects peer discovery into a local, restart-safe directory adapter", async () => {
		const adapter = new MemoryAgentDirectoryAdapter()
		const network = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, directoryAdapter: adapter, now: () => "2026-08-30T12:00:00.000Z" })
		network.registerPeer({ identity: peer, capabilities: [capability] })
		network.setPeerTrust(peer.id, "known")
		expect(adapter.list()).toHaveLength(1)
		expect(adapter.list()[0]).toMatchObject({ identity: { id: peer.id }, trust: "known" })

		const root = await mkdtemp(join(tmpdir(), "openbuddy-directory-"))
		try {
			const path = `${root}/directory.json`
			const persistent = new JsonAgentDirectoryAdapter(path)
			persistent.upsert(adapter.list()[0]!)
			await persistent.flush()
			const restored = new JsonAgentDirectoryAdapter(path)
			await restored.flush()
			expect(restored.list()).toEqual(adapter.list())
			expect(await readFile(path, "utf8")).not.toContain("token")
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})
	it("signs and verifies federated room grants with an Ed25519 trust root", () => {
		const { privateKey, publicKey } = generateKeyPairSync("ed25519")
		const scope = { communityId: "community", organizationId: "org", roomId: "project-project-1" }
		const grant = issueEd25519FederatedRoomGrant({ grantId: "ed-grant", projectId: "project-1", ...scope, taskId: "task-1", requesterOrganizationId: "org", providerOrganizationId: peer.organizationId, allowedPrincipals: [local.id, peer.id], allowedCapabilities: ["research"], allowedDataScopes: ["public:brief"], allowedActions: ["read:public"], allowedOperations: ["task.send"], issuedAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", issuerId: local.id }, privateKey)
		const expected = { principalId: peer.id, principalOrganizationId: peer.organizationId, scope: { ...scope, taskId: "task-1" }, operation: "task.send" as const, taskId: "task-1", capability: "research", dataScopes: ["public:brief"], allowedActions: ["read:public"] }
		expect(() => verifyEd25519FederatedRoomGrant(grant, (keyRef) => keyRef === grant.signature?.keyRef ? publicKey : undefined, expected, "2026-08-30T12:00:00.000Z")).not.toThrow()
		expect(() => verifyEd25519FederatedRoomGrant({ ...grant, taskId: "other-task" }, () => publicKey, expected, "2026-08-30T12:00:00.000Z")).toThrow("signature is invalid")
		expect(() => verifyEd25519FederatedRoomGrant(grant, () => undefined, expected, "2026-08-30T12:00:00.000Z")).toThrow("not trusted")
	})

	it("issues, renews, expires, and revokes presence leases", () => {
		let now = "2026-08-30T12:00:00.000Z"
		const registry = new PresenceLeaseRegistry(() => now)
		const lease = registry.issue({ identityId: peer.id, scope: { communityId: "community", organizationId: "org", roomId: "room" }, ttlMs: 60_000 })
		expect(registry.get(lease.leaseId)).toMatchObject({ identityId: peer.id, expiresAt: "2026-08-30T12:01:00.000Z" })
		now = "2026-08-30T12:00:30.000Z"
		const renewed = registry.renew(lease.leaseId, 120_000)
		expect(renewed.expiresAt).toBe("2026-08-30T12:02:30.000Z")
		now = "2026-08-30T12:03:00.000Z"
		expect(registry.get(lease.leaseId)).toBeUndefined()
		registry.revoke(lease.leaseId)
		expect(registry.expire()).toEqual([])
	})

	it("does not deliver through an expired local presence lease", async () => {
		let now = "2026-08-30T12:00:00.000Z"
		const presence = new PresenceLeaseRegistry(() => now)
		const relay = new LocalRelay({ now: () => now })
		const lease = presence.issue({ identityId: peer.id, scope: { communityId: "community", organizationId: "org", roomId: "room" }, ttlMs: 60_000 })
		await relay.registerEndpoint({ identity: peer, scope: { communityId: "community", organizationId: "org", roomId: "room" }, lease, accept: () => undefined })
		now = "2026-08-30T12:01:01.000Z"
		const envelope = {
			protocol: "buddy/1.0" as const, messageType: "task.propose" as const, messageId: "presence-task", traceId: "presence-trace", taskId: "presence-task", nonce: "presence-nonce", sender: local, recipient: peer, roomRef: "room", createdAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T12:30:00.000Z", objective: "public task", capability: "research", input: { contextRefs: ["artifact:public"] }, output: { schema: {}, acceptanceTests: [], artifactTypes: ["brief"] }, policy: { dataScopes: ["public:brief"], allowedActions: ["read:public"], forbiddenActions: [], approval: "never" as const, allowDelegation: false, maxDelegationDepth: 0, retention: "task" as const, expiresAt: "2026-08-30T12:30:00.000Z" }, delivery: { acceptedArtifactTypes: ["brief"], retention: "task" as const, redactionRequired: true },
		}
		await expect(relay.send(envelope, { communityId: "community", organizationId: "org", roomId: "room" })).rejects.toThrow("presence lease is expired")
	})

	it("requires explicit peer trust before publishing offers or bidding", () => {
		const network = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, now: () => "2026-08-30T12:00:00.000Z" })
		network.registerPeer({ identity: peer, capabilities: [capability] })
		expect(() => network.publishOffer({ providerId: peer.id, capabilityId: capability.id, title: "研究", description: "公开研究服务", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "before_external_commit", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" })).toThrow("trust")
		network.setPeerTrust(peer.id, "known")
		const offer = network.publishOffer({ providerId: peer.id, capabilityId: capability.id, title: "研究", description: "公开研究服务", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "before_external_commit", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" }).value
		const proposal = network.proposeService({ capabilityId: capability.id, objective: "分析公开资料", dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" }).value
		const bid = network.submitBid({ offerId: offer.id, proposalId: proposal.id, providerId: peer.id, message: "可以完成", acceptedDataScopes: ["public:brief"], validUntil: "2026-08-30T13:00:00.000Z" }).value
		expect(network.awardBid(bid.id).value).toMatchObject({ proposal: { status: "awarded" }, bid: { status: "awarded" } })
		expect(network.snapshot().offers).toHaveLength(1)
	})

	it("allows a local Buddy to publish an organization-visible capability", () => {
		const localCapability = { ...capability, id: "local-research", providerId: local.id }
		const network = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, localCapabilities: [localCapability], now: () => "2026-08-30T12:00:00.000Z" })
		const offer = network.publishOffer({ providerId: local.id, capabilityId: localCapability.id, title: "本地研究", description: "本地 Buddy 服务", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" }).value
		expect(offer.providerId).toBe(local.id)
	})

	it("rejects data escalation and keeps blocked peers out of default directory results", () => {
		const directory = new PeerDirectory()
		directory.register({ identity: peer, capabilities: [capability], now: "2026-08-30T12:00:00.000Z" })
		directory.setTrust(peer.id, "blocked", "2026-08-30T12:01:00.000Z")
		expect(directory.query()).toEqual([])
		expect(directory.query({ includeBlocked: true })).toHaveLength(1)
		const network = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, now: () => "2026-08-30T12:00:00.000Z" })
		network.registerPeer({ identity: peer, capabilities: [capability] })
		network.setPeerTrust(peer.id, "trusted")
		const offer = network.publishOffer({ providerId: peer.id, capabilityId: capability.id, title: "研究", description: "公开研究服务", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "directory" }).value
		const proposal = network.proposeService({ capabilityId: capability.id, objective: "分析公开资料", dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" }).value
		expect(() => network.submitBid({ offerId: offer.id, proposalId: proposal.id, providerId: peer.id, message: "越权", acceptedDataScopes: ["private:vault"], validUntil: "2026-08-30T13:00:00.000Z" })).toThrow(/private|intersection/u)
	})

	it("relay is scope-first, redacts objectives to digests, and deduplicates nonce replay", async () => {
		const relay = new LocalRelay()
		const received: string[] = []
		const unsubscribe = relay.subscribe({ communityId: "community", organizationId: "org", roomId: "room" }, (event) => { received.push(event.id); expect(JSON.stringify(event)).not.toContain("private prompt") })
		const envelope = { protocol: "buddy/1.0" as const, messageType: "task.propose" as const, messageId: "message-1", traceId: "trace-1", taskId: "task-1", nonce: "nonce-1", sender: local, roomRef: "room", createdAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", objective: "private prompt", capability: "research", input: { contextRefs: ["artifact:public"] }, output: { schema: {}, acceptanceTests: [], artifactTypes: ["brief"] }, policy: { dataScopes: ["public:brief"], allowedActions: ["read:public"], forbiddenActions: [], approval: "never" as const, allowDelegation: false, maxDelegationDepth: 0, retention: "task" as const, expiresAt: "2026-08-30T13:00:00.000Z" }, delivery: { acceptedArtifactTypes: ["brief"], retention: "task" as const, redactionRequired: true } }
		await relay.send(envelope, { communityId: "community", organizationId: "org", roomId: "room", taskId: "task-1" })
		await relay.send(envelope, { communityId: "community", organizationId: "org", roomId: "room", taskId: "task-1" })
		expect(received).toEqual(["relay-message-1"])
		expect(relay.query({ communityId: "community", roomId: "other-room" })).toEqual([])
		unsubscribe()
	})

	it("delivers the full envelope only to the addressed local Buddy endpoint", async () => {
		const relay = new LocalRelay()
		const received: string[] = []
		const dispose = relay.registerEndpoint({
			identity: peer,
			scope: { communityId: "community", organizationId: "org", roomId: "room" },
			accept: (envelope) => { received.push(envelope.objective) },
		})
		const envelope = { protocol: "buddy/1.0" as const, messageType: "task.propose" as const, messageId: "message-addressed", traceId: "trace-addressed", taskId: "task-addressed", nonce: "nonce-addressed", sender: local, recipient: peer, roomRef: "room", createdAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", objective: "仅 provider 可见的任务合同", capability: "research", input: { contextRefs: ["artifact:public"] }, output: { schema: {}, acceptanceTests: [], artifactTypes: ["brief"] }, policy: { dataScopes: ["public:brief"], allowedActions: ["read:public"], forbiddenActions: [], approval: "never" as const, allowDelegation: false, maxDelegationDepth: 0, retention: "task" as const, expiresAt: "2026-08-30T13:00:00.000Z" }, delivery: { acceptedArtifactTypes: ["brief"], retention: "task" as const, redactionRequired: true } }
		await relay.send(envelope, { communityId: "community", organizationId: "org", roomId: "room", taskId: envelope.taskId })
		expect(received).toEqual(["仅 provider 可见的任务合同"])
		expect(JSON.stringify(relay.query({ communityId: "community", taskId: envelope.taskId }))).not.toContain("仅 provider 可见的任务合同")
		dispose()
	})

	it("enforces signed grants for local project-room delivery and revocation", async () => {
		const secret = "local-project-room-secret"
		const scope = { communityId: "community", organizationId: "org", roomId: "project-project-1" }
		const grant = issueFederatedRoomGrant({
			grantId: "local-grant-1",
			projectId: "project-1",
			communityId: scope.communityId,
			organizationId: scope.organizationId,
			roomId: scope.roomId,
			taskId: "local-project-task",
			requesterOrganizationId: local.organizationId,
			providerOrganizationId: peer.organizationId,
			allowedPrincipals: [local.id, peer.id],
			allowedCapabilities: ["research"],
			allowedDataScopes: ["public:brief"],
			allowedActions: ["read:public"],
			allowedOperations: ["endpoint.register", "task.send"],
			issuedAt: "2026-08-30T12:00:00.000Z",
			expiresAt: "2026-08-30T13:00:00.000Z",
			issuerId: local.id,
		}, secret)
		const relay = new LocalRelay({ now: () => "2026-08-30T12:00:00.000Z", verifyRoomGrant: (candidate, expected) => verifyFederatedRoomGrant(candidate, secret, expected, "2026-08-30T12:00:00.000Z") })
		const received: string[] = []
		const envelope = { protocol: "buddy/1.0" as const, messageType: "task.propose" as const, messageId: "local-project-message", traceId: "local-project-trace", taskId: "local-project-task", nonce: "local-project-nonce", sender: local, recipient: peer, roomRef: scope.roomId, createdAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", objective: "project task", capability: "research", input: { contextRefs: ["artifact:public"] }, output: { schema: {}, acceptanceTests: [], artifactTypes: ["brief"] }, policy: { dataScopes: ["public:brief"], allowedActions: ["read:public"], forbiddenActions: [], approval: "never" as const, allowDelegation: false, maxDelegationDepth: 0, retention: "task" as const, expiresAt: "2026-08-30T13:00:00.000Z" }, delivery: { acceptedArtifactTypes: ["brief"], retention: "task" as const, redactionRequired: true } }
		const dispose = relay.registerEndpoint({ identity: peer, scope, accept: (receivedEnvelope) => { received.push(receivedEnvelope.messageId) } }, grant)
		await relay.send(envelope, scope, grant)
		expect(received).toEqual([envelope.messageId])
		relay.revokeRoomGrant(grant.grantId)
		await expect(relay.send({ ...envelope, messageId: "local-project-message-after-revoke", nonce: "local-project-nonce-after-revoke" }, scope, grant)).rejects.toThrow("revoked")
		dispose()
	})

	it("replays the complete two-Buddy negotiation without leaking the objective", () => {
		const events: import("@openbuddy/collaboration-protocol").BuddyEvent[] = []
		const first = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, now: () => "2026-08-30T12:00:00.000Z", emit: (event) => events.push(event) })
		first.registerPeer({ identity: peer, capabilities: [capability] })
		first.setPeerTrust(peer.id, "trusted")
		const offer = first.publishOffer({ providerId: peer.id, capabilityId: capability.id, title: "研究", description: "公开研究服务", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" }).value
		const proposal = first.proposeService({ capabilityId: capability.id, objective: "私密原始目标不应过网", dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" }).value
		const bid = first.submitBid({ offerId: offer.id, proposalId: proposal.id, providerId: peer.id, message: "可以完成", acceptedDataScopes: ["public:brief"], validUntil: "2026-08-30T13:00:00.000Z" }).value
		first.awardBid(bid.id)
		const replayed = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, initialEvents: events, now: () => "2026-08-30T12:00:00.000Z" })
		expect(replayed.snapshot()).toMatchObject({ peers: [{ identity: { id: peer.id }, trust: "trusted" }], offers: [{ id: offer.id }], proposals: [{ id: proposal.id, status: "awarded" }], bids: [{ id: bid.id, status: "awarded" }] })
		expect(JSON.stringify(events)).not.toContain("私密原始目标")
		expect(() => replayed.proposeService({ capabilityId: "research", objective: "private", dataScopes: ["private:vault"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" })).toThrow("private")
	})

	it("negotiates an auditable capability intersection before bidding", () => {
		const events: import("@openbuddy/collaboration-protocol").BuddyEvent[] = []
		const network = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, now: () => "2026-08-30T12:00:00.000Z", emit: (event) => events.push(event) })
		network.registerPeer({ identity: peer, capabilities: [{ ...capability, requiredApproval: "before_external_commit", allowedActions: ["read:public", "summarize"] }] })
		network.setPeerTrust(peer.id, "trusted")
		const offer = network.publishOffer({ providerId: peer.id, capabilityId: capability.id, title: "研究", description: "公开研究服务", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "always", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" }).value
		const proposal = network.proposeService({ capabilityId: capability.id, objective: "公开资料研究", dataScopes: ["public:brief"], allowedActions: ["read:public"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" }).value
		const agreement = network.negotiateCapability({ offerId: offer.id, proposalId: proposal.id, providerId: peer.id }).value
		expect(agreement).toMatchObject({ requesterId: local.id, providerId: peer.id, capabilityId: capability.id, dataScopes: ["public:brief"], allowedActions: ["read:public"], artifactTypes: ["brief"], approval: "always", status: "accepted" })
		const bid = network.submitBid({ offerId: offer.id, proposalId: proposal.id, providerId: peer.id, message: "可完成", acceptedDataScopes: ["public:brief"], validUntil: "2026-08-30T13:00:00.000Z" }).value
		expect(bid.agreementId).toBe(agreement.id)
		expect(network.snapshot().capabilityAgreements).toEqual([expect.objectContaining({ id: agreement.id, approval: "always" })])
		const replayed = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, initialEvents: events, now: () => "2026-08-30T12:00:00.000Z" })
		expect(replayed.snapshot().capabilityAgreements).toEqual([expect.objectContaining({ id: agreement.id, status: "accepted" })])
		expect(replayed.snapshot().bids[0]).toMatchObject({ agreementId: agreement.id })
	})

	it("negotiates local Buddy offers through the same contract path", () => {
		const localCapability: BuddyCapability = { ...capability, id: "local-research", providerId: local.id, requiredApproval: "always" }
		const network = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, localCapabilities: [localCapability], now: () => "2026-08-30T12:00:00.000Z" })
		const offer = network.publishOffer({ providerId: local.id, capabilityId: localCapability.id, title: "本地研究", description: "本地 Buddy 服务", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" }).value
		const proposal = network.proposeService({ capabilityId: localCapability.id, objective: "本地公开研究", dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" }).value
		const agreement = network.negotiateCapability({ offerId: offer.id, proposalId: proposal.id, providerId: local.id }).value
		expect(agreement).toMatchObject({ providerId: local.id, approval: "always" })
		expect(network.submitBid({ offerId: offer.id, proposalId: proposal.id, providerId: local.id, message: "本地完成", acceptedDataScopes: agreement.dataScopes, validUntil: "2026-08-30T13:00:00.000Z" }).value.agreementId).toBe(agreement.id)
	})

	it("revokes capability agreements explicitly and blocks later awards", () => {
		const events: import("@openbuddy/collaboration-protocol").BuddyEvent[] = []
		const network = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, now: () => "2026-08-30T12:00:00.000Z", emit: (event) => events.push(event) })
		network.registerPeer({ identity: peer, capabilities: [capability] })
		network.setPeerTrust(peer.id, "trusted")
		const offer = network.publishOffer({ providerId: peer.id, capabilityId: capability.id, title: "研究", description: "公开研究服务", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" }).value
		const proposal = network.proposeService({ capabilityId: capability.id, objective: "公开资料研究", dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" }).value
		const agreement = network.negotiateCapability({ offerId: offer.id, proposalId: proposal.id, providerId: peer.id }).value
		const revoked = network.revokeCapabilityAgreement(agreement.id, "peer access was withdrawn")
		expect(revoked.value).toMatchObject({ id: agreement.id, status: "revoked", revokedReason: "peer access was withdrawn", revokedBy: local.id })
		expect(revoked.event.kind).toBe("network.capability_agreement_revoked")
		expect(() => network.submitBid({ offerId: offer.id, proposalId: proposal.id, providerId: peer.id, message: "不能再执行", acceptedDataScopes: ["public:brief"], validUntil: "2026-08-30T13:00:00.000Z" })).toThrow("capability agreement")
		const replayed = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, initialEvents: events, now: () => "2026-08-30T12:00:00.000Z" })
		expect(replayed.snapshot().capabilityAgreements).toEqual([expect.objectContaining({ id: agreement.id, status: "revoked", revokedReason: "peer access was withdrawn" })])
	})

	it("revokes agreements when a trusted peer is blocked", () => {
		const network = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, now: () => "2026-08-30T12:00:00.000Z" })
		network.registerPeer({ identity: peer, capabilities: [capability] })
		network.setPeerTrust(peer.id, "trusted")
		const offer = network.publishOffer({ providerId: peer.id, capabilityId: capability.id, title: "研究", description: "公开研究服务", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" }).value
		const proposal = network.proposeService({ capabilityId: capability.id, objective: "公开资料研究", dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" }).value
		const agreement = network.negotiateCapability({ offerId: offer.id, proposalId: proposal.id, providerId: peer.id }).value
		network.setPeerTrust(peer.id, "revoked")
		expect(network.snapshot().capabilityAgreements).toEqual([expect.objectContaining({ id: agreement.id, status: "revoked", revokedReason: "peer trust changed to revoked" })])
	})

	it("projects authority revocations as an idempotent, replayable audit record", () => {
		const events: import("@openbuddy/collaboration-protocol").BuddyEvent[] = []
		const network = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, emit: (event) => events.push(event), now: () => "2026-08-30T12:00:00.000Z" })
		const record = { authorityId: "authority-a", sequence: 1, kind: "room-grant" as const, identifier: "grant-1", revokedAt: "2026-08-30T12:00:00.000Z" }
		expect(network.applyAuthorityRevocation(record)?.value).toEqual(record)
		expect(network.applyAuthorityRevocation(record)).toBeUndefined()
		expect(network.snapshot().authorityRevocations).toEqual([record])
		const replayed = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, initialEvents: events, now: () => "2026-08-30T12:00:00.000Z" })
		expect(replayed.snapshot().authorityRevocations).toEqual([record])
	})

	it("revokes agreements when a previously verified Agent Card becomes invalid", () => {
		let valid = true
		const network = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, now: () => "2026-08-30T12:00:00.000Z", verifyAgentCard: () => valid })
		const card = { protocol: "agent-card/1" as const, identity: peer, communityId: "community", capabilities: [{ id: capability.id, description: capability.description, acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never" as const }], endpoints: ["local://peer"], issuedAt: "2026-08-30T11:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", signature: { algorithm: "test", keyRef: "peer-key", value: "signed-card" } }
		network.registerPeer({ identity: peer, capabilities: [capability], agentCard: card })
		network.setPeerTrust(peer.id, "trusted")
		const offer = network.publishOffer({ providerId: peer.id, capabilityId: capability.id, title: "研究", description: "公开研究服务", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" }).value
		const proposal = network.proposeService({ capabilityId: capability.id, objective: "公开资料研究", dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" }).value
		const agreement = network.negotiateCapability({ offerId: offer.id, proposalId: proposal.id, providerId: peer.id }).value
		valid = false
		network.refreshAgentCardStatuses()
		expect(network.snapshot().peers[0]).toMatchObject({ agentCardStatus: "unverified" })
		expect(network.snapshot().capabilityAgreements).toEqual([expect.objectContaining({ id: agreement.id, status: "revoked", revokedReason: "peer Agent Card is unverified" })])
	})

	it("validates signed Agent Cards before exposing a peer to directory flows", () => {
		const network = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, now: () => "2026-08-30T12:00:00.000Z", verifyAgentCard: () => true })
		const card = { protocol: "agent-card/1" as const, identity: peer, communityId: "community", capabilities: [{ id: capability.id, description: capability.description, acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never" as const }], endpoints: ["local://peer"], issuedAt: "2026-08-30T11:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", signature: { algorithm: "test", keyRef: "peer-key", value: "signed-card" } }
		const discovered = network.registerPeer({ identity: peer, capabilities: [capability], agentCard: card }).value
		expect(discovered.agentCardStatus).toBe("verified")
		expect(discovered.agentCard?.protocol).toBe("agent-card/1")
		 expect(network.snapshot().peers[0]?.agentCardStatus).toBe("verified")
		expect(network.snapshot().capabilityDirectory).toEqual([expect.objectContaining({ peerId: peer.id, agentCardStatus: "verified", capability: expect.objectContaining({ id: capability.id }) })])
	})

	it("does not treat a signed Agent Card as verified without a verifier", () => {
		const network = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, now: () => "2026-08-30T12:00:00.000Z" })
		const card = { protocol: "agent-card/1" as const, identity: peer, communityId: "community", capabilities: [{ id: capability.id, description: capability.description, acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never" as const }], endpoints: ["local://peer"], issuedAt: "2026-08-30T11:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", signature: { algorithm: "test", keyRef: "peer-key", value: "signed-card" } }
		expect(network.registerPeer({ identity: peer, capabilities: [capability], agentCard: card }).value.agentCardStatus).toBe("unverified")
	})

	it("does not let an unverified Agent Card enter trusted network flows", () => {
		const network = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, now: () => "2026-08-30T12:00:00.000Z" })
		const card = { protocol: "agent-card/1" as const, identity: peer, communityId: "community", capabilities: [{ id: capability.id, description: capability.description, acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never" as const }], endpoints: ["local://peer"], issuedAt: "2026-08-30T11:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", signature: { algorithm: "Ed25519", keyRef: "unknown-key", value: "invalid" } }
		network.registerPeer({ identity: peer, capabilities: [capability], agentCard: card })
		network.setPeerTrust(peer.id, "trusted")
		expect(() => network.publishOffer({ providerId: peer.id, capabilityId: capability.id, title: "研究", description: "公开研究服务", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "before_external_commit", validUntil: "2026-08-30T13:00:00.000Z", visibility: "known_peers" })).toThrow("Agent Card")
	})

	it("signs and verifies Ed25519 Agent Cards before exposing verified discovery", () => {
		const { privateKey, publicKey } = generateKeyPairSync("ed25519")
		const keyRef = agentCardKeyRef(publicKey)
		const signedCard = issueEd25519AgentCard({ protocol: "agent-card/1", identity: { ...peer, publicKeyRef: keyRef }, communityId: "community", capabilities: [{ id: capability.id, description: capability.description, acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never" as const }], endpoints: ["local://peer"], issuedAt: "2026-08-30T11:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z" }, privateKey, keyRef)
		const network = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, now: () => "2026-08-30T12:00:00.000Z", verifyAgentCard: createEd25519AgentCardVerifier((resolvedKeyRef) => resolvedKeyRef === keyRef ? publicKey : undefined) })
		expect(network.registerPeer({ identity: signedCard.identity, capabilities: [capability], agentCard: signedCard }).value.agentCardStatus).toBe("verified")
		const tampered = { ...signedCard, capabilities: signedCard.capabilities.map((entry) => ({ ...entry, description: "tampered" })) }
		expect(network.registerPeer({ identity: tampered.identity, capabilities: [capability], agentCard: tampered }).value.agentCardStatus).toBe("unverified")
		const wrongKey = generateKeyPairSync("ed25519").publicKey
		expect(createEd25519AgentCardVerifier(() => wrongKey)(signedCard)).toBe(false)
		expect(agentCardKeyRef(publicKey)).not.toBe(agentCardKeyRef(wrongKey))
		const derivedCard = issueEd25519AgentCard({ protocol: "agent-card/1", identity: peer, communityId: "community", capabilities: [{ id: capability.id, description: capability.description, acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never" as const }], endpoints: ["local://peer"], issuedAt: "2026-08-30T11:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z" }, privateKey)
		expect(derivedCard.identity.publicKeyRef).toBe(agentCardKeyRef(publicKey))
	})

	it("revalidates Agent Card signatures during event replay instead of trusting persisted status", () => {
		const { privateKey, publicKey } = generateKeyPairSync("ed25519")
		const keyRef = agentCardKeyRef(publicKey)
		const card = issueEd25519AgentCard({ protocol: "agent-card/1", identity: { ...peer, publicKeyRef: keyRef }, communityId: "community", capabilities: [{ id: capability.id, description: capability.description, acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never" as const }], endpoints: ["local://peer"], issuedAt: "2026-08-30T11:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z" }, privateKey, keyRef)
		const events: import("@openbuddy/collaboration-protocol").BuddyEvent[] = []
		const verified = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, now: () => "2026-08-30T12:00:00.000Z", verifyAgentCard: createEd25519AgentCardVerifier(() => publicKey), emit: (event) => events.push(event) })
		verified.registerPeer({ identity: card.identity, capabilities: [capability], agentCard: card })
		expect(events[0]?.payload).toMatchObject({ agentCardStatus: "verified" })
		const withoutVerifier = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, now: () => "2026-08-30T12:00:00.000Z", initialEvents: events })
		expect(withoutVerifier.snapshot().peers[0]).toMatchObject({ agentCardStatus: "unverified" })
		const withVerifier = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, now: () => "2026-08-30T12:00:00.000Z", initialEvents: events, verifyAgentCard: createEd25519AgentCardVerifier(() => publicKey) })
		expect(withVerifier.snapshot().peers[0]).toMatchObject({ agentCardStatus: "verified" })
	})

	it("persists only public Agent Card trust keys and restores revocation", async () => {
		const root = await mkdtemp(join(tmpdir(), "openbuddy-agent-card-trust-"))
		const path = `${root}/trust.json`
		const { publicKey, privateKey } = generateKeyPairSync("ed25519")
		const store = new JsonAgentCardTrustStore(path)
		const record = store.add(publicKey, "2026-08-30T12:00:00.000Z")
		expect(store.resolvePublicKey(record.keyRef)).toBeDefined()
		await store.flush()
		const restored = new JsonAgentCardTrustStore(path)
		await restored.flush()
		expect(restored.resolvePublicKey(record.keyRef)).toBeDefined()
		expect(await readFile(path, "utf8")).not.toContain("PRIVATE KEY")
		restored.revoke(record.keyRef, "2026-08-30T12:01:00.000Z")
		await restored.flush()
		const finalStore = new JsonAgentCardTrustStore(path)
		await finalStore.flush()
		expect(finalStore.resolvePublicKey(record.keyRef)).toBeUndefined()
		const memory = new MemoryAgentCardTrustStore()
		expect(memory.add(publicKey).keyRef).toBe(record.keyRef)
		expect(() => memory.addPublicKeyPem(privateKey.export({ format: "pem", type: "pkcs8" }).toString())).toThrow("private keys cannot be added")
		const { publicKey: rsaPublicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
		expect(() => memory.addPublicKeyPem(rsaPublicKey.export({ format: "pem", type: "pkcs1" }).toString())).toThrow("Ed25519 public key")
	})

	it("replays delivery projections and allows a failed delivery to be retried", () => {
		const events: import("@openbuddy/collaboration-protocol").BuddyEvent[] = []
		const network = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, now: () => "2026-08-30T12:00:00.000Z", emit: (event) => events.push(event) })
		network.registerPeer({ identity: peer, capabilities: [capability] })
		network.setPeerTrust(peer.id, "trusted")
		const offer = network.publishOffer({ providerId: peer.id, capabilityId: capability.id, title: "研究", description: "公开研究服务", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil: "2026-08-30T13:00:00.000Z", visibility: "directory" }).value
		const proposal = network.proposeService({ capabilityId: capability.id, objective: "研究", dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: "2026-08-30T13:00:00.000Z" }).value
		const bid = network.submitBid({ offerId: offer.id, proposalId: proposal.id, providerId: peer.id, message: "完成", acceptedDataScopes: ["public:brief"], validUntil: "2026-08-30T13:00:00.000Z" }).value
		network.awardBid(bid.id)
		network.recordDelivery({ bidId: bid.id, proposalId: proposal.id, providerId: peer.id, status: "failed", reason: "endpoint offline" })
		const replayed = new OpenNetworkCoordinator({ communityId: "community", localIdentity: local, initialEvents: events, now: () => "2026-08-30T12:00:00.000Z" })
		expect(replayed.snapshot().deliveries).toEqual([expect.objectContaining({ bidId: bid.id, status: "failed", reason: "endpoint offline" })])
		expect(replayed.getAwardedBid(bid.id)).toMatchObject({ bid: { status: "awarded" }, proposal: { status: "awarded" } })
	})
})
