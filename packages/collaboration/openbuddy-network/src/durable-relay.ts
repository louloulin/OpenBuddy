import { readFileSync } from "node:fs"
import { chmod, mkdir, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { BuddyEvent, BuddyScope, BuddyTaskEnvelope, FederatedRoomGrant } from "@openbuddy/collaboration-protocol"
import type { BuddyRelayPort } from "./index"
import type { RelayEncryptedDeliveryRecord } from "./relay-envelope"

export interface RemoteRelayPersistenceState {
	version: 1
	sequence: number
	events: BuddyEvent[]
	deliveredMessageIds: string[]
	revocationAuthorityId?: string
	revocationSequence?: number
	revocations?: RelayRevocationRecord[]
	presenceAuthorityId?: string
	presenceSequence?: number
	presences?: RelayPresenceRecord[]
	directory?: import("./remote-relay").RelayDirectoryCard[]
	replayNonces?: Array<{ key: string; messageId: string; expiresAt: string }>
	revokedCredentialDigests?: string[]
	revokedCapabilityDigests?: string[]
	revokedRoomGrantIds?: string[]
	deliveries?: RemoteRelayDeliveryRecord[]
	encryptedDeliveries?: RelayEncryptedDeliveryRecord[]
}

export type RelayRevocationKind = "credential" | "capability" | "room-grant"

export interface RelayRevocationRecord {
	authorityId: string
	sequence: number
	kind: RelayRevocationKind
	identifier: string
	revokedAt: string
	signature?: {
		algorithm: "Ed25519"
		keyRef: string
		value: string
	}
}

export type RelayPresenceStatus = "active" | "expired" | "revoked"

export interface RelayPresenceRecord {
	authorityId: string
	sequence: number
	lease: import("./index").PresenceLease
	status: RelayPresenceStatus
	updatedAt: string
}

export interface RemoteRelayDeliveryRecord {
	deliveryId: string
	messageId: string
	recipientId?: string
	status: "pending" | "delivered" | "failed"
	attempts: number
	updatedAt: string
	lastError?: string
}

export interface RemoteRelayPersistence {
	load(): RemoteRelayPersistenceState | undefined
	save(state: RemoteRelayPersistenceState): Promise<void>
}

export class MemoryRemoteRelayPersistence implements RemoteRelayPersistence {
	private state?: RemoteRelayPersistenceState

	load(): RemoteRelayPersistenceState | undefined {
		return this.state ? structuredClone(this.state) : undefined
	}

	async save(state: RemoteRelayPersistenceState): Promise<void> {
		this.state = structuredClone(state)
	}
}

export class JsonRemoteRelayPersistence implements RemoteRelayPersistence {
	private writeChain: Promise<void> = Promise.resolve()

	constructor(private readonly path: string) {}

	load(): RemoteRelayPersistenceState | undefined {
		try {
			const value = JSON.parse(readFileSync(this.path, "utf8")) as Partial<RemoteRelayPersistenceState>
			if (value.version !== 1 || !Array.isArray(value.events) || !Array.isArray(value.deliveredMessageIds)) return undefined
			return {
				version: 1,
				sequence: typeof value.sequence === "number" && Number.isFinite(value.sequence) ? Math.max(0, Math.floor(value.sequence)) : 0,
				events: value.events.filter((event): event is BuddyEvent => Boolean(event && typeof event.id === "string" && typeof event.kind === "string" && typeof event.communityId === "string")),
				deliveredMessageIds: value.deliveredMessageIds.filter((id): id is string => typeof id === "string"),
				revocationAuthorityId: typeof value.revocationAuthorityId === "string" && value.revocationAuthorityId.trim() ? value.revocationAuthorityId : undefined,
				revocationSequence: typeof value.revocationSequence === "number" && Number.isFinite(value.revocationSequence) ? Math.max(0, Math.floor(value.revocationSequence)) : 0,
				revocations: Array.isArray(value.revocations) ? value.revocations.flatMap((record): RelayRevocationRecord[] => {
					if (!record || typeof record !== "object") return []
					const candidate = record as Partial<RelayRevocationRecord>
					if (!(["credential", "capability", "room-grant"] as const).includes(candidate.kind as RelayRevocationKind) || typeof candidate.authorityId !== "string" || !candidate.authorityId.trim() || typeof candidate.sequence !== "number" || !Number.isFinite(candidate.sequence) || candidate.sequence <= 0 || typeof candidate.identifier !== "string" || !candidate.identifier.trim() || typeof candidate.revokedAt !== "string") return []
					const signature = candidate.signature && typeof candidate.signature === "object" && candidate.signature.algorithm === "Ed25519" && typeof candidate.signature.keyRef === "string" && typeof candidate.signature.value === "string"
						? { algorithm: "Ed25519" as const, keyRef: candidate.signature.keyRef, value: candidate.signature.value }
						: undefined
					return [{ authorityId: candidate.authorityId, sequence: Math.floor(candidate.sequence), kind: candidate.kind as RelayRevocationKind, identifier: candidate.identifier, revokedAt: candidate.revokedAt, ...(signature ? { signature } : {}) }]
				}) : [],
				presenceAuthorityId: typeof value.presenceAuthorityId === "string" && value.presenceAuthorityId.trim() ? value.presenceAuthorityId : undefined,
				presenceSequence: typeof value.presenceSequence === "number" && Number.isFinite(value.presenceSequence) ? Math.max(0, Math.floor(value.presenceSequence)) : 0,
				presences: Array.isArray(value.presences) ? value.presences.flatMap((record): RelayPresenceRecord[] => {
					if (!record || typeof record !== "object") return []
					const candidate = record as Partial<RelayPresenceRecord>
					if (typeof candidate.authorityId !== "string" || !candidate.authorityId.trim() || typeof candidate.sequence !== "number" || !Number.isInteger(candidate.sequence) || candidate.sequence <= 0 || !["active", "expired", "revoked"].includes(String(candidate.status)) || typeof candidate.updatedAt !== "string" || !candidate.lease || typeof candidate.lease !== "object") return []
					return [{ authorityId: candidate.authorityId, sequence: candidate.sequence, status: candidate.status as RelayPresenceStatus, updatedAt: candidate.updatedAt, lease: structuredClone(candidate.lease as import("./index").PresenceLease) }]
				}) : [],
				directory: Array.isArray(value.directory) ? value.directory.filter((card): card is import("./remote-relay").RelayDirectoryCard => Boolean(card && typeof card === "object" && typeof (card as { communityId?: unknown }).communityId === "string" && typeof (card as { updatedAt?: unknown }).updatedAt === "string" && typeof (card as { identity?: unknown }).identity === "object" && Array.isArray((card as { capabilities?: unknown }).capabilities))).map((card) => structuredClone(card)) : [],
				revokedCredentialDigests: Array.isArray(value.revokedCredentialDigests) ? value.revokedCredentialDigests.filter((digest): digest is string => typeof digest === "string" && digest.length > 0) : [],
				revokedCapabilityDigests: Array.isArray(value.revokedCapabilityDigests) ? value.revokedCapabilityDigests.filter((digest): digest is string => typeof digest === "string" && digest.length > 0) : [],
				revokedRoomGrantIds: Array.isArray(value.revokedRoomGrantIds) ? value.revokedRoomGrantIds.filter((id): id is string => typeof id === "string" && id.length > 0) : [],
				replayNonces: Array.isArray(value.replayNonces) ? value.replayNonces.flatMap((entry): Array<{ key: string; messageId: string; expiresAt: string }> => {
					if (!entry || typeof entry !== "object") return []
					const candidate = entry as Partial<{ key: string; messageId: string; expiresAt: string }>
					return typeof candidate.key === "string" && typeof candidate.messageId === "string" && typeof candidate.expiresAt === "string" ? [{ key: candidate.key, messageId: candidate.messageId, expiresAt: candidate.expiresAt }] : []
				}) : [],
				deliveries: Array.isArray(value.deliveries) ? value.deliveries.flatMap((delivery): RemoteRelayDeliveryRecord[] => {
					if (!delivery || typeof delivery !== "object") return []
					const candidate = delivery as Partial<RemoteRelayDeliveryRecord>
					if (typeof candidate.messageId !== "string" || !["pending", "delivered", "failed"].includes(String(candidate.status)) || typeof candidate.attempts !== "number" || typeof candidate.updatedAt !== "string") return []
					return [{
						deliveryId: typeof candidate.deliveryId === "string" && candidate.deliveryId ? candidate.deliveryId : `relay-delivery-${candidate.messageId}`,
						messageId: candidate.messageId,
						...(typeof candidate.recipientId === "string" ? { recipientId: candidate.recipientId } : {}),
						status: candidate.status as RemoteRelayDeliveryRecord["status"],
						attempts: Math.max(0, Math.floor(candidate.attempts)),
						updatedAt: candidate.updatedAt,
						...(typeof candidate.lastError === "string" ? { lastError: candidate.lastError } : {}),
					}]
				}) : [],
				encryptedDeliveries: Array.isArray(value.encryptedDeliveries) ? value.encryptedDeliveries.filter((record): record is RelayEncryptedDeliveryRecord => Boolean(record && typeof record === "object" && typeof record.deliveryId === "string" && typeof record.messageId === "string" && typeof record.recipientId === "string" && typeof record.algorithm === "string" && typeof record.keyRef === "string" && typeof record.nonce === "string" && typeof record.authTag === "string" && typeof record.ciphertext === "string" && typeof record.updatedAt === "string" && record.scope && typeof record.scope.communityId === "string")) : [],
			}
		} catch {
			return undefined
		}
	}

	async flush(): Promise<void> {
		await this.writeChain
	}

	save(state: RemoteRelayPersistenceState): Promise<void> {
		const write = this.writeChain
			.then(async () => {
				await mkdir(dirname(this.path), { recursive: true })
				const temporaryPath = `${this.path}.tmp`
				await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, "utf8")
				await chmod(temporaryPath, 0o600)
				await rename(temporaryPath, this.path)
			})
			.catch((error) => {
				console.warn("[openbuddy-network] failed to persist relay state", error)
			})
		this.writeChain = write
		return write
	}
}

