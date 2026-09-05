import {
	createEvent,
	matchesDataScope,
	stableDigest,
	type BuddyCapability,
	type BuddyEvent,
	type BuddyIdentity,
	type BuddyAgentCard,
	type BuddyScope,
	type BuddyTaskEnvelope,
	type FederatedRoomGrant,
	type EventQueryScope,
	type Transport,
} from "@openbuddy/collaboration-protocol"
import type { FederatedRoomGrantExpectation } from "./relay-auth"
import type { AgentDirectoryAdapter } from "./agent-directory"
import type { RelayRevocationRecord } from "./durable-relay"

export {
	JsonAgentDirectoryAdapter,
	MemoryAgentDirectoryAdapter,
	type AgentDirectoryAdapter,
	type AgentDirectoryCapability,
	type AgentDirectoryIdentity,
	type AgentDirectoryPeerProjection,
} from "./agent-directory"

export {
	RemoteRelayServer,
	RemoteRelayTransport,
	type RelaySyncResult,
	type RelaySyncOptions,
	type RelayDirectoryCard,
	type RemoteRelayCredential,
	type RemoteRelayEndpoint,
	type RemoteRelayRequest,
	type RemoteRelayResponse,
	type RemoteRelayWire,
	type RelayRevocationKind,
	type RelayRevocationRecord,
	type RelayPresenceRecord,
	type RelayPresenceStatus,
} from "./remote-relay"
export {
	RelaySyncScheduler,
	type RelaySyncSchedulerOptions,
	type RelaySyncSchedulerSnapshot,
} from "./relay-sync-scheduler"
export {
	attachRemoteRelayWebSocket,
	createWebSocketRemoteRelayWire,
	createResilientWebSocketRemoteRelayWire,
	type RelayWebSocketFactory,
	type RelayWebSocketLike,
	type RemoteRelayConnectionStatus,
	type ResilientWebSocketRemoteRelayWire,
	type WebSocketRemoteRelayWire,
} from "./remote-relay-websocket"
export {
	createHmacRelayCredentialVerifier,
	createEd25519RelayCredentialVerifier,
	issueEd25519RelayRevocation,
	issueRelayCapabilityToken,
	issueRelayCredential,
	issueEd25519RelayCredential,
	verifyRelayCapabilityToken,
	verifyRelayCredential,
	verifyEd25519RelayCredential,
	verifyEd25519RelayRevocation,
	issueEd25519RelayDirectoryCard,
	verifyEd25519RelayDirectoryCard,
	issueFederatedRoomGrant,
	issueEd25519FederatedRoomGrant,
	verifyFederatedRoomGrant,
	verifyEd25519FederatedRoomGrant,
	type RelayCapabilityClaims,
	type RelayCapabilityExpectation,
	type RelayCredentialSignature,
	type RelayEd25519CredentialSignature,
	type RelayCredentialPublicKeyResolver,
	type RelayRevocationPublicKeyResolver,
	type RelayDirectoryPublicKeyResolver,
	type FederatedRoomGrantExpectation,
	type FederatedGrantPublicKeyResolver,
} from "./relay-auth"
export {
	createAes256GcmRelayEnvelopeCodec,
	type RelayEncryptedDeliveryRecord,
	type RelayEnvelopeCodec,
} from "./relay-envelope"
export {
	DurableRelayOutbox,
	JsonRelayOutboxStore,
	JsonRemoteRelayPersistence,
	MemoryRelayOutboxStore,
	JsonRelaySyncCursorStore,
	MemoryRelaySyncCursorStore,
	MemoryRemoteRelayPersistence,
	RelayOutboxExpiredError,
	type RemoteRelayDeliveryRecord,
	type RelayOutboxEntry,
	type RelayOutboxPendingEntry,
	type RelayOutboxRetryResult,
	type RelayOutboxStore,
	type RelaySyncCursor,
	type RelaySyncCursorStore,
	type RemoteRelayPersistence,
	type RemoteRelayPersistenceState,
} from "./durable-relay"
export {
	toA2AAgentCard,
	toA2ATaskView,
	toBuddyTaskEnvelopeFromA2A,
	type A2AAgentCard,
	type A2AAgentSkill,
	type A2APeerTrust,
	type A2ATaskArtifact,
	type A2ATaskRequest,
	type A2ATaskState,
	type A2ATaskView,
	type A2ABuddyTaskProjection,
} from "./a2a-adapter"
export {
	agentCardKeyRef,
	createEd25519AgentCardVerifier,
	issueEd25519AgentCard,
	verifyEd25519AgentCard,
	JsonAgentCardTrustStore,
	MemoryAgentCardTrustStore,
	type AgentCardTrustRecord,
	type AgentCardTrustStore,
	type AgentCardPublicKeyResolver,
} from "./agent-card-auth"

export type PeerTrust = "pending" | "known" | "trusted" | "blocked" | "revoked"

export interface PeerRecord {
	identity: BuddyIdentity
	trust: PeerTrust
	capabilities: BuddyCapability[]
	agentCard?: BuddyAgentCard
	agentCardStatus: "missing" | "unverified" | "verified"
	presence?: PresenceLease
	firstSeenAt: string
	lastSeenAt: string
	verifiedAt?: string
	blockedAt?: string
}

export interface PeerQuery {
	capability?: string
	trust?: PeerTrust | PeerTrust[]
	organizationId?: string
	includeBlocked?: boolean
}

export interface ServiceOffer {
	id: string
	providerId: string
	capabilityId: string
	title: string
	description: string
	acceptedDataScopes: string[]
	acceptedArtifactTypes: string[]
	approval: "never" | "before_external_commit" | "always"
	quote?: {
	amount: number
	currency: string
	unit: "task" | "hour" | "artifact"
	}
	validUntil: string
	visibility: "known_peers" | "directory"
}

export interface ServiceBid {
	id: string
	offerId: string
	providerId: string
	proposalId: string
	agreementId?: string
	message: string
	acceptedDataScopes: string[]
	quote?: ServiceOffer["quote"]
	createdAt: string
	validUntil: string
	status: "submitted" | "withdrawn" | "awarded" | "rejected"
}

