import {
	createEvent,
	stableDigest,
	type BuddyEvent,
	type BuddyIdentity,
	type BuddyScope,
	type BuddyTaskEnvelope,
	type EventQueryScope,
	type FederatedRoomGrant,
} from "@openbuddy/collaboration-protocol"
import { PresenceLeaseRegistry, type BuddyRelayConnectionStatus, type BuddyRelayPort, type LocalRelayEndpoint, type PresenceLease, type RelayDeliveryContext } from "./index"
import type { RelayPresenceRecord, RelayPresenceStatus, RelayRevocationKind, RelayRevocationRecord, RemoteRelayDeliveryRecord, RemoteRelayPersistence, RelaySyncCursor, RelaySyncCursorStore } from "./durable-relay"
import type { RelayEncryptedDeliveryRecord, RelayEnvelopeCodec } from "./relay-envelope"
import { verifyEd25519RelayDirectoryCard, verifyEd25519RelayRevocation, type FederatedRoomGrantExpectation, type RelayCapabilityExpectation, type RelayDirectoryPublicKeyResolver, type RelayRevocationPublicKeyResolver } from "./relay-auth"

export type { RelayPresenceRecord, RelayPresenceStatus, RelayRevocationKind, RelayRevocationRecord } from "./durable-relay"

export interface RemoteRelayCredential {
	subject: string
	token: string
	issuedAt?: string
	expiresAt: string
	audience?: string
	nonce?: string
	revokedAt?: string
	signature?: {
		algorithm: "HS256" | "Ed25519"
		keyRef: string
		value: string
	}
}

export type RemoteRelayEndpoint = LocalRelayEndpoint

export type RemoteRelayRequest =
	| {
		kind: "endpoint.register"
		requestId: string
		credential: RemoteRelayCredential
		identity: BuddyIdentity
		scope: BuddyScope
		grant?: FederatedRoomGrant
		lease?: PresenceLease
	}
	| {
		kind: "task.send"
		requestId: string
		credential: RemoteRelayCredential
		envelope: BuddyTaskEnvelope
		scope: BuddyScope
		grant?: FederatedRoomGrant
	}
	| {
		kind: "events.query"
		requestId: string
		credential: RemoteRelayCredential
		scope: EventQueryScope
		grant?: FederatedRoomGrant
	}
	| {
		kind: "directory.publish"
		requestId: string
		credential: RemoteRelayCredential
		card: RelayDirectoryCard
	}
	| {
		kind: "directory.query"
		requestId: string
		credential: RemoteRelayCredential
		communityId: string
		capabilityId?: string
	}
	| {
		kind: "revocations.query"
		requestId: string
		credential: RemoteRelayCredential
		sinceSequence?: number
	}
	| {
		kind: "revocations.apply"
		requestId: string
		credential: RemoteRelayCredential
		revocations: RelayRevocationRecord[]
	}
	| {
		kind: "revocations.revoke"
		requestId: string
		credential: RemoteRelayCredential
		grantId: string
	}
	| {
		kind: "presence.query"
		requestId: string
		credential: RemoteRelayCredential
		sinceSequence?: number
	}
	| {
		kind: "presence.apply"
		requestId: string
		credential: RemoteRelayCredential
		presences: RelayPresenceRecord[]
	}

export interface RemoteRelayResponse {
	requestId: string
	ok: boolean
	duplicate?: boolean
	events?: BuddyEvent[]
	directory?: RelayDirectoryCard[]
	revocations?: RelayRevocationRecord[]
	appliedRevocations?: number
	revocation?: RelayRevocationRecord
	appliedPresences?: number
	nextRevocationSequence?: number
	presences?: RelayPresenceRecord[]
	nextPresenceSequence?: number
		error?: { code: string; message: string }
}

export interface RemoteRelayWire {
	readonly status?: Exclude<BuddyRelayConnectionStatus, "local">
	request(request: RemoteRelayRequest): Promise<RemoteRelayResponse>
	subscribe(request: {
		requestId: string
		credential: RemoteRelayCredential
		scope: EventQueryScope
		sinceEventId?: string
		grant?: FederatedRoomGrant
	}, handler: (event: BuddyEvent) => void): () => void
	registerEndpoint(request: Extract<RemoteRelayRequest, { kind: "endpoint.register" }>, endpoint: RemoteRelayEndpoint): Promise<() => void> | (() => void)
	close(): void
}

export interface RelaySyncResult {
	changed: number
	cursor: RelaySyncCursor
	revocations: RelayRevocationRecord[]
	presences: RelayPresenceRecord[]
}

export interface RelaySyncOptions {
	applyToRelay?: boolean
	persistCursor?: boolean
}

export interface RelayDirectoryCard {
	identity: Pick<BuddyIdentity, "id" | "handle" | "displayName" | "organizationId" | "publicKeyRef" | "trustLevel" | "status">
	communityId: string
	capabilities: Array<{ id: string; description: string; allowedDataScopes: string[]; allowedActions: string[]; acceptedArtifactTypes: string[]; approval: "never" | "before_external_commit" | "always" }>
	agentCard?: { protocol: "agent-card/1"; keyRef?: string; digest: string; issuedAt: string; expiresAt: string }
	updatedAt: string
	signature?: { algorithm: "Ed25519"; keyRef: string; value: string }
}