export interface RelayOutboxEntry {
	messageId: string
	envelope: BuddyTaskEnvelope
	scope: BuddyScope
	grant?: FederatedRoomGrant
	createdAt: string
	attempts: number
	lastAttemptAt?: string
	lastError?: string
}

export interface RelayOutboxStore {
	load(): RelayOutboxEntry[]
	save(entries: readonly RelayOutboxEntry[]): Promise<void>
}

export class MemoryRelayOutboxStore implements RelayOutboxStore {
	private entries: RelayOutboxEntry[] = []

	load(): RelayOutboxEntry[] {
		return structuredClone(this.entries)
	}

	async save(entries: readonly RelayOutboxEntry[]): Promise<void> {
		this.entries = structuredClone([...entries])
	}
}

export class JsonRelayOutboxStore implements RelayOutboxStore {
	private writeChain: Promise<void> = Promise.resolve()

	constructor(private readonly path: string) {}

	load(): RelayOutboxEntry[] {
		try {
			const value = JSON.parse(readFileSync(this.path, "utf8")) as unknown
			if (!Array.isArray(value)) return []
				return value.filter((entry): entry is RelayOutboxEntry => {
				if (!entry || typeof entry !== "object") return false
				const candidate = entry as Partial<RelayOutboxEntry>
				return typeof candidate.messageId === "string"
					&& Boolean(candidate.envelope && typeof candidate.envelope === "object" && typeof candidate.envelope.messageId === "string")
					&& Boolean(candidate.scope && typeof candidate.scope === "object" && typeof candidate.scope.communityId === "string")
					&& typeof candidate.createdAt === "string"
					&& typeof candidate.attempts === "number"
			})
		} catch {
			return []
		}
	}