export interface ServiceProposal {
	id: string
	requesterId: string
	capabilityId: string
	objectiveDigest: string
	dataScopes: string[]
	allowedActions?: string[]
	artifactTypes: string[]
	expiresAt: string
	status: "open" | "awarded" | "cancelled" | "expired"
	awardedBidId?: string
}

export interface NetworkMutation<T> {
	value: T
	event: BuddyEvent
}

export interface NetworkSnapshot {
	communityId: string
	peers: PeerRecord[]
	capabilityDirectory: NetworkCapabilityDiscovery[]
	offers: ServiceOffer[]
	proposals: ServiceProposal[]
	bids: ServiceBid[]
	capabilityAgreements: NetworkCapabilityAgreement[]
	deliveries: NetworkDeliveryProjection[]
	trustRoots: NetworkTrustRootProjection[]
	authorityRevocations: RelayRevocationRecord[]
	mode: "local-sandbox"
}

export interface NetworkTrustRootProjection {
	keyRef: string
	addedAt: string
	revokedAt?: string
}

export interface NetworkCapabilityDiscovery {
	peerId: string
	identity: BuddyIdentity
	trust: PeerTrust
	agentCardStatus: PeerRecord["agentCardStatus"]
	capability: BuddyCapability
}

export interface NetworkCapabilityAgreement {
	id: string
	requesterId: string
	providerId: string
	proposalId: string
	capabilityId: string
	dataScopes: string[]
	allowedActions: string[]
	artifactTypes: string[]
	approval: "never" | "before_external_commit" | "always"
	expiresAt: string
	status: "accepted" | "expired" | "revoked"
	revokedAt?: string
	revokedReason?: string
	revokedBy?: string
}

export interface NetworkDeliveryProjection {
	bidId: string
	proposalId: string
	providerId: string
	status: "pending_delivery" | "delivered" | "failed"
	updatedAt: string
	reason?: string
}

export interface NetworkCoordinatorOptions {
	communityId: string
	localIdentity: BuddyIdentity
	localCapabilities?: BuddyCapability[]
	now?: () => string
	emit?: (event: BuddyEvent) => void
	initialEvents?: readonly BuddyEvent[]
	verifyAgentCard?: (card: BuddyAgentCard) => boolean
	trustRoots?: () => NetworkTrustRootProjection[]
	directoryAdapter?: AgentDirectoryAdapter
}

export interface PresenceLease {
	leaseId: string
	identityId: string
	communityId: string
	organizationId?: string
	roomId?: string
	issuedAt: string
	expiresAt: string
}

export interface LocalRelayEndpoint {
	identity: BuddyIdentity
	scope: BuddyScope
	lease?: PresenceLease
	accept(envelope: BuddyTaskEnvelope, context?: RelayDeliveryContext): Promise<void> | void
}

export interface RelayDeliveryContext {
	deliveryId: string
}

export type BuddyRelayConnectionStatus = "local" | "unknown" | "connecting" | "ready" | "degraded" | "closed"

export class PresenceLeaseRegistry {
	private readonly leases = new Map<string, PresenceLease>()
	private sequence = 0

	constructor(private readonly now: () => string = () => new Date().toISOString()) {}

	issue(input: { identityId: string; scope: BuddyScope; ttlMs: number }): PresenceLease {
		if (!input.identityId.trim() || !input.scope.communityId || input.ttlMs <= 0) throw new Error("presence lease input is invalid")
		const issuedAt = this.now()
		const lease: PresenceLease = {
			leaseId: `presence-${++this.sequence}`,
			identityId: input.identityId,
			communityId: input.scope.communityId,
			...(input.scope.organizationId ? { organizationId: input.scope.organizationId } : {}),
			...(input.scope.roomId ? { roomId: input.scope.roomId } : {}),
			issuedAt,
			expiresAt: new Date(Date.parse(issuedAt) + input.ttlMs).toISOString(),
		}
		this.leases.set(lease.leaseId, lease)
		return structuredClone(lease)
	}

	register(lease: PresenceLease): PresenceLease {
		if (!lease.leaseId.trim() || !lease.identityId.trim() || !lease.communityId || !Number.isFinite(Date.parse(lease.issuedAt)) || !Number.isFinite(Date.parse(lease.expiresAt)) || Date.parse(lease.expiresAt) <= Date.parse(lease.issuedAt)) throw new Error("presence lease is invalid")
		this.leases.set(lease.leaseId, structuredClone(lease))
		return structuredClone(lease)
	}

	renew(leaseId: string, ttlMs: number): PresenceLease {
		const current = this.leases.get(leaseId)
		if (!current || !this.isActive(current)) throw new Error("presence lease is expired or unknown")
		if (ttlMs <= 0) throw new Error("presence lease ttl is invalid")
		const issuedAt = this.now()
		const renewed: PresenceLease = { ...current, issuedAt, expiresAt: new Date(Date.parse(issuedAt) + ttlMs).toISOString() }
		this.leases.set(leaseId, renewed)
		return structuredClone(renewed)
	}

	revoke(leaseId: string): void {
		this.leases.delete(leaseId)
	}

	get(leaseId: string): PresenceLease | undefined {
		const lease = this.leases.get(leaseId)
		return lease && this.isActive(lease) ? structuredClone(lease) : undefined
	}

	isActive(lease: PresenceLease, expected?: { identityId: string; scope: BuddyScope }): boolean {
		if (!this.leases.has(lease.leaseId) || Date.parse(lease.expiresAt) <= Date.parse(this.now())) return false
		return !expected || (lease.identityId === expected.identityId
			&& lease.communityId === expected.scope.communityId
			&& lease.organizationId === expected.scope.organizationId
			&& lease.roomId === expected.scope.roomId)
	}

