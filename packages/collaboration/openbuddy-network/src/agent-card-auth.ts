import { createHash, createPrivateKey, createPublicKey, KeyObject, sign, verify, type KeyLike } from "node:crypto"
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { BuddyAgentCard } from "@openbuddy/collaboration-protocol"

export type AgentCardPublicKeyResolver = (keyRef: string, card: BuddyAgentCard) => KeyLike | undefined

export interface AgentCardTrustRecord {
	keyRef: string
	publicKeyPem: string
	addedAt: string
	revokedAt?: string
}

export interface AgentCardTrustStore {
	resolvePublicKey(keyRef: string, card: BuddyAgentCard): KeyLike | undefined
	addPublicKeyPem(publicKeyPem: string, addedAt?: string): AgentCardTrustRecord
	revoke(keyRef: string, revokedAt?: string): void
	records(): AgentCardTrustRecord[]
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize)
	if (value && typeof value === "object") {
		return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((result, key) => {
			result[key] = canonicalize((value as Record<string, unknown>)[key])
			return result
		}, {})
	}
	return value
}

function unsignedCard(card: BuddyAgentCard): Omit<BuddyAgentCard, "signature"> {
	const { signature: _signature, ...unsigned } = card
	return unsigned
}

function cardBytes(card: BuddyAgentCard): Buffer {
	return Buffer.from(JSON.stringify(canonicalize(unsignedCard(card))), "utf8")
}

function encodeSignature(value: Buffer): string {
	return value.toString("base64url")
}

function decodeSignature(value: string): Buffer {
	return Buffer.from(value, "base64url")
}

function asEd25519Key(key: KeyLike, expectedType: "private" | "public"): KeyObject {
	const keyObject = key instanceof KeyObject ? key : expectedType === "private" ? createPrivateKey(key) : createPublicKey(key)
	if (keyObject.asymmetricKeyType !== "ed25519" || keyObject.type !== expectedType) throw new Error(`Agent Card key must be an Ed25519 ${expectedType} key`)
	return keyObject
}

export function agentCardKeyRef(publicKey: KeyLike): string {
	const keyObject = asEd25519Key(publicKey, "public")
	const exported = keyObject.export({ format: "der", type: "spki" })
	return `ed25519:${createHash("sha256").update(exported).digest("base64url").slice(0, 24)}`
}

export function issueEd25519AgentCard(card: Omit<BuddyAgentCard, "signature">, privateKey: KeyLike, keyRef?: string): BuddyAgentCard {
	const privateKeyObject = asEd25519Key(privateKey, "private")
	const resolvedKeyRef = keyRef ?? card.identity.publicKeyRef ?? agentCardKeyRef(createPublicKey(privateKeyObject))
	if (!resolvedKeyRef.trim()) throw new Error("Agent Card keyRef is required")
	if (card.identity.publicKeyRef && card.identity.publicKeyRef !== resolvedKeyRef) throw new Error("Agent Card keyRef does not match identity publicKeyRef")
	const signedCard = structuredClone({ ...card, identity: { ...card.identity, publicKeyRef: resolvedKeyRef }, signature: { algorithm: "Ed25519", keyRef: resolvedKeyRef, value: "" } }) as BuddyAgentCard
	signedCard.signature!.value = encodeSignature(sign(null, cardBytes(signedCard), privateKeyObject))
	return signedCard
}

export function verifyEd25519AgentCard(card: BuddyAgentCard, publicKey: KeyLike): void {
	if (card.protocol !== "agent-card/1" || !card.signature || card.signature.algorithm !== "Ed25519" || !card.signature.keyRef || !card.signature.value) throw new Error("Ed25519 Agent Card signature is required")
	if (card.identity.publicKeyRef && card.identity.publicKeyRef !== card.signature.keyRef) throw new Error("Agent Card keyRef does not match identity publicKeyRef")
	if (!verify(null, cardBytes(card), asEd25519Key(publicKey, "public"), decodeSignature(card.signature.value))) throw new Error("Ed25519 Agent Card signature is invalid")
}

export function createEd25519AgentCardVerifier(resolvePublicKey: AgentCardPublicKeyResolver): (card: BuddyAgentCard) => boolean {
	return (card) => {
		try {
			const keyRef = card.signature?.keyRef
			if (!keyRef) return false
			const publicKey = resolvePublicKey(keyRef, structuredClone(card))
			if (!publicKey) return false
			verifyEd25519AgentCard(card, publicKey)
			return true
		} catch {
			return false
		}
	}
}