	async flush(): Promise<void> {
		await this.writeChain
	}

	save(entries: readonly RelayOutboxEntry[]): Promise<void> {
		const write = this.writeChain
			.then(async () => {
				await mkdir(dirname(this.path), { recursive: true })
				const temporaryPath = `${this.path}.tmp`
				await writeFile(temporaryPath, `${JSON.stringify(entries)}\n`, "utf8")
				await chmod(temporaryPath, 0o600)
				await rename(temporaryPath, this.path)
			})
			.catch((error) => {
				console.warn("[openbuddy-network] failed to persist relay outbox", error)
			})
		this.writeChain = write
		return write
	}
}

export interface RelayOutboxPendingEntry {
	messageId: string
	taskId: string
	recipientId?: string
	attempts: number
	createdAt: string
	lastAttemptAt?: string
	lastError?: string
}

export interface RelayOutboxRetryResult {
	messageId: string
	status: "delivered" | "pending" | "expired"
	lastError?: string
}

export interface RelaySyncCursor {
	version: 1
	revocationSequence: number
	presenceSequence: number
	updatedAt?: string
	lastError?: string
}

export interface RelaySyncCursorStore {
	load(): RelaySyncCursor | undefined
	save(cursor: RelaySyncCursor): Promise<void>
}

export class MemoryRelaySyncCursorStore implements RelaySyncCursorStore {
	private cursor?: RelaySyncCursor

	load(): RelaySyncCursor | undefined { return this.cursor ? structuredClone(this.cursor) : undefined }
	async save(cursor: RelaySyncCursor): Promise<void> { this.cursor = structuredClone(cursor) }
}

export class JsonRelaySyncCursorStore implements RelaySyncCursorStore {
	private writeChain: Promise<void> = Promise.resolve()

	constructor(private readonly path: string) {}

	load(): RelaySyncCursor | undefined {
		try {
			const value = JSON.parse(readFileSync(this.path, "utf8")) as Partial<RelaySyncCursor>
			if (value.version !== 1) return undefined
			return {
				version: 1,
				revocationSequence: typeof value.revocationSequence === "number" ? Math.max(0, Math.floor(value.revocationSequence)) : 0,
				presenceSequence: typeof value.presenceSequence === "number" ? Math.max(0, Math.floor(value.presenceSequence)) : 0,
				...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
				...(typeof value.lastError === "string" ? { lastError: value.lastError } : {}),
			}
		} catch {
			return undefined
		}
	}