	expire(): string[] {
		const expired = [...this.leases.values()].filter((lease) => !this.isActive(lease)).map((lease) => lease.leaseId)
		for (const leaseId of expired) this.leases.delete(leaseId)
		return expired
	}
}

export interface BuddyRelayPort {
	readonly status?: BuddyRelayConnectionStatus
	registerEndpoint(endpoint: LocalRelayEndpoint, grant?: FederatedRoomGrant): Promise<() => void> | (() => void)
	send(envelope: BuddyTaskEnvelope, scope: BuddyScope, grant?: FederatedRoomGrant): Promise<void>
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function required(value: string, name: string): string {
	const normalized = value.trim()
	if (!normalized) throw new Error(`${name} is required`)
	return normalized
}

function strongestApproval(values: Array<"never" | "before_external_commit" | "always">): "never" | "before_external_commit" | "always" {
	if (values.includes("always")) return "always"
	if (values.includes("before_external_commit")) return "before_external_commit"
	return "never"
}

function trustAllowed(peer: PeerRecord, query: PeerQuery): boolean {
	if (!query.includeBlocked && ["blocked", "revoked"].includes(peer.trust)) return false
	if (!query.trust) return true
	return (Array.isArray(query.trust) ? query.trust : [query.trust]).includes(peer.trust)
}

export class PeerDirectory {
	private readonly peers = new Map<string, PeerRecord>()

	constructor(private readonly adapter?: AgentDirectoryAdapter) {}

	register(input: { identity: BuddyIdentity; capabilities: BuddyCapability[]; now: string; presence?: PresenceLease; agentCard?: BuddyAgentCard; agentCardStatus?: PeerRecord["agentCardStatus"] }): PeerRecord {
		const current = this.peers.get(input.identity.id)
		const next: PeerRecord = {
			identity: structuredClone(input.identity),
			trust: current?.trust ?? "pending",
			capabilities: structuredClone(input.capabilities),
			...(input.agentCard ? { agentCard: structuredClone(input.agentCard) } : current?.agentCard ? { agentCard: structuredClone(current.agentCard) } : {}),
			agentCardStatus: input.agentCardStatus ?? current?.agentCardStatus ?? "missing",
			presence: input.presence ? structuredClone(input.presence) : current?.presence,
			firstSeenAt: current?.firstSeenAt ?? input.now,
			lastSeenAt: input.now,
			verifiedAt: current?.verifiedAt,
			blockedAt: current?.blockedAt,
		}
		this.peers.set(next.identity.id, next)
		this.adapter?.upsert(next)
		return structuredClone(next)
	}

	setTrust(peerId: string, trust: PeerTrust, now: string): PeerRecord {
		const peer = this.peers.get(peerId)
		if (!peer) throw new Error("peer is not registered")
		peer.trust = trust
		peer.lastSeenAt = now
		if (trust === "trusted" || trust === "known") peer.verifiedAt = now
		if (trust === "blocked" || trust === "revoked") peer.blockedAt = now
		this.adapter?.upsert(peer)
		return structuredClone(peer)
	}

	setPresence(peerId: string, presence: PresenceLease | undefined): PeerRecord {
		const peer = this.peers.get(peerId)
		if (!peer) throw new Error("peer is not registered")
		peer.presence = presence ? structuredClone(presence) : undefined
		this.adapter?.upsert(peer)
		return structuredClone(peer)
	}

	setAgentCardStatus(peerId: string, status: PeerRecord["agentCardStatus"], now: string): PeerRecord {
		const peer = this.peers.get(peerId)
		if (!peer) throw new Error("peer is not registered")
		peer.agentCardStatus = status
		peer.lastSeenAt = now
		this.adapter?.upsert(peer)
		return structuredClone(peer)
	}

	get(peerId: string): PeerRecord | undefined {
		const peer = this.peers.get(peerId)
		return peer ? structuredClone(peer) : undefined
	}

	query(query: PeerQuery = {}): PeerRecord[] {
		return [...this.peers.values()]
			.filter((peer) => trustAllowed(peer, query))
			.filter((peer) => !query.organizationId || peer.identity.organizationId === query.organizationId)
			.filter((peer) => !query.capability || peer.capabilities.some((capability) => capability.id === query.capability))
			.map((peer) => structuredClone(peer))
	}
}

/**
 * Local, scope-first relay. It models the future WebSocket/relay seam without
 * making network calls or exposing private prompts and credentials.
 */
export class LocalRelay implements Transport, BuddyRelayPort {
	private readonly subscribers = new Map<string, Set<(event: BuddyEvent) => void>>()
	private readonly events: BuddyEvent[] = []
	private readonly endpoints = new Map<string, LocalRelayEndpoint>()
	private readonly deliveredMessages = new Set<string>()
	private readonly endpointGrants = new Map<string, FederatedRoomGrant | undefined>()
	private readonly revokedRoomGrants = new Set<string>()
	private readonly presence: PresenceLeaseRegistry
	private readonly now: () => string
	private verifyRoomGrant?: (grant: FederatedRoomGrant, expected: FederatedRoomGrantExpectation) => void

	constructor(options: { now?: () => string; verifyRoomGrant?: (grant: FederatedRoomGrant, expected: FederatedRoomGrantExpectation) => void } = {}) {
		this.now = options.now ?? (() => new Date().toISOString())
		this.presence = new PresenceLeaseRegistry(this.now)
		this.verifyRoomGrant = options.verifyRoomGrant
	}

	setRoomGrantVerifier(verifyRoomGrant: (grant: FederatedRoomGrant, expected: FederatedRoomGrantExpectation) => void): void {
		this.verifyRoomGrant = verifyRoomGrant
	}