export interface RemoteRelayServerOptions {
	now?: () => string
	persistence?: RemoteRelayPersistence
	authorize?: (credential: RemoteRelayCredential, operation: RemoteRelayRequest["kind"]) => void
	verifyCredential?: (credential: RemoteRelayCredential, operation: RemoteRelayRequest["kind"]) => void
	verifyCapability?: (token: string, expected: RelayCapabilityExpectation) => void
	verifyRoomGrant?: (grant: FederatedRoomGrant, expected: FederatedRoomGrantExpectation) => void
	envelopeCodec?: RelayEnvelopeCodec
	authorizeScope?: (credential: RemoteRelayCredential, scope: BuddyScope | EventQueryScope, operation: RemoteRelayRequest["kind"]) => void
	/** Test-only escape hatch for an explicitly in-memory, non-production relay. */
	allowInsecureLocal?: boolean
	revocationAuthorityId?: string
	signRevocation?: (record: RelayRevocationRecord) => RelayRevocationRecord
	verifyRevocation?: (record: RelayRevocationRecord) => void
	revocationPublicKeyResolver?: RelayRevocationPublicKeyResolver
	authorizeRevocation?: (credential: RemoteRelayCredential) => void
	presenceAuthorityId?: string
	authorizePresence?: (credential: RemoteRelayCredential) => void
	verifyPresence?: (record: RelayPresenceRecord) => void
	directoryPublicKeyResolver?: RelayDirectoryPublicKeyResolver
}

function scopeKey(scope: EventQueryScope): string {
	return `${scope.communityId ?? "_"}:${scope.organizationId ?? "_"}:${scope.roomId ?? "_"}`
}

function matchesScope(event: BuddyEvent, scope: EventQueryScope): boolean {
	return (!scope.communityId || event.communityId === scope.communityId)
		&& (!scope.organizationId || event.organizationId === scope.organizationId)
		&& (!scope.roomId || event.roomId === scope.roomId)
		&& (!scope.taskId || event.taskId === scope.taskId)
}

function requestId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function eventSequence(eventId: string): number {
	return Number(eventId.match(/remote-relay-event-(\d+)$/u)?.[1] ?? 0)
}

function scopeEquals(left: BuddyScope, right: BuddyScope): boolean {
	return left.communityId === right.communityId
		&& left.organizationId === right.organizationId
		&& left.roomId === right.roomId
}

/**
 * A process-independent relay seam. The in-memory implementation is useful
 * for integration tests and local development; a WebSocket adapter can
 * implement RemoteRelayWire without changing RemoteRelayTransport.
 */
export class RemoteRelayServer {
	private readonly events: BuddyEvent[] = []
	private readonly directory = new Map<string, RelayDirectoryCard>()
	private readonly endpoints = new Map<string, RemoteRelayEndpoint>()
	private readonly deliveredMessages = new Set<string>()
	private readonly subscribers = new Map<string, Set<(event: BuddyEvent) => void>>()
	private readonly revokedCredentialDigests = new Set<string>()
	private readonly now: () => string
	private readonly authorize?: RemoteRelayServerOptions["authorize"]
	private readonly verifyCredential?: RemoteRelayServerOptions["verifyCredential"]
	private readonly verifyCapability?: RemoteRelayServerOptions["verifyCapability"]
	private readonly verifyRoomGrant?: RemoteRelayServerOptions["verifyRoomGrant"]
	private readonly envelopeCodec?: RelayEnvelopeCodec
	private readonly authorizeScope?: RemoteRelayServerOptions["authorizeScope"]
	private readonly allowInsecureLocal: boolean
	private readonly persistence?: RemoteRelayPersistence
	private readonly deliveries = new Map<string, RemoteRelayDeliveryRecord>()
	private readonly pendingEnvelopes = new Map<string, { envelope: BuddyTaskEnvelope; scope: BuddyScope; grant?: FederatedRoomGrant }>()
	private readonly endpointGrants = new Map<string, FederatedRoomGrant | undefined>()
	private readonly deliveryRuns = new Map<string, Promise<void>>()
	private readonly presence = new PresenceLeaseRegistry(() => this.now())
	private readonly revokedCapabilityDigests = new Set<string>()
	private readonly revokedRoomGrants = new Set<string>()
	private readonly replayNonces = new Map<string, { messageId: string; expiresAt: string }>()
	private readonly revocations = new Map<string, RelayRevocationRecord>()
	private readonly revocationAuthorityId: string
	private readonly signRevocation?: RemoteRelayServerOptions["signRevocation"]
	private readonly verifyRevocation?: RemoteRelayServerOptions["verifyRevocation"]
	private readonly authorizeRevocation?: RemoteRelayServerOptions["authorizeRevocation"]
	private readonly presenceAuthorityId: string
	private readonly authorizePresence?: RemoteRelayServerOptions["authorizePresence"]
	private readonly verifyPresence?: RemoteRelayServerOptions["verifyPresence"]
	private readonly directoryPublicKeyResolver?: RelayDirectoryPublicKeyResolver
	private revocationSequence = 0
	private presenceSequence = 0
	private readonly presences = new Map<string, RelayPresenceRecord>()
	private sequence = 0
	private writeChain: Promise<void> = Promise.resolve()

