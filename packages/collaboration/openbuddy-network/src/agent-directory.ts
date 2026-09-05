import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { BuddyAgentCard, BuddyCapability, BuddyIdentity } from "@openbuddy/collaboration-protocol"
import type { PeerRecord } from "./index"

export interface AgentDirectoryAdapter {
	readonly kind: "local-sandbox"
	upsert(peer: PeerRecord): void
	remove(peerId: string): void
	list(): PeerRecord[]
}

function clone(peer: PeerRecord): PeerRecord {
	return structuredClone(peer)
}

function validPeer(value: unknown): value is PeerRecord {
	if (!value || typeof value !== "object") return false
	const candidate = value as Partial<PeerRecord>
	return Boolean(candidate.identity && typeof candidate.identity === "object" && typeof candidate.identity.id === "string" && candidate.identity.id.trim() && Array.isArray(candidate.capabilities) && typeof candidate.firstSeenAt === "string" && typeof candidate.lastSeenAt === "string" && ["pending", "known", "trusted", "blocked", "revoked"].includes(String(candidate.trust)) && ["missing", "unverified", "verified"].includes(String(candidate.agentCardStatus)))
}

export class MemoryAgentDirectoryAdapter implements AgentDirectoryAdapter {
	readonly kind = "local-sandbox" as const
	protected readonly peers = new Map<string, PeerRecord>()

	upsert(peer: PeerRecord): void {
		if (!validPeer(peer)) throw new Error("agent directory peer projection is invalid")
		this.peers.set(peer.identity.id, clone(peer))
	}

	remove(peerId: string): void {
		this.peers.delete(peerId)
	}

	list(): PeerRecord[] {
		return [...this.peers.values()].map(clone)
	}
}

interface AgentDirectoryState {
	version: 1
	peers: PeerRecord[]
}

export class JsonAgentDirectoryAdapter extends MemoryAgentDirectoryAdapter {
	private loadPromise: Promise<void> | null = null

	constructor(private readonly path: string) {
		super()
		// Kick off the async load so callers get an empty directory first;
		// the populated state lands as soon as the file finishes parsing.
		this.loadPromise = this.loadFromDisk().catch((error) => {
			console.warn("[openbuddy-agent-directory] failed to load directory store", error)
		})
	}

	override upsert(peer: PeerRecord): void {
		super.upsert(peer)
		this.persistSync()
	}

	override remove(peerId: string): void {
		super.remove(peerId)
		this.persistSync()
	}

	async flush(): Promise<void> {
		if (this.loadPromise) {
			try { await this.loadPromise } catch { /* logged */ }
		}
	}

	private async loadFromDisk(): Promise<void> {
		let raw: string
		try {
			raw = await readFile(this.path, "utf8")
		} catch {
			// Missing file is fine — directory starts empty.
			return
		}
		let parsed: Partial<AgentDirectoryState>
		try {
			parsed = JSON.parse(raw) as Partial<AgentDirectoryState>
		} catch {
			return
		}
		if (parsed.version !== 1 || !Array.isArray(parsed.peers)) return
		for (const peer of parsed.peers) if (validPeer(peer)) this.peers.set(peer.identity.id, clone(peer))
	}

	private persistSync(): void {
		const state: AgentDirectoryState = { version: 1, peers: this.list() }
		try {
			mkdirSync(dirname(this.path), { recursive: true })
			const temporaryPath = `${this.path}.tmp`
			writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, "utf8")
			chmodSync(temporaryPath, 0o600)
			renameSync(temporaryPath, this.path)
		} catch (error) {
			console.warn("[openbuddy-agent-directory] failed to persist directory store", error)
		}
	}
}

export type AgentDirectoryPeerProjection = Pick<PeerRecord, "identity" | "trust" | "capabilities" | "agentCardStatus" | "presence" | "firstSeenAt" | "lastSeenAt"> & {
	agentCard?: BuddyAgentCard
}

export type AgentDirectoryIdentity = BuddyIdentity
export type AgentDirectoryCapability = BuddyCapability