	registerEndpoint(endpoint: LocalRelayEndpoint, grant?: FederatedRoomGrant): () => void {
		if (!endpoint.identity.id || !endpoint.scope.communityId || !endpoint.scope.roomId) throw new Error("relay endpoint requires identity and scope")
		if (endpoint.identity.id !== endpoint.identity.id.trim()) throw new Error("relay endpoint identity is invalid")
		if (endpoint.scope.roomId.startsWith("project-")) {
			if (!grant) throw new Error("federated room grant is required for project room")
			if (this.revokedRoomGrants.has(grant.grantId)) throw new Error("federated room grant is revoked")
			if (!this.verifyRoomGrant) throw new Error("federated room grant verifier is required")
			this.verifyRoomGrant(grant, { principalId: endpoint.identity.id, principalOrganizationId: endpoint.identity.organizationId, scope: endpoint.scope, operation: "endpoint.register" })
		}
		if (endpoint.lease) {
			this.presence.register(endpoint.lease)
			if (!this.presence.isActive(endpoint.lease, { identityId: endpoint.identity.id, scope: endpoint.scope })) throw new Error("relay endpoint presence lease is expired or invalid")
		}
		this.endpoints.set(endpoint.identity.id, endpoint)
		this.endpointGrants.set(endpoint.identity.id, grant ? structuredClone(grant) : undefined)
		return () => {
			if (this.endpoints.get(endpoint.identity.id) === endpoint) {
				this.endpoints.delete(endpoint.identity.id)
				this.endpointGrants.delete(endpoint.identity.id)
			}
		}
	}

	revokeRoomGrant(grantId: string): void {
		if (!grantId.trim()) return
		this.revokedRoomGrants.add(grantId)
		for (const [identityId, grant] of this.endpointGrants) if (grant?.grantId === grantId) this.endpointGrants.delete(identityId)
	}

	hasEndpoint(identityId: string, scope: BuddyScope): boolean {
		const endpoint = this.endpoints.get(identityId)
		return Boolean(endpoint
			&& endpoint.scope.communityId === scope.communityId
			&& endpoint.scope.roomId === scope.roomId
			&& endpoint.scope.organizationId === scope.organizationId)
	}

	async send(envelope: BuddyTaskEnvelope, scope: BuddyScope, grant?: FederatedRoomGrant): Promise<void> {
		if (!scope.communityId || !envelope.taskId || envelope.roomRef !== scope.roomId) throw new Error("relay requires matching community, room, and task scope")
		const roomId = scope.roomId
		if (roomId?.startsWith("project-")) {
			if (!grant) throw new Error("federated room grant is required for project room")
			if (this.revokedRoomGrants.has(grant.grantId)) throw new Error("federated room grant is revoked")
			if (!this.verifyRoomGrant) throw new Error("federated room grant verifier is required")
			this.verifyRoomGrant(grant, { principalId: envelope.sender.id, principalOrganizationId: envelope.sender.organizationId, scope, operation: "task.send", taskId: envelope.taskId, capability: envelope.capability, dataScopes: envelope.policy.dataScopes, allowedActions: envelope.policy.allowedActions })
		}
		if (this.deliveredMessages.has(envelope.messageId)) return
		const event = createEvent({
			id: `relay-${envelope.messageId}`,
			communityId: scope.communityId,
			organizationId: scope.organizationId,
			roomId: scope.roomId,
			taskId: envelope.taskId,
			kind: envelope.messageType,
			actor: envelope.sender,
			nonce: envelope.nonce,
			createdAt: envelope.createdAt,
			subject: envelope.capability,
			payload: {
				messageId: envelope.messageId,
				traceId: envelope.traceId,
				recipientId: envelope.recipient?.id,
				capability: envelope.capability,
				objectiveDigest: stableDigest(envelope.objective),
				contextRefs: envelope.input.contextRefs ?? [],
			},
		})
		const existing = this.events.find((candidate) => candidate.id === event.id || (candidate.actor.id === event.actor.id && candidate.nonce === event.nonce))
		if (!existing) {
			this.events.push(event)
			for (const handler of this.subscribers.get(this.key(scope)) ?? []) handler(structuredClone(event))
		}
			const recipientId = envelope.recipient?.id
			if (!recipientId) return
			const endpoint = this.endpoints.get(recipientId)
			const crossOrgGranted = !!grant && !!endpoint && endpoint.scope.organizationId === grant.providerOrganizationId && scope.organizationId === grant.organizationId
			if (!endpoint || endpoint.scope.communityId !== scope.communityId || endpoint.scope.roomId !== scope.roomId || (endpoint.scope.organizationId !== scope.organizationId && !crossOrgGranted)) throw new Error("relay recipient endpoint is unavailable")
			if (roomId?.startsWith("project-") && this.endpointGrants.get(recipientId)?.grantId !== grant?.grantId) throw new Error("relay recipient endpoint is unavailable")
			if (endpoint.lease && !this.presence.isActive(endpoint.lease, { identityId: endpoint.identity.id, scope: endpoint.scope })) throw new Error("relay recipient presence lease is expired")
			await endpoint.accept(structuredClone(envelope))
		this.deliveredMessages.add(envelope.messageId)
	}

	subscribe(scope: EventQueryScope, handler: (event: BuddyEvent) => void): () => void {
		if (!scope.communityId || !scope.roomId) throw new Error("relay subscription requires communityId and roomId")
		const key = this.key(scope)
		const handlers = this.subscribers.get(key) ?? new Set<(event: BuddyEvent) => void>()
		handlers.add(handler)
		this.subscribers.set(key, handlers)
		return () => {
			handlers.delete(handler)
			if (handlers.size === 0) this.subscribers.delete(key)
		}
	}

	query(scope: EventQueryScope): BuddyEvent[] {
		if (!scope.communityId && !scope.organizationId && !scope.roomId && !scope.taskId) throw new Error("relay query requires scope")
		return this.events.filter((event) =>
			(!scope.communityId || event.communityId === scope.communityId)
			&& (!scope.organizationId || event.organizationId === scope.organizationId)
			&& (!scope.roomId || event.roomId === scope.roomId)
			&& (!scope.taskId || event.taskId === scope.taskId),
		).map((event) => structuredClone(event))
	}