	constructor(options: RemoteRelayServerOptions = {}) {
		this.now = options.now ?? (() => new Date().toISOString())
		this.authorize = options.authorize
		this.verifyCredential = options.verifyCredential
		this.verifyCapability = options.verifyCapability
		this.verifyRoomGrant = options.verifyRoomGrant
		this.envelopeCodec = options.envelopeCodec
		this.authorizeScope = options.authorizeScope
		this.allowInsecureLocal = options.allowInsecureLocal ?? false
		this.persistence = options.persistence
		const restored = this.persistence?.load()
		this.revocationAuthorityId = options.revocationAuthorityId ?? restored?.revocationAuthorityId ?? "relay-local"
		this.signRevocation = options.signRevocation
		this.verifyRevocation = options.verifyRevocation ?? (options.revocationPublicKeyResolver ? (record) => {
			verifyEd25519RelayRevocation(record, options.revocationPublicKeyResolver!, this.now())
		} : undefined)
		this.authorizeRevocation = options.authorizeRevocation
		this.presenceAuthorityId = options.presenceAuthorityId ?? restored?.presenceAuthorityId ?? "relay-local"
		this.authorizePresence = options.authorizePresence
		this.verifyPresence = options.verifyPresence
		this.directoryPublicKeyResolver = options.directoryPublicKeyResolver
		if (restored) {
			this.events.push(...restored.events.map((event) => structuredClone(event)))
			for (const messageId of restored.deliveredMessageIds) this.deliveredMessages.add(messageId)
			for (const digest of restored.revokedCredentialDigests ?? []) this.revokedCredentialDigests.add(digest)
			for (const digest of restored.revokedCapabilityDigests ?? []) this.revokedCapabilityDigests.add(digest)
			for (const grantId of restored.revokedRoomGrantIds ?? []) this.revokedRoomGrants.add(grantId)
			for (const record of restored.revocations ?? []) this.applyRevocationRecord(record)
			for (const record of restored.presences ?? []) this.applyPresenceRecord(record)
			for (const card of restored.directory ?? []) this.directory.set(`${card.communityId}:${card.identity.id}`, structuredClone(card))
			this.revocationSequence = Math.max(restored.revocationSequence ?? 0, ...[...this.revocations.values()].filter((record) => record.authorityId === this.revocationAuthorityId).map((record) => record.sequence))
			this.presenceSequence = Math.max(restored.presenceSequence ?? 0, ...[...this.presences.values()].filter((record) => record.authorityId === this.presenceAuthorityId).map((record) => record.sequence))
			this.sequence = Math.max(restored.sequence, ...this.events.map((event) => eventSequence(event.id)))
			for (const delivery of restored.deliveries ?? []) this.deliveries.set(delivery.messageId, structuredClone(delivery))
			for (const entry of restored.replayNonces ?? []) this.replayNonces.set(entry.key, { messageId: entry.messageId, expiresAt: entry.expiresAt })
			for (const record of restored.encryptedDeliveries ?? []) {
				if (!this.envelopeCodec) continue
				try {
					const decoded = this.envelopeCodec.decrypt(record)
					this.pendingEnvelopes.set(record.messageId, decoded)
				} catch {
					this.recordDelivery(record.messageId, record.recipientId, "failed", "relay encrypted delivery could not be restored")
				}
			}
		}
	}

	revoke(token: string): void {
		if (token.trim()) {
			this.appendRevocation("credential", stableDigest(token))
		}
	}

	revokeCapability(token: string): void {
		if (token.trim()) {
			this.appendRevocation("capability", stableDigest(token))
		}
	}

	revokeRoomGrant(grantId: string): RelayRevocationRecord | undefined {
		if (!grantId.trim()) return undefined
		return this.appendRevocation("room-grant", grantId)
	}

	exportRevocations(sinceSequence = 0): RelayRevocationRecord[] {
		return [...this.revocations.values()]
			.filter((record) => record.authorityId === this.revocationAuthorityId && record.sequence > Math.max(0, Math.floor(sinceSequence)))
			.sort((left, right) => left.sequence - right.sequence)
			.map((record) => structuredClone(record))
	}

	exportPresences(sinceSequence = 0): RelayPresenceRecord[] {
		this.expirePresenceRecords()
		return [...this.presences.values()]
			.filter((record) => record.authorityId === this.presenceAuthorityId && record.sequence > Math.max(0, Math.floor(sinceSequence)))
			.sort((left, right) => left.sequence - right.sequence)
			.map((record) => structuredClone(record))
	}

	applyRevocations(records: readonly RelayRevocationRecord[]): number {
		let applied = 0
		for (const record of records) {
			if (this.verifyRevocation) this.verifyRevocation(record)
			else if (!this.allowInsecureLocal) throw new Error("relay revocation verifier is required")
			if (!("credential" === record.kind || "capability" === record.kind || "room-grant" === record.kind) || !record.authorityId.trim() || !Number.isInteger(record.sequence) || record.sequence <= 0 || !record.identifier.trim() || !Number.isFinite(Date.parse(record.revokedAt))) throw new Error("relay revocation record is invalid")
			const key = `${record.authorityId}:${record.sequence}`
			const existing = this.revocations.get(key)
			if (existing) {
				if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error("relay revocation sequence conflict")
				continue
			}
			this.applyRevocationRecord(record)
			if (record.authorityId === this.revocationAuthorityId) this.revocationSequence = Math.max(this.revocationSequence, record.sequence)
			applied += 1
		}
		if (applied > 0) this.persist()
		return applied
	}

	applyPresences(records: readonly RelayPresenceRecord[]): number {
		let applied = 0
		for (const record of records) {
			this.validatePresenceRecord(record)
			if (this.verifyPresence) this.verifyPresence(structuredClone(record))
			else if (!this.allowInsecureLocal) throw new Error("relay presence verifier is required")
			const key = `${record.authorityId}:${record.sequence}`
			const existing = this.presences.get(key)
			if (existing) {
				if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error("relay presence sequence conflict")
				continue
			}
			this.applyPresenceRecord(record)
			if (record.authorityId === this.presenceAuthorityId) this.presenceSequence = Math.max(this.presenceSequence, record.sequence)
			applied += 1
		}
		if (applied > 0) this.persist()
		return applied
	}

	private validatePresenceRecord(record: RelayPresenceRecord): void {
		const lease = record.lease
		if (!record.authorityId.trim() || !Number.isInteger(record.sequence) || record.sequence <= 0 || !["active", "expired", "revoked"].includes(record.status) || !Number.isFinite(Date.parse(record.updatedAt)) || !lease?.leaseId?.trim() || !lease.identityId?.trim() || !lease.communityId?.trim() || !Number.isFinite(Date.parse(lease.issuedAt)) || !Number.isFinite(Date.parse(lease.expiresAt)) || Date.parse(lease.expiresAt) <= Date.parse(lease.issuedAt)) throw new Error("relay presence record is invalid")
	}

	private appendPresence(lease: PresenceLease, status: RelayPresenceStatus): void {
		const record = { authorityId: this.presenceAuthorityId, sequence: ++this.presenceSequence, lease: structuredClone(lease), status, updatedAt: this.now() } satisfies RelayPresenceRecord
		this.applyPresenceRecord(record)
		this.persist()
	}

	private applyPresenceRecord(record: RelayPresenceRecord): void {
		this.validatePresenceRecord(record)
		const key = `${record.authorityId}:${record.sequence}`
		if (this.presences.has(key)) return
		this.presences.set(key, structuredClone(record))
		if (record.status === "active" && Date.parse(record.lease.expiresAt) > Date.parse(this.now())) this.presence.register(record.lease)
		else this.presence.revoke(record.lease.leaseId)
	}