	async flush(): Promise<void> {
		await this.writeChain
	}

	save(cursor: RelaySyncCursor): Promise<void> {
		const write = this.writeChain
			.then(async () => {
				await mkdir(dirname(this.path), { recursive: true })
				const temporaryPath = `${this.path}.tmp`
				await writeFile(temporaryPath, `${JSON.stringify(cursor)}\n`, "utf8")
				await chmod(temporaryPath, 0o600)
				await rename(temporaryPath, this.path)
			})
			.catch((error) => {
				console.warn("[openbuddy-network] failed to persist relay sync cursor", error)
			})
		this.writeChain = write
		return write
	}
}

export class RelayOutboxExpiredError extends Error {
	readonly code = "relay_task_expired"

	constructor(messageId: string) {
		super(`relay task has expired: ${messageId}`)
		this.name = "RelayOutboxExpiredError"
	}
}

export class DurableRelayOutbox {
	private readonly entries = new Map<string, RelayOutboxEntry>()
	private readonly now: () => string
	private queue: Promise<void> = Promise.resolve()
	private writeChain: Promise<void> = Promise.resolve()

	constructor(options: { relay: BuddyRelayPort; store: RelayOutboxStore; now?: () => string }) {
		this.relay = options.relay
		this.store = options.store
		this.now = options.now ?? (() => new Date().toISOString())
		for (const entry of options.store.load()) this.entries.set(entry.messageId, structuredClone(entry))
	}

	private readonly relay: BuddyRelayPort
	private readonly store: RelayOutboxStore

	async send(envelope: BuddyTaskEnvelope, scope: BuddyScope, grant?: FederatedRoomGrant): Promise<void> {
		const existing = this.entries.get(envelope.messageId)
		if (!existing) {
			this.entries.set(envelope.messageId, {
				messageId: envelope.messageId,
				envelope: structuredClone(envelope),
				 scope: structuredClone(scope),
				...(grant ? { grant: structuredClone(grant) } : {}),
				createdAt: this.now(),
				attempts: 0,
			})
			await this.store.save([...this.entries.values()])
			this.persist()
		}
		return this.schedule(async () => this.flushEntry(envelope.messageId))
	}

	async retryPending(): Promise<RelayOutboxRetryResult[]> {
		return this.schedule(async () => {
			const results: RelayOutboxRetryResult[] = []
			for (const messageId of [...this.entries.keys()]) {
				const entry = this.entries.get(messageId)
				if (entry && this.isExpired(entry.envelope)) {
					this.entries.delete(messageId)
					this.persist()
					results.push({ messageId, status: "expired", lastError: new RelayOutboxExpiredError(messageId).message })
					continue
				}
				try {
					await this.flushEntry(messageId)
					results.push({ messageId, status: "delivered" })
				} catch (error) {
					results.push({ messageId, status: "pending", lastError: error instanceof Error ? error.message : String(error) })
				}
			}
			return results
		})
	}

	pending(): RelayOutboxPendingEntry[] {
		return [...this.entries.values()].map((entry) => ({
			messageId: entry.messageId,
			taskId: entry.envelope.taskId,
			recipientId: entry.envelope.recipient?.id,
			attempts: entry.attempts,
			createdAt: entry.createdAt,
			...(entry.lastAttemptAt ? { lastAttemptAt: entry.lastAttemptAt } : {}),
			...(entry.lastError ? { lastError: entry.lastError } : {}),
		}))
	}

	private schedule<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation)
		this.queue = result.then(() => undefined, () => undefined)
		return result
	}

	private async flushEntry(messageId: string): Promise<void> {
		const entry = this.entries.get(messageId)
		if (!entry) return
		if (this.isExpired(entry.envelope)) {
			this.entries.delete(messageId)
			this.persist()
			throw new RelayOutboxExpiredError(messageId)
		}
		entry.attempts += 1
		entry.lastAttemptAt = this.now()
		entry.lastError = undefined
		this.persist()
		try {
			await this.relay.send(entry.envelope, entry.scope, entry.grant)
			this.entries.delete(messageId)
			this.persist()
		} catch (error) {
			entry.lastError = error instanceof Error ? error.message : String(error)
			this.persist()
			throw error
		}
	}

	private persist(): void {
		const savePromise = this.store.save([...this.entries.values()])
		const write = this.writeChain.then(() => savePromise).catch((error) => {
			console.warn("[openbuddy-network] failed to persist relay outbox", error)
		})
		this.writeChain = write
	}

	async flush(): Promise<void> {
		await this.writeChain
	}

	private isExpired(envelope: BuddyTaskEnvelope): boolean {
		const expiresAt = Date.parse(envelope.expiresAt)
		return Number.isFinite(expiresAt) && expiresAt <= Date.parse(this.now())
	}
}