export class MemoryAgentCardTrustStore implements AgentCardTrustStore {
	protected readonly recordsByKeyRef = new Map<string, AgentCardTrustRecord>()

	add(publicKey: KeyLike, addedAt = new Date().toISOString()): AgentCardTrustRecord {
		const keyObject = asEd25519Key(publicKey, "public")
		const keyRef = agentCardKeyRef(keyObject)
		const record: AgentCardTrustRecord = { keyRef, publicKeyPem: exportPublicKeyPem(keyObject), addedAt }
		this.recordsByKeyRef.set(keyRef, record)
		return structuredClone(record)
	}

	addPublicKeyPem(publicKeyPem: string, addedAt = new Date().toISOString()): AgentCardTrustRecord {
		if (/PRIVATE KEY/u.test(publicKeyPem)) throw new Error("private keys cannot be added to Agent Card trust store")
		return this.add(asEd25519Key(createPublicKey(publicKeyPem), "public"), addedAt)
	}

	revoke(keyRef: string, revokedAt = new Date().toISOString()): void {
		const current = this.recordsByKeyRef.get(keyRef)
		if (!current) throw new Error("Agent Card trust key is not registered")
		this.recordsByKeyRef.set(keyRef, { ...current, revokedAt })
	}

	resolvePublicKey(keyRef: string): KeyLike | undefined {
		const record = this.recordsByKeyRef.get(keyRef)
		if (!record || record.revokedAt) return undefined
		return createPublicKey(record.publicKeyPem)
	}

	records(): AgentCardTrustRecord[] {
		return [...this.recordsByKeyRef.values()].map((record) => structuredClone(record))
	}
}

interface AgentCardTrustStoreState {
	version: 1
	keys: AgentCardTrustRecord[]
}

export class JsonAgentCardTrustStore extends MemoryAgentCardTrustStore {
	constructor(private readonly path: string) {
		super()
		try {
			this.loadFromDiskSync()
		} catch (error) {
			console.warn("[openbuddy-agent-card] failed to load trust store", error)
		}
	}

	override add(publicKey: KeyLike, addedAt = new Date().toISOString()): AgentCardTrustRecord {
		const record = super.add(publicKey, addedAt)
		this.persistSync()
		return record
	}

	override revoke(keyRef: string, revokedAt = new Date().toISOString()): void {
		super.revoke(keyRef, revokedAt)
		this.persistSync()
	}

	async flush(): Promise<void> {
		// writes are synchronous; nothing else to await
	}

	private loadFromDiskSync(): void {
		let raw: string
		try {
			raw = readFileSync(this.path, "utf8")
		} catch {
			// Missing file is fine — store starts empty.
			return
		}
		let parsed: Partial<AgentCardTrustStoreState>
		try {
			parsed = JSON.parse(raw) as Partial<AgentCardTrustStoreState>
		} catch {
			return
		}
		if (parsed.version !== 1 || !Array.isArray(parsed.keys)) return
		for (const candidate of parsed.keys) {
			if (!candidate || typeof candidate !== "object" || typeof candidate.keyRef !== "string" || typeof candidate.publicKeyPem !== "string" || typeof candidate.addedAt !== "string") continue
			try {
				const publicKey = asEd25519Key(createPublicKey(candidate.publicKeyPem), "public")
				if (agentCardKeyRef(publicKey) !== candidate.keyRef) continue
				this.restoreRecord({ keyRef: candidate.keyRef, publicKeyPem: exportPublicKeyPem(publicKey), addedAt: candidate.addedAt, ...(typeof candidate.revokedAt === "string" ? { revokedAt: candidate.revokedAt } : {}) })
			} catch {
				continue
			}
		}
	}

	private restoreRecord(record: AgentCardTrustRecord): void {
		this.recordsByKeyRef.set(record.keyRef, record)
	}

	private persistSync(): void {
		const state: AgentCardTrustStoreState = { version: 1, keys: this.records() }
		try {
			mkdirSync(dirname(this.path), { recursive: true })
			const temporaryPath = `${this.path}.tmp`
			writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, "utf8")
			chmodSync(temporaryPath, 0o600)
			renameSync(temporaryPath, this.path)
		} catch (error) {
			console.warn("[openbuddy-agent-card] failed to persist trust store", error)
		}
	}
}

function exportPublicKeyPem(publicKey: KeyLike): string {
	const keyObject = asEd25519Key(publicKey, "public")
	return keyObject.export({ format: "pem", type: "spki" }).toString()
}