	private key(scope: EventQueryScope): string {
		return `${scope.communityId ?? "_"}:${scope.organizationId ?? "_"}:${scope.roomId ?? "_"}`
	}
}

export class OpenNetworkCoordinator {
	readonly directory: PeerDirectory
	private readonly offers = new Map<string, ServiceOffer>()
	private readonly proposals = new Map<string, ServiceProposal>()
	private readonly bids = new Map<string, ServiceBid>()
	private readonly capabilityAgreements = new Map<string, NetworkCapabilityAgreement>()
	private readonly deliveries = new Map<string, NetworkDeliveryProjection>()
	private readonly authorityRevocations = new Map<string, RelayRevocationRecord>()
	private readonly communityId: string
	private readonly localIdentity: BuddyIdentity
	private localCapabilities: BuddyCapability[]
	private readonly now: () => string
	private readonly emit?: (event: BuddyEvent) => void
	private readonly verifyAgentCard?: (card: BuddyAgentCard) => boolean
	private readonly trustRoots?: () => NetworkTrustRootProjection[]
	private readonly appliedEventIds = new Set<string>()
	private sequence = 0

	constructor(options: NetworkCoordinatorOptions) {
		this.communityId = required(options.communityId, "communityId")
		this.localIdentity = structuredClone(options.localIdentity)
		this.localCapabilities = structuredClone(options.localCapabilities ?? [])
		this.now = options.now ?? (() => new Date().toISOString())
		this.emit = options.emit
		this.verifyAgentCard = options.verifyAgentCard
		this.trustRoots = options.trustRoots
		this.directory = new PeerDirectory(options.directoryAdapter)
		for (const event of options.initialEvents ?? []) this.apply(event)
	}

	setLocalCapabilities(capabilities: BuddyCapability[]): void {
		this.localCapabilities = structuredClone(capabilities)
	}

	refreshAgentCardStatuses(): void {
		for (const peer of this.directory.query({ includeBlocked: true })) {
			if (!peer.agentCard) continue
			const status = this.replayedAgentCardStatus(peer.agentCard, peer.identity, peer.capabilities)
			if (status !== peer.agentCardStatus) {
				this.directory.setAgentCardStatus(peer.identity.id, status, this.now())
				if (status !== "verified") this.revokeAgreementsForPeer(peer.identity.id, `peer Agent Card is ${status}`)
			}
		}
	}

	registerPeer(input: { identity: BuddyIdentity; capabilities: BuddyCapability[]; agentCard?: BuddyAgentCard }): NetworkMutation<PeerRecord> {
		if (input.identity.id === this.localIdentity.id) throw new Error("local identity cannot be registered as a peer")
		const agentCardStatus = input.agentCard ? this.assertAgentCard(input.agentCard, input.identity, input.capabilities) : "missing" as const
		const peer = this.directory.register({ ...input, now: this.now(), agentCardStatus })
		this.sequence = Math.max(this.sequence, this.maxSequenceFromEvents())
		return this.mutate("peer.discovered", peer.identity.id, { peerId: peer.identity.id, trust: peer.trust, identity: peer.identity, capabilities: peer.capabilities, ...(peer.agentCard ? { agentCard: peer.agentCard, agentCardStatus: peer.agentCardStatus } : {}) }, peer)
	}

	setPeerTrust(peerId: string, trust: PeerTrust): NetworkMutation<PeerRecord> {
		const peer = this.directory.setTrust(peerId, trust, this.now())
		const mutation = this.mutate("peer.trust_changed", peerId, { peerId, trust, identity: peer.identity }, peer)
		if (trust === "blocked" || trust === "revoked") this.revokeAgreementsForPeer(peerId, `peer trust changed to ${trust}`)
		return mutation
	}

	setPeerPresence(peerId: string, presence: PresenceLease | undefined): NetworkMutation<PeerRecord> {
		const peer = this.directory.setPresence(peerId, presence)
		return this.mutate("peer.presence_changed", peerId, { peerId, presence: presence ? structuredClone(presence) : undefined }, peer)
	}

	publishOffer(input: Omit<ServiceOffer, "id">): NetworkMutation<ServiceOffer> {
		if (input.providerId !== this.localIdentity.id) this.assertTrusted(input.providerId)
		const capability = input.providerId === this.localIdentity.id
			? this.localCapabilities.find((candidate) => candidate.id === input.capabilityId)
			: this.peerCapability(input.providerId, input.capabilityId)
		if (!capability) throw new Error("peer does not advertise the offered capability")
		if (input.validUntil <= this.now()) throw new Error("offer must not be expired")
		this.assertPublicNetworkScopes(input.acceptedDataScopes)
		this.assertCapabilityScopes(capability, input.acceptedDataScopes)
		const offer: ServiceOffer = { ...structuredClone(input), id: `offer-${++this.sequence}`, acceptedDataScopes: unique(input.acceptedDataScopes), acceptedArtifactTypes: unique(input.acceptedArtifactTypes) }
		this.offers.set(offer.id, offer)
		return this.mutate("network.offer_published", offer.id, { offer }, offer)
	}

	proposeService(input: { capabilityId: string; objective: string; dataScopes: string[]; allowedActions?: string[]; artifactTypes: string[]; expiresAt: string }): NetworkMutation<ServiceProposal> {
		const proposal: ServiceProposal = {
			id: `proposal-${++this.sequence}`,
			requesterId: this.localIdentity.id,
			capabilityId: required(input.capabilityId, "capabilityId"),
			objectiveDigest: stableDigest(required(input.objective, "objective")),
			dataScopes: unique(input.dataScopes),
			...(input.allowedActions ? { allowedActions: unique(input.allowedActions) } : {}),
			artifactTypes: unique(input.artifactTypes),
			expiresAt: input.expiresAt,
			status: "open",
		}
		this.assertPublicNetworkScopes(proposal.dataScopes)
		if (proposal.expiresAt <= this.now()) throw new Error("proposal must not be expired")
		this.proposals.set(proposal.id, proposal)
		return this.mutate("network.proposal_created", proposal.id, { proposal }, proposal)
	}