	private expirePresenceRecords(): void {
		const now = Date.parse(this.now())
		for (const record of [...this.presences.values()].filter((candidate) => candidate.authorityId === this.presenceAuthorityId && candidate.status === "active" && Date.parse(candidate.lease.expiresAt) <= now)) {
			this.presence.revoke(record.lease.leaseId)
			this.appendPresence(record.lease, "expired")
		}
	}

	private appendRevocation(kind: RelayRevocationKind, identifier: string): RelayRevocationRecord {
		const existing = [...this.revocations.values()].find((record) => record.authorityId === this.revocationAuthorityId && record.kind === kind && record.identifier === identifier)
		if (existing) return structuredClone(existing)
		this.revocationSequence += 1
		const record = { authorityId: this.revocationAuthorityId, sequence: this.revocationSequence, kind, identifier, revokedAt: this.now() } satisfies RelayRevocationRecord
		this.applyRevocationRecord(this.signRevocation ? this.signRevocation(record) : record)
		this.persist()
		return structuredClone(this.revocations.get(`${record.authorityId}:${record.sequence}`) ?? record)
	}

	private applyRevocationRecord(record: RelayRevocationRecord): void {
		const key = `${record.authorityId}:${record.sequence}`
		if (this.revocations.has(key)) return
		this.revocations.set(key, structuredClone(record))
		if (record.kind === "credential") this.revokedCredentialDigests.add(record.identifier)
		if (record.kind === "capability") this.revokedCapabilityDigests.add(record.identifier)
		if (record.kind === "room-grant") {
			this.revokedRoomGrants.add(record.identifier)
			for (const [identityId, grant] of this.endpointGrants) if (grant?.grantId === record.identifier) this.endpointGrants.delete(identityId)
		}
	}