	negotiateCapability(input: { offerId: string; proposalId: string; providerId: string }): NetworkMutation<NetworkCapabilityAgreement> {
		const agreement = this.buildCapabilityAgreement(input, `agreement-${++this.sequence}`)
		this.capabilityAgreements.set(agreement.id, agreement)
		return this.mutate("network.capability_agreement_created", agreement.id, { agreement }, agreement)
	}

	submitBid(input: { offerId: string; proposalId: string; providerId: string; message: string; acceptedDataScopes: string[]; quote?: ServiceOffer["quote"]; validUntil: string }): NetworkMutation<ServiceBid> {
		if (input.providerId !== this.localIdentity.id) this.assertTrusted(input.providerId)
		const offer = this.offers.get(input.offerId)
		const proposal = this.proposals.get(input.proposalId)
		if (!offer || !proposal || offer.providerId !== input.providerId || offer.capabilityId !== proposal.capabilityId) throw new Error("bid does not match an active offer and proposal")
		if (offer.validUntil <= this.now() || proposal.status !== "open" || proposal.expiresAt <= this.now() || input.validUntil <= this.now()) throw new Error("proposal or offer is not active")
		this.assertPublicNetworkScopes(input.acceptedDataScopes)
		const existingAgreement = [...this.capabilityAgreements.values()].find((candidate) => candidate.requesterId === this.localIdentity.id && candidate.providerId === input.providerId && candidate.capabilityId === proposal.capabilityId && candidate.status === "accepted" && candidate.expiresAt > this.now())
		if ([...this.capabilityAgreements.values()].some((candidate) => candidate.proposalId === input.proposalId && candidate.status === "revoked")) throw new Error("capability agreement for proposal was revoked")
		const agreement = existingAgreement ?? this.negotiateCapability({ offerId: input.offerId, proposalId: input.proposalId, providerId: input.providerId }).value
		if (!input.acceptedDataScopes.every((scope) => agreement.dataScopes.includes(scope))) throw new Error("bid requests data outside the negotiated capability agreement")
		const bid: ServiceBid = { ...structuredClone(input), id: `bid-${++this.sequence}`, agreementId: agreement.id, acceptedDataScopes: unique(input.acceptedDataScopes), createdAt: this.now(), status: "submitted" }
		this.bids.set(bid.id, bid)
		return this.mutate("network.bid_submitted", bid.id, { bid, agreement }, bid)
	}

	awardBid(bidId: string): NetworkMutation<{ proposal: ServiceProposal; bid: ServiceBid }> {
		const bid = this.bids.get(bidId)
		if (!bid) throw new Error("bid not found")
		const proposal = this.proposals.get(bid.proposalId)
		const agreement = bid.agreementId ? this.capabilityAgreements.get(bid.agreementId) : undefined
		if (!proposal || proposal.status !== "open" || bid.status !== "submitted" || proposal.expiresAt <= this.now() || bid.validUntil <= this.now() || !agreement || agreement.status !== "accepted" || agreement.expiresAt <= this.now()) throw new Error("proposal is not awardable")
		if (bid.providerId !== this.localIdentity.id) this.assertTrusted(bid.providerId)
		proposal.status = "awarded"
		proposal.awardedBidId = bid.id
		bid.status = "awarded"
		const value = { proposal: structuredClone(proposal), bid: structuredClone(bid) }
		return this.mutate("network.bid_awarded", bid.id, { bid: value.bid, proposal: value.proposal, settlement: "not_configured" }, value)
	}

	getAwardedBid(bidId: string): { proposal: ServiceProposal; bid: ServiceBid } | undefined {
		const bid = this.bids.get(bidId)
		if (!bid || bid.status !== "awarded") return undefined
		const proposal = this.proposals.get(bid.proposalId)
		if (!proposal || proposal.status !== "awarded" || proposal.awardedBidId !== bid.id) return undefined
		return { proposal: structuredClone(proposal), bid: structuredClone(bid) }
	}

	revokeCapabilityAgreement(agreementId: string, reason: string, actorId = this.localIdentity.id): NetworkMutation<NetworkCapabilityAgreement> {
		const agreement = this.capabilityAgreements.get(agreementId)
		if (!agreement) throw new Error("capability agreement not found")
		if (agreement.status === "revoked") return { value: structuredClone(agreement), event: createEvent({
			id: `network-noop-${agreement.id}`,
			communityId: this.communityId,
			kind: "network.capability_agreement_revoked",
			actor: this.localIdentity,
			subject: agreement.id,
			nonce: `network:noop:${agreement.id}`,
			createdAt: this.now(),
			payload: { agreement: structuredClone(agreement), reason: agreement.revokedReason ?? reason, actorId: agreement.revokedBy ?? actorId },
		}) }
		agreement.status = "revoked"
		agreement.revokedAt = this.now()
		agreement.revokedReason = required(reason, "reason")
		agreement.revokedBy = required(actorId, "actorId")
		return this.mutate("network.capability_agreement_revoked", agreement.id, { agreement: structuredClone(agreement), reason: agreement.revokedReason, actorId: agreement.revokedBy }, agreement)
	}

	recordDelivery(input: Omit<NetworkDeliveryProjection, "updatedAt">): NetworkMutation<NetworkDeliveryProjection> {
		const awarded = this.getAwardedBid(input.bidId)
		if (!awarded || awarded.proposal.id !== input.proposalId || awarded.bid.providerId !== input.providerId) throw new Error("delivery does not match an awarded bid")
		const delivery: NetworkDeliveryProjection = { ...structuredClone(input), updatedAt: this.now() }
		this.deliveries.set(delivery.bidId, delivery)
		return this.mutate(`network.delivery_${delivery.status === "pending_delivery" ? "pending" : delivery.status}`, delivery.bidId, { delivery }, delivery)
	}