	connect(credential: RemoteRelayCredential): RemoteRelayWire {
		const assertCredential = (operation: RemoteRelayRequest["kind"]): void => {
			const expiresAt = Date.parse(credential.expiresAt)
			if (!credential.subject.trim() || !credential.token.trim() || !Number.isFinite(expiresAt)) throw new Error("relay credential is invalid")
			if (this.revokedCredentialDigests.has(stableDigest(credential.token)) || credential.revokedAt) throw new Error("relay credential is revoked")
			if (expiresAt <= Date.parse(this.now())) throw new Error("relay credential is expired")
			this.verifyCredential?.(structuredClone(credential), operation)
			if (this.authorize) this.authorize(structuredClone(credential), operation)
			else if (!this.verifyCredential && !this.allowInsecureLocal) throw new Error("relay credential verifier is required")
		}
		const assertScope = (scope: BuddyScope | EventQueryScope, operation: RemoteRelayRequest["kind"]): void => {
			if (!scope.communityId) throw new Error("relay scope requires communityId")
			this.authorizeScope?.(structuredClone(credential), structuredClone(scope), operation)
		}
		const assertGrant = (grant: FederatedRoomGrant | undefined, scope: BuddyScope | EventQueryScope, operation: RemoteRelayRequest["kind"], input: { principalOrganizationId?: string; taskId?: string; capability?: string; dataScopes?: string[]; allowedActions?: string[] } = {}): void => {
			if (!scope.roomId?.startsWith("project-")) return
			if (!grant) throw new Error("federated room grant is required for project room")
			if (this.revokedRoomGrants.has(grant.grantId)) throw new Error("federated room grant is revoked")
			if (!this.verifyRoomGrant) throw new Error("federated room grant verifier is required")
			if (operation === "endpoint.register" || operation === "task.send" || operation === "events.query") this.verifyRoomGrant(grant, { principalId: credential.subject, scope, operation, ...input })
		}
		const assertRequestCredential = (request: RemoteRelayRequest): void => {
			if (JSON.stringify(request.credential) !== JSON.stringify(credential)) throw new Error("relay credential does not match connection")
			assertCredential(request.kind)
		}
		const request = async (input: RemoteRelayRequest): Promise<RemoteRelayResponse> => {
			try {
				assertRequestCredential(input)
				if (input.kind === "directory.publish") {
					if (input.card.identity.id !== credential.subject) throw new Error("directory identity does not match relay credential")
					if (input.card.communityId.trim() === "" || input.card.capabilities.some((capability) => !capability.id.trim() || capability.allowedDataScopes.some((scope) => scope.startsWith("private:") || scope.startsWith("credential:") || scope.startsWith("secret:")))) throw new Error("directory card contains private or invalid capability data")
					if (!this.allowInsecureLocal) {
						if (!this.directoryPublicKeyResolver) throw new Error("directory card verifier is required")
						verifyEd25519RelayDirectoryCard(input.card, this.directoryPublicKeyResolver, this.now())
					}
					this.directory.set(`${input.card.communityId}:${input.card.identity.id}`, structuredClone(input.card))
					this.persist()
					return { requestId: input.requestId, ok: true }
				}
				if (input.kind === "directory.query") {
					if (!input.communityId.trim()) throw new Error("directory query requires communityId")
					const directory = [...this.directory.values()].filter((card) => card.communityId === input.communityId && (!input.capabilityId || card.capabilities.some((capability) => capability.id === input.capabilityId)) && (!card.agentCard || Date.parse(card.agentCard.expiresAt) > Date.parse(this.now()))).map((card) => structuredClone(card))
					return { requestId: input.requestId, ok: true, directory }
				}
				if (input.kind === "revocations.query") {
					return { requestId: input.requestId, ok: true, revocations: this.exportRevocations(input.sinceSequence), nextRevocationSequence: this.revocationSequence }
				}
				if (input.kind === "presence.query") {
					return { requestId: input.requestId, ok: true, presences: this.exportPresences(input.sinceSequence), nextPresenceSequence: this.presenceSequence }
				}
				if (input.kind === "presence.apply") {
					if (this.authorizePresence) this.authorizePresence(structuredClone(credential))
					else if (!this.allowInsecureLocal) throw new Error("relay presence authority authorization is required")
					return { requestId: input.requestId, ok: true, appliedPresences: this.applyPresences(input.presences), nextPresenceSequence: this.presenceSequence }
				}
				if (input.kind === "revocations.apply") {
					if (this.authorizeRevocation) this.authorizeRevocation(structuredClone(credential))
					else if (!this.allowInsecureLocal) throw new Error("relay revocation authority authorization is required")
					return { requestId: input.requestId, ok: true, appliedRevocations: this.applyRevocations(input.revocations), nextRevocationSequence: this.revocationSequence }
				}
				if (input.kind === "revocations.revoke") {
					if (this.authorizeRevocation) this.authorizeRevocation(structuredClone(credential))
					else if (!this.allowInsecureLocal) throw new Error("relay revocation authority authorization is required")
					return { requestId: input.requestId, ok: true, revocation: this.revokeRoomGrant(input.grantId), nextRevocationSequence: this.revocationSequence }
				}
				if (input.kind === "endpoint.register") {
					assertScope(input.scope, input.kind)
					assertGrant(input.grant, input.scope, input.kind, { principalOrganizationId: input.identity.organizationId })
					if (input.identity.id !== credential.subject) throw new Error("endpoint identity does not match relay credential")
					if (!input.scope.communityId || !input.scope.roomId) throw new Error("relay endpoint requires community and room scope")
					if (input.lease) {
						this.presence.register(input.lease)
						if (!this.presence.isActive(input.lease, { identityId: input.identity.id, scope: input.scope })) throw new Error("relay endpoint presence lease is expired or invalid")
					}
					return { requestId: input.requestId, ok: true }
				}
				if (input.kind === "events.query") {
					assertScope(input.scope, input.kind)
					assertGrant(input.grant, input.scope, input.kind, { taskId: input.scope.taskId })
					return { requestId: input.requestId, ok: true, events: this.query(input.scope) }
				}
				if (!input.scope.communityId || !input.scope.roomId || input.envelope.roomRef !== input.scope.roomId) throw new Error("relay requires matching community, room, and task scope")
				assertScope(input.scope, input.kind)
				assertGrant(input.grant, input.scope, input.kind, { principalOrganizationId: input.envelope.sender.organizationId, taskId: input.envelope.taskId, capability: input.envelope.capability, dataScopes: input.envelope.policy.dataScopes, allowedActions: input.envelope.policy.allowedActions })
				if (input.envelope.sender.id !== credential.subject) throw new Error("sender identity does not match relay credential")
				if (Date.parse(input.envelope.expiresAt) <= Date.parse(this.now())) throw new Error("task envelope is expired")
				if (this.verifyCapability) {
					if (!input.envelope.capabilityToken) throw new Error("relay capability token is required")
					if (this.revokedCapabilityDigests.has(stableDigest(input.envelope.capabilityToken))) throw new Error("relay capability token is revoked")
					this.verifyCapability(input.envelope.capabilityToken, {
						subject: credential.subject,
						scope: input.scope,
						taskId: input.envelope.taskId,
						capability: input.envelope.capability,
						dataScopes: input.envelope.policy.dataScopes,
						allowedActions: input.envelope.policy.allowedActions,
					})
				}
				const delivery = this.deliveries.get(input.envelope.messageId)
				if (this.deliveredMessages.has(input.envelope.messageId) || delivery?.status === "delivered") return { requestId: input.requestId, ok: true, duplicate: true }
				const recipientId = input.envelope.recipient?.id
				const endpoint = recipientId ? this.endpoints.get(recipientId) : undefined
				if (endpoint) {
					if (!scopeEquals(endpoint.scope, input.scope) || (input.scope.roomId?.startsWith("project-") && this.endpointGrants.get(recipientId!)?.grantId !== input.grant?.grantId)) throw new Error("relay recipient endpoint is unavailable")
					if (endpoint.lease && !this.presence.isActive(endpoint.lease, { identityId: endpoint.identity.id, scope: endpoint.scope })) throw new Error("relay recipient presence lease is expired")
				}
				this.assertFreshNonce(credential.subject, input.scope, input.envelope.nonce, input.envelope.messageId, input.envelope.expiresAt)
				this.pendingEnvelopes.set(input.envelope.messageId, { envelope: structuredClone(input.envelope), scope: structuredClone(input.scope), ...(input.grant ? { grant: structuredClone(input.grant) } : {}) })
				const existing = this.events.find((candidate) => candidate.payload && typeof candidate.payload === "object" && (candidate.payload as { messageId?: unknown }).messageId === input.envelope.messageId)
				const event = existing ?? createEvent({
					id: `remote-relay-event-${++this.sequence}`,
					communityId: input.scope.communityId,
					organizationId: input.scope.organizationId,
					roomId: input.scope.roomId,
					taskId: input.envelope.taskId,
					kind: input.envelope.messageType,
					actor: input.envelope.sender,
					nonce: input.envelope.nonce,
					createdAt: input.envelope.createdAt,
					subject: input.envelope.capability,
					payload: {
						messageId: input.envelope.messageId,
						traceId: input.envelope.traceId,
						recipientId: input.envelope.recipient?.id,
						capability: input.envelope.capability,
						objectiveDigest: stableDigest(input.envelope.objective),
						contextRefs: input.envelope.input.contextRefs ?? [],
					},
				})
				if (!existing) {
					this.events.push(event)
					this.persist()
					for (const handler of this.subscribers.get(scopeKey(input.scope)) ?? []) handler(structuredClone(event))
				}
				if (recipientId) {
					const endpoint = this.endpoints.get(recipientId)
					if (!endpoint || !scopeEquals(endpoint.scope, input.scope) || (input.scope.roomId?.startsWith("project-") && this.endpointGrants.get(recipientId)?.grantId !== input.grant?.grantId)) {
						this.recordDelivery(input.envelope.messageId, recipientId, "failed", "relay recipient endpoint is unavailable", true)
						return { requestId: input.requestId, ok: false, error: { code: "endpoint_unavailable", message: "relay recipient endpoint is unavailable" } }
					}
					await this.deliver(input.envelope.messageId, endpoint)
				} else {
					this.deliveredMessages.add(input.envelope.messageId)
					this.pendingEnvelopes.delete(input.envelope.messageId)
					this.recordDelivery(input.envelope.messageId, undefined, "delivered")
				}
				return { requestId: input.requestId, ok: true }
			} catch (error) {
				return { requestId: input.requestId, ok: false, error: { code: "relay_rejected", message: error instanceof Error ? error.message : "relay request rejected" } }
			}
		}
		const subscribe = (input: { requestId: string; credential: RemoteRelayCredential; scope: EventQueryScope; sinceEventId?: string; grant?: FederatedRoomGrant }, handler: (event: BuddyEvent) => void): (() => void) => {
			assertRequestCredential({ kind: "events.query", requestId: input.requestId, credential: input.credential, scope: input.scope })
			assertScope(input.scope, "events.query")
			assertGrant(input.grant, input.scope, "events.query", { taskId: input.scope.taskId })
			const key = scopeKey(input.scope)
			const handlers = this.subscribers.get(key) ?? new Set<(event: BuddyEvent) => void>()
			handlers.add(handler)
			this.subscribers.set(key, handlers)
			const since = input.sinceEventId ? eventSequence(input.sinceEventId) : 0
			for (const event of this.events.filter((candidate) => eventSequence(candidate.id) > since && matchesScope(candidate, input.scope))) handler(structuredClone(event))
			return () => {
				handlers.delete(handler)
				if (handlers.size === 0) this.subscribers.delete(key)
			}
		}
		const registerEndpoint = (input: Extract<RemoteRelayRequest, { kind: "endpoint.register" }>, endpoint: RemoteRelayEndpoint): (() => void) => {
			assertRequestCredential(input)
			if (input.identity.id !== endpoint.identity.id || !scopeEquals(input.scope, endpoint.scope)) throw new Error("relay endpoint registration does not match request")
			return this.registerEndpoint(endpoint, { grant: input.grant })
		}
		return { request, subscribe, registerEndpoint, close: () => undefined }
	}

	private persist(): void {
		if (!this.persistence) return
		const savePromise = this.persistence!.save({
			version: 1,
			sequence: this.sequence,
			events: this.events.map((event) => structuredClone(event)),
			deliveredMessageIds: [...this.deliveredMessages],
			revocationAuthorityId: this.revocationAuthorityId,
			revocationSequence: this.revocationSequence,
			revocations: [...this.revocations.values()].map((record) => structuredClone(record)),
			presenceAuthorityId: this.presenceAuthorityId,
			presenceSequence: this.presenceSequence,
			presences: [...this.presences.values()].map((record) => structuredClone(record)),
			directory: [...this.directory.values()].map((card) => structuredClone(card)),
			revokedCredentialDigests: [...this.revokedCredentialDigests],
			revokedCapabilityDigests: [...this.revokedCapabilityDigests],
			revokedRoomGrantIds: [...this.revokedRoomGrants],
			replayNonces: [...this.replayNonces.entries()].map(([key, value]) => ({ key, ...value })),
			deliveries: [...this.deliveries.values()].map((delivery) => structuredClone(delivery)),
			encryptedDeliveries: this.envelopeCodec ? [...this.pendingEnvelopes.entries()].flatMap(([messageId, pending]) => {
				const delivery = this.deliveries.get(messageId)
				if (!delivery || !pending.envelope.recipient?.id) return []
				return [this.envelopeCodec!.encrypt({ deliveryId: delivery.deliveryId, envelope: pending.envelope, scope: pending.scope, grant: pending.grant, updatedAt: delivery.updatedAt })]
			}) : [],
		})
		const write = this.writeChain.then(() => savePromise).catch((error) => {
			console.warn("[openbuddy-network] failed to persist relay state", error)
		})
		this.writeChain = write
	}

	async flush(): Promise<void> {
		await this.writeChain
	}

	private assertFreshNonce(subject: string, scope: BuddyScope, nonce: string, messageId: string, expiresAt: string): void {
		const normalizedNonce = nonce.trim()
		if (!normalizedNonce) throw new Error("task envelope nonce is required")
		const now = Date.parse(this.now())
		for (const [key, entry] of this.replayNonces) {
			if (!Number.isFinite(Date.parse(entry.expiresAt)) || Date.parse(entry.expiresAt) <= now) this.replayNonces.delete(key)
		}
		const key = `${subject}:${scopeKey(scope)}:${normalizedNonce}`
		const existing = this.replayNonces.get(key)
		if (existing) {
			if (existing.messageId !== messageId) throw new Error("task envelope nonce has already been used")
			return
		}
		this.replayNonces.set(key, { messageId, expiresAt })
		this.persist()
	}

	private recordDelivery(messageId: string, recipientId: string | undefined, status: RemoteRelayDeliveryRecord["status"], lastError?: string, incrementAttempt = false): void {
		const current = this.deliveries.get(messageId)
		this.deliveries.set(messageId, {
			deliveryId: current?.deliveryId ?? `relay-delivery-${messageId}`,
			messageId,
			...(recipientId ? { recipientId } : {}),
			status,
			attempts: (current?.attempts ?? 0) + (incrementAttempt ? 1 : 0),
			updatedAt: this.now(),
			...(lastError ? { lastError } : {}),
		})
		this.persist()
	}