	snapshot(): NetworkSnapshot {
		return {
			communityId: this.communityId,
			mode: "local-sandbox",
			peers: this.directory.query({ includeBlocked: true }),
			capabilityDirectory: this.discoverCapabilities({ includeBlocked: true }),
			offers: [...this.offers.values()].map((offer) => structuredClone(offer)),
			proposals: [...this.proposals.values()].map((proposal) => structuredClone(proposal)),
			bids: [...this.bids.values()].map((bid) => structuredClone(bid)),
			capabilityAgreements: [...this.capabilityAgreements.values()].map((agreement) => structuredClone(this.projectCapabilityAgreement(agreement))),
			deliveries: [...this.deliveries.values()].map((delivery) => structuredClone(delivery)),
			trustRoots: this.trustRoots?.().map((root) => structuredClone(root)) ?? [],
			authorityRevocations: [...this.authorityRevocations.values()].sort((left, right) => left.authorityId.localeCompare(right.authorityId) || left.sequence - right.sequence).map((record) => structuredClone(record)),
		}
	}

	applyAuthorityRevocation(record: RelayRevocationRecord): NetworkMutation<RelayRevocationRecord> | undefined {
		const key = `${record.authorityId}:${record.sequence}`
		if (this.authorityRevocations.has(key)) return undefined
		if (!record.authorityId.trim() || !Number.isInteger(record.sequence) || record.sequence <= 0 || !record.identifier.trim() || !Number.isFinite(Date.parse(record.revokedAt))) throw new Error("authority revocation record is invalid")
		return this.mutate("network.authority_revocation_applied", key, { record: structuredClone(record) }, record)
	}

	discoverCapabilities(query: PeerQuery = {}): NetworkCapabilityDiscovery[] {
		return this.directory.query(query).flatMap((peer) => peer.capabilities.map((capability) => ({
			peerId: peer.identity.id,
			identity: structuredClone(peer.identity),
			trust: peer.trust,
			agentCardStatus: peer.agentCardStatus,
			capability: structuredClone(capability),
		})))
	}

	private assertTrusted(peerId: string): void {
		const peer = this.directory.get(peerId)
		if (!peer || !["known", "trusted"].includes(peer.trust)) throw new Error("peer trust must be known or trusted")
		if (peer.agentCard && peer.agentCardStatus !== "verified") throw new Error("peer Agent Card must be verified")
	}

	private peerCapability(peerId: string, capabilityId: string): BuddyCapability | undefined {
		return this.directory.get(peerId)?.capabilities.find((capability) => capability.id === capabilityId)
	}

	private capabilityForProvider(providerId: string, capabilityId: string): BuddyCapability | undefined {
		return providerId === this.localIdentity.id
			? this.localCapabilities.find((capability) => capability.id === capabilityId)
			: this.peerCapability(providerId, capabilityId)
	}

	private projectCapabilityAgreement(agreement: NetworkCapabilityAgreement): NetworkCapabilityAgreement {
		if (agreement.status === "accepted" && agreement.expiresAt <= this.now()) return { ...structuredClone(agreement), status: "expired" }
		return structuredClone(agreement)
	}

	private revokeAgreementsForPeer(peerId: string, reason: string): void {
		for (const agreement of this.capabilityAgreements.values()) {
			if (agreement.status === "accepted" && (agreement.requesterId === peerId || agreement.providerId === peerId)) this.revokeCapabilityAgreement(agreement.id, reason)
		}
	}

	private buildCapabilityAgreement(input: { offerId: string; proposalId: string; providerId: string }, id: string): NetworkCapabilityAgreement {
		if (input.providerId !== this.localIdentity.id) this.assertTrusted(input.providerId)
		const offer = this.offers.get(input.offerId)
		const proposal = this.proposals.get(input.proposalId)
		if (!offer || !proposal || offer.providerId !== input.providerId || offer.capabilityId !== proposal.capabilityId) throw new Error("capability agreement does not match an active offer and proposal")
		if (offer.validUntil <= this.now() || proposal.status !== "open" || proposal.expiresAt <= this.now()) throw new Error("proposal or offer is not active")
		const capability = this.capabilityForProvider(input.providerId, proposal.capabilityId)
		if (!capability) throw new Error("provider capability is unavailable")
		const dataScopes = proposal.dataScopes.filter((scope) => offer.acceptedDataScopes.some((accepted) => matchesDataScope(accepted, scope)) && capability.allowedDataScopes.some((allowed) => matchesDataScope(allowed, scope)) && !capability.forbiddenDataScopes.some((forbidden) => matchesDataScope(forbidden, scope)))
		if (dataScopes.length !== proposal.dataScopes.length) throw new Error("capability agreement cannot satisfy the requested data scopes")
		const requestedActions = proposal.allowedActions ?? capability.allowedActions
		const allowedActions = requestedActions.filter((action) => capability.allowedActions.includes(action) && !capability.forbiddenActions.includes(action))
		if (allowedActions.length !== requestedActions.length) throw new Error("capability agreement cannot satisfy the requested actions")
		const artifactTypes = proposal.artifactTypes.filter((artifactType) => offer.acceptedArtifactTypes.includes(artifactType))
		if (artifactTypes.length !== proposal.artifactTypes.length) throw new Error("capability agreement cannot satisfy the requested artifact types")
		const approval = strongestApproval([capability.requiredApproval, offer.approval])
		return { id, requesterId: this.localIdentity.id, providerId: input.providerId, proposalId: proposal.id, capabilityId: proposal.capabilityId, dataScopes: unique(dataScopes), allowedActions: unique(allowedActions), artifactTypes: unique(artifactTypes), approval, expiresAt: new Date(Math.min(Date.parse(offer.validUntil), Date.parse(proposal.expiresAt))).toISOString(), status: "accepted" }
	}