	registerEndpoint(endpoint: RemoteRelayEndpoint, options: { replay?: boolean; grant?: FederatedRoomGrant } = {}): () => void {
		this.expirePresenceRecords()
		if (endpoint.lease) {
			this.presence.register(endpoint.lease)
			if (!this.presence.isActive(endpoint.lease, { identityId: endpoint.identity.id, scope: endpoint.scope })) throw new Error("relay endpoint presence lease is expired or invalid")
			this.appendPresence(endpoint.lease, "active")
		}
		this.endpoints.set(endpoint.identity.id, endpoint)
		this.endpointGrants.set(endpoint.identity.id, options.grant ? structuredClone(options.grant) : undefined)
		if (options.replay !== false) this.replayEndpoint(endpoint)
		return () => {
			if (this.endpoints.get(endpoint.identity.id) === endpoint) {
				if (endpoint.lease) this.appendPresence(endpoint.lease, "revoked")
				this.endpoints.delete(endpoint.identity.id)
				this.endpointGrants.delete(endpoint.identity.id)
			}
		}
	}

	replayEndpoint(endpoint: RemoteRelayEndpoint): void {
		queueMicrotask(() => {
			void Promise.all([...this.pendingEnvelopes.entries()]
				.filter(([, pending]) => pending.envelope.recipient?.id === endpoint.identity.id && scopeEquals(pending.scope, endpoint.scope))
				.map(([messageId]) => this.deliver(messageId, endpoint).catch(() => undefined)))
		})
	}

	private deliver(messageId: string, endpoint: RemoteRelayEndpoint): Promise<void> {
		const existing = this.deliveryRuns.get(messageId)
		if (existing) return existing
		const run = (async () => {
			const pending = this.pendingEnvelopes.get(messageId)
			if (!pending) return
			const recipientId = pending.envelope.recipient?.id
			if (!recipientId || recipientId !== endpoint.identity.id || !scopeEquals(endpoint.scope, pending.scope) || (pending.scope.roomId?.startsWith("project-") && this.endpointGrants.get(endpoint.identity.id)?.grantId !== pending.grant?.grantId)) throw new Error("relay recipient endpoint is unavailable")
			if (pending.scope.roomId?.startsWith("project-")) {
				if (!this.verifyRoomGrant || !pending.grant) throw new Error("federated room grant verifier is required")
				this.verifyRoomGrant(pending.grant, { principalId: endpoint.identity.id, principalOrganizationId: endpoint.identity.organizationId, scope: pending.scope, operation: "task.send", taskId: pending.envelope.taskId, capability: pending.envelope.capability, dataScopes: pending.envelope.policy.dataScopes, allowedActions: pending.envelope.policy.allowedActions })
			}
			if (endpoint.lease && !this.presence.isActive(endpoint.lease, { identityId: endpoint.identity.id, scope: endpoint.scope })) throw new Error("relay recipient presence lease is expired")
			this.assertFreshNonce(pending.envelope.sender.id, pending.scope, pending.envelope.nonce, pending.envelope.messageId, pending.envelope.expiresAt)
			const deliveryId = this.deliveries.get(messageId)?.deliveryId ?? `relay-delivery-${messageId}`
			this.recordDelivery(messageId, recipientId, "pending", undefined, true)
			try {
				const context: RelayDeliveryContext = { deliveryId }
				await endpoint.accept(structuredClone(pending.envelope), context)
				this.deliveredMessages.add(messageId)
				this.pendingEnvelopes.delete(messageId)
				this.recordDelivery(messageId, recipientId, "delivered")
			} catch (error) {
				this.recordDelivery(messageId, recipientId, "failed", error instanceof Error ? error.message : "remote endpoint rejected task")
				throw error
			}
		})().finally(() => this.deliveryRuns.delete(messageId))
		this.deliveryRuns.set(messageId, run)
		return run
	}

	query(scope: EventQueryScope): BuddyEvent[] {
		if (!scope.communityId && !scope.organizationId && !scope.roomId && !scope.taskId) throw new Error("relay query requires scope")
		return this.events.filter((event) => matchesScope(event, scope)).map((event) => structuredClone(event))
	}
}

export class RemoteRelayTransport implements BuddyRelayPort {
	private readonly wire: RemoteRelayWire
	private readonly credential: RemoteRelayCredential
	private readonly locallyRevokedCredentials = new Set<string>()
	private readonly locallyRevokedCapabilities = new Set<string>()
	private readonly locallyRevokedRoomGrants = new Set<string>()

	constructor(input: { wire: RemoteRelayWire; credential: RemoteRelayCredential }) {
		this.wire = input.wire
		this.credential = structuredClone(input.credential)
	}

	get status(): BuddyRelayConnectionStatus {
		return this.wire.status ?? "unknown"
	}

	async registerEndpoint(endpoint: RemoteRelayEndpoint, grant?: FederatedRoomGrant): Promise<() => void> {
		this.assertLocalCredential()
		if (grant && this.locallyRevokedRoomGrants.has(grant.grantId)) throw new Error("federated room grant is revoked")
		const request: Extract<RemoteRelayRequest, { kind: "endpoint.register" }> = {
			kind: "endpoint.register",
			requestId: requestId("endpoint"),
			credential: structuredClone(this.credential),
			identity: structuredClone(endpoint.identity),
			 scope: structuredClone(endpoint.scope),
			...(grant ? { grant: structuredClone(grant) } : {}),
			...(endpoint.lease ? { lease: structuredClone(endpoint.lease) } : {}),
		}
		const result = await this.wire.request(request)
		if (!result.ok) throw new Error(result.error?.message ?? "relay endpoint registration failed")
		return this.wire.registerEndpoint(request, endpoint)
	}

	async send(envelope: BuddyTaskEnvelope, scope: BuddyScope, grant?: FederatedRoomGrant): Promise<void> {
		this.assertLocalCredential()
		if (envelope.capabilityToken && this.locallyRevokedCapabilities.has(stableDigest(envelope.capabilityToken))) throw new Error("relay capability token is revoked")
		if (grant && this.locallyRevokedRoomGrants.has(grant.grantId)) throw new Error("federated room grant is revoked")
		const result = await this.wire.request({ kind: "task.send", requestId: requestId("send"), credential: structuredClone(this.credential), envelope: structuredClone(envelope), scope: structuredClone(scope), ...(grant ? { grant: structuredClone(grant) } : {}) })
		if (!result.ok) throw new Error(result.error?.message ?? "relay delivery failed")
	}

	subscribe(scope: EventQueryScope, handler: (event: BuddyEvent) => void, options: { sinceEventId?: string; grant?: FederatedRoomGrant } = {}): () => void {
		return this.wire.subscribe({ requestId: requestId("subscribe"), credential: structuredClone(this.credential), scope: structuredClone(scope), sinceEventId: options.sinceEventId, ...(options.grant ? { grant: structuredClone(options.grant) } : {}) }, handler)
	}

	async query(scope: EventQueryScope, grant?: FederatedRoomGrant): Promise<BuddyEvent[]> {
		this.assertLocalCredential()
		if (grant && this.locallyRevokedRoomGrants.has(grant.grantId)) throw new Error("federated room grant is revoked")
		const result = await this.wire.request({ kind: "events.query", requestId: requestId("query"), credential: structuredClone(this.credential), scope: structuredClone(scope), ...(grant ? { grant: structuredClone(grant) } : {}) })
		if (!result.ok) throw new Error(result.error?.message ?? "relay query failed")
		return result.events ?? []
	}

	async publishDirectoryCard(card: RelayDirectoryCard): Promise<void> {
		this.assertLocalCredential()
		const result = await this.wire.request({ kind: "directory.publish", requestId: requestId("directory-publish"), credential: structuredClone(this.credential), card: structuredClone(card) })
		if (!result.ok) throw new Error(result.error?.message ?? "relay directory publish failed")
	}

	async queryDirectory(communityId: string, capabilityId?: string): Promise<RelayDirectoryCard[]> {
		this.assertLocalCredential()
		const result = await this.wire.request({ kind: "directory.query", requestId: requestId("directory-query"), credential: structuredClone(this.credential), communityId, ...(capabilityId ? { capabilityId } : {}) })
		if (!result.ok) throw new Error(result.error?.message ?? "relay directory query failed")
		return result.directory ?? []
	}

	async queryRevocations(sinceSequence = 0): Promise<{ revocations: RelayRevocationRecord[]; nextSequence: number }> {
		const result = await this.wire.request({ kind: "revocations.query", requestId: requestId("revocations"), credential: structuredClone(this.credential), sinceSequence })
		if (!result.ok) throw new Error(result.error?.message ?? "relay revocation query failed")
		return { revocations: result.revocations ?? [], nextSequence: result.nextRevocationSequence ?? sinceSequence }
	}

	async applyRevocations(revocations: readonly RelayRevocationRecord[]): Promise<number> {
		const result = await this.wire.request({ kind: "revocations.apply", requestId: requestId("revocations-apply"), credential: structuredClone(this.credential), revocations: revocations.map((record) => structuredClone(record)) })
		if (!result.ok) throw new Error(result.error?.message ?? "relay revocation apply failed")
		this.applyLocalRevocations(revocations)
		return result.appliedRevocations ?? 0
	}

	async revokeRoomGrant(grantId: string): Promise<void> {
		this.assertLocalCredential()
		const result = await this.wire.request({ kind: "revocations.revoke", requestId: requestId("revoke-room-grant"), credential: structuredClone(this.credential), grantId: grantId.trim() })
		if (!result.ok) throw new Error(result.error?.message ?? "relay room grant revocation failed")
		if (result.revocation) this.applyLocalRevocations([result.revocation])
	}

	async queryPresences(sinceSequence = 0): Promise<{ presences: RelayPresenceRecord[]; nextSequence: number }> {
		const result = await this.wire.request({ kind: "presence.query", requestId: requestId("presence"), credential: structuredClone(this.credential), sinceSequence })
		if (!result.ok) throw new Error(result.error?.message ?? "relay presence query failed")
		return { presences: result.presences ?? [], nextSequence: result.nextPresenceSequence ?? sinceSequence }
	}

	async applyPresences(presences: readonly RelayPresenceRecord[]): Promise<number> {
		const result = await this.wire.request({ kind: "presence.apply", requestId: requestId("presence-apply"), credential: structuredClone(this.credential), presences: presences.map((record) => structuredClone(record)) })
		if (!result.ok) throw new Error(result.error?.message ?? "relay presence apply failed")
		return result.appliedPresences ?? 0
	}

	async syncAuthorityState(cursor: RelaySyncCursor, store?: RelaySyncCursorStore, options: RelaySyncOptions = {}): Promise<RelaySyncResult> {
		try {
			const revocations = await this.queryRevocations(cursor.revocationSequence)
			const presences = await this.queryPresences(cursor.presenceSequence)
			const next: RelaySyncCursor = { version: 1, revocationSequence: revocations.nextSequence, presenceSequence: presences.nextSequence, updatedAt: new Date().toISOString() }
			this.applyLocalRevocations(revocations.revocations)
			if (options.applyToRelay && revocations.revocations.length > 0) await this.applyRevocations(revocations.revocations)
			if (options.applyToRelay && presences.presences.length > 0) await this.applyPresences(presences.presences)
			if (options.persistCursor !== false) await store?.save(next)
			return { changed: revocations.revocations.length + presences.presences.length, cursor: next, revocations: revocations.revocations, presences: presences.presences }
		} catch (error) {
			const failed: RelaySyncCursor = { ...cursor, version: 1, updatedAt: new Date().toISOString(), lastError: error instanceof Error ? error.message : String(error) }
			if (options.persistCursor !== false) await store?.save(failed)
			throw error
		}
	}

	close(): void {
		this.wire.close()
	}

	private assertLocalCredential(): void {
		if (this.locallyRevokedCredentials.has(stableDigest(this.credential.token)) || this.credential.revokedAt) throw new Error("relay credential is revoked")
	}

	applyLocalRevocations(records: readonly RelayRevocationRecord[]): void {
		for (const record of records) {
			if (record.kind === "credential") this.locallyRevokedCredentials.add(record.identifier)
			if (record.kind === "capability") this.locallyRevokedCapabilities.add(record.identifier)
			if (record.kind === "room-grant") this.locallyRevokedRoomGrants.add(record.identifier)
		}
	}
}