	private assertAgentCard(card: BuddyAgentCard, identity: BuddyIdentity, capabilities: BuddyCapability[]): PeerRecord["agentCardStatus"] {
		if (card.protocol !== "agent-card/1" || card.identity.id !== identity.id || card.communityId !== this.communityId) throw new Error("agent card identity or community does not match")
		if (Date.parse(card.expiresAt) <= Date.parse(this.now()) || Date.parse(card.issuedAt) > Date.parse(card.expiresAt)) throw new Error("agent card is expired or invalid")
		const advertised = new Set(card.capabilities.map((capability) => capability.id))
		if (capabilities.some((capability) => !advertised.has(capability.id))) throw new Error("agent card omits an advertised capability")
		if (!card.signature?.keyRef || !card.signature.value) return "unverified"
		if (!this.verifyAgentCard) return "unverified"
		return this.verifyAgentCard(card) ? "verified" : "unverified"
	}

	private replayedAgentCardStatus(card: BuddyAgentCard, identity: BuddyIdentity, capabilities: BuddyCapability[]): PeerRecord["agentCardStatus"] {
		try {
			return this.assertAgentCard(card, identity, capabilities)
		} catch {
			return "unverified"
		}
	}

	private assertCapabilityScopes(capability: BuddyCapability, scopes: readonly string[]): void {
		if (scopes.some((scope) => capability.forbiddenDataScopes.some((forbidden) => matchesDataScope(forbidden, scope)) || !capability.allowedDataScopes.some((allowed) => matchesDataScope(allowed, scope)))) throw new Error("offer requests data outside the advertised capability")
	}

	private assertPublicNetworkScopes(scopes: readonly string[]): void {
		if (scopes.some((scope) => scope.startsWith("private:") || scope.startsWith("credential:") || scope.startsWith("secret:"))) throw new Error("private or credential scopes cannot cross the open network")
	}

	private maxSequenceFromEvents(): number {
		return Math.max(0, ...[...this.appliedEventIds].map((id) => Number(id.match(/^network-event-(\d+)$/u)?.[1] ?? 0)))
	}

	private mutate<T>(kind: string, subject: string, payload: Record<string, unknown>, value: T): NetworkMutation<T> {
		const event = createEvent({
			id: `network-event-${++this.sequence}`,
			communityId: this.communityId,
			kind,
			actor: this.localIdentity,
			subject,
			nonce: `network:${kind}:${this.sequence}`,
			createdAt: this.now(),
			payload,
		})
		this.apply(event)
		this.emit?.(structuredClone(event))
		return { value: structuredClone(value), event }
	}

	private apply(event: BuddyEvent): void {
		if (this.appliedEventIds.has(event.id) || event.communityId !== this.communityId) return
		this.appliedEventIds.add(event.id)
		this.sequence = Math.max(this.sequence, Number(event.id.match(/^network-event-(\d+)$/u)?.[1] ?? 0))
		const payload = event.payload as Record<string, unknown>
		if (event.kind === "peer.discovered" && payload.identity && typeof payload.identity === "object" && Array.isArray(payload.capabilities)) {
			const identity = payload.identity as BuddyIdentity
			const capabilities = payload.capabilities as BuddyCapability[]
			const agentCard = payload.agentCard as BuddyAgentCard | undefined
			const agentCardStatus = agentCard ? this.replayedAgentCardStatus(agentCard, identity, capabilities) : "missing"
			const peer = this.directory.register({ identity, capabilities, now: event.createdAt, agentCard, agentCardStatus })
			if (payload.trust && payload.trust !== peer.trust) this.directory.setTrust(identity.id, payload.trust as PeerTrust, event.createdAt)
		}
		if (event.kind === "peer.trust_changed" && typeof payload.peerId === "string" && typeof payload.trust === "string" && this.directory.get(payload.peerId)) this.directory.setTrust(payload.peerId, payload.trust as PeerTrust, event.createdAt)
		if (event.kind === "peer.presence_changed" && typeof payload.peerId === "string" && this.directory.get(payload.peerId)) this.directory.setPresence(payload.peerId, payload.presence && typeof payload.presence === "object" ? payload.presence as PresenceLease : undefined)
		if (event.kind === "network.offer_published" && payload.offer && typeof payload.offer === "object") this.offers.set(String((payload.offer as ServiceOffer).id), structuredClone(payload.offer as ServiceOffer))
		if (event.kind === "network.proposal_created" && payload.proposal && typeof payload.proposal === "object") this.proposals.set(String((payload.proposal as ServiceProposal).id), structuredClone(payload.proposal as ServiceProposal))
		if (event.kind === "network.bid_submitted" && payload.bid && typeof payload.bid === "object") this.bids.set(String((payload.bid as ServiceBid).id), structuredClone(payload.bid as ServiceBid))
		if ((event.kind === "network.capability_agreement_created" || event.kind === "network.bid_submitted") && payload.agreement && typeof payload.agreement === "object") this.capabilityAgreements.set(String((payload.agreement as NetworkCapabilityAgreement).id), structuredClone(payload.agreement as NetworkCapabilityAgreement))
		if (event.kind === "network.capability_agreement_revoked" && payload.agreement && typeof payload.agreement === "object") this.capabilityAgreements.set(String((payload.agreement as NetworkCapabilityAgreement).id), structuredClone(payload.agreement as NetworkCapabilityAgreement))
		if (event.kind === "network.authority_revocation_applied" && payload.record && typeof payload.record === "object") {
			const record = payload.record as RelayRevocationRecord
			if (record.authorityId && Number.isInteger(record.sequence) && record.sequence > 0 && record.identifier) this.authorityRevocations.set(`${record.authorityId}:${record.sequence}`, structuredClone(record))
		}
		if (event.kind === "network.bid_awarded" && payload.bid && payload.proposal && typeof payload.bid === "object" && typeof payload.proposal === "object") {
			this.bids.set(String((payload.bid as ServiceBid).id), structuredClone(payload.bid as ServiceBid))
			this.proposals.set(String((payload.proposal as ServiceProposal).id), structuredClone(payload.proposal as ServiceProposal))
		}
		if (["network.delivery_pending", "network.delivery_delivered", "network.delivery_failed"].includes(event.kind) && payload.delivery && typeof payload.delivery === "object") {
			const delivery = payload.delivery as NetworkDeliveryProjection
			this.deliveries.set(String(delivery.bidId), structuredClone(delivery))
		}
	}
}
