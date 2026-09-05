import type { RelaySyncCursor, RelaySyncCursorStore } from "./durable-relay"
import type { RelayPresenceRecord, RelayRevocationRecord, RelaySyncOptions, RelaySyncResult, RemoteRelayTransport } from "./remote-relay"

export interface RelaySyncSchedulerSnapshot {
	status: "idle" | "syncing" | "backoff" | "stopped"
	consecutiveFailures: number
	lastSyncAt?: string
	lastChanged: number
	nextAttemptAt?: string
	lastError?: string
	cursor?: RelaySyncCursor
}

export interface RelaySyncSchedulerOptions {
	transport: Pick<RemoteRelayTransport, "syncAuthorityState">
	syncOptions?: RelaySyncOptions
	cursorStore: RelaySyncCursorStore
	intervalMs?: number
	maxBackoffMs?: number
	now?: () => Date
	onSync?: (result: RelaySyncResult) => void | Promise<void>
	onStatus?: (snapshot: RelaySyncSchedulerSnapshot) => void
}

const initialCursor = (): RelaySyncCursor => ({ version: 1, revocationSequence: 0, presenceSequence: 0 })

export class RelaySyncScheduler {
	private readonly transport: RelaySyncSchedulerOptions["transport"]
	private readonly cursorStore: RelaySyncCursorStore
	private readonly syncOptions: RelaySyncOptions
	private readonly intervalMs: number
	private readonly maxBackoffMs: number
	private readonly now: () => Date
	private readonly onSync?: RelaySyncSchedulerOptions["onSync"]
	private readonly onStatus?: RelaySyncSchedulerOptions["onStatus"]
	private timer?: ReturnType<typeof setTimeout>
	private running = false
	private syncing?: Promise<RelaySyncResult>
	private snapshot: RelaySyncSchedulerSnapshot = { status: "stopped", consecutiveFailures: 0, lastChanged: 0 }

	constructor(options: RelaySyncSchedulerOptions) {
		this.transport = options.transport
		this.cursorStore = options.cursorStore
		this.syncOptions = { ...options.syncOptions }
		this.intervalMs = Math.max(1_000, options.intervalMs ?? 30_000)
		this.maxBackoffMs = Math.max(this.intervalMs, options.maxBackoffMs ?? 5 * 60_000)
		this.now = options.now ?? (() => new Date())
		this.onSync = options.onSync
		this.onStatus = options.onStatus
	}

	getStatus(): RelaySyncSchedulerSnapshot {
		return structuredClone(this.snapshot)
	}

	start(): void {
		if (this.running) return
		this.running = true
		this.publish({ status: "idle", consecutiveFailures: 0, lastChanged: this.snapshot.lastChanged })
		void this.syncOnce().catch(() => undefined)
	}

	stop(): void {
		this.running = false
		if (this.timer) clearTimeout(this.timer)
		this.timer = undefined
		this.publish({ status: "stopped", consecutiveFailures: this.snapshot.consecutiveFailures, lastChanged: this.snapshot.lastChanged })
	}

	async syncOnce(): Promise<RelaySyncResult> {
		if (this.syncing) return this.syncing
		this.publish({ status: "syncing", consecutiveFailures: this.snapshot.consecutiveFailures, lastChanged: this.snapshot.lastChanged })
		const cursor = this.cursorStore.load() ?? initialCursor()
		this.syncing = this.transport.syncAuthorityState(cursor, this.cursorStore, { ...this.syncOptions, persistCursor: false })
			.then(async (result) => {
				if (this.onSync) await this.onSync(result)
				this.cursorStore.save(result.cursor)
				this.publish({ status: this.running ? "idle" : "stopped", consecutiveFailures: 0, lastChanged: result.changed, lastSyncAt: this.now().toISOString(), nextAttemptAt: undefined, lastError: undefined, cursor: result.cursor })
				this.schedule(this.intervalMs)
				return result
			})
			.catch((error: unknown) => {
				const consecutiveFailures = this.snapshot.consecutiveFailures + 1
				const delay = Math.min(this.maxBackoffMs, this.intervalMs * 2 ** Math.min(consecutiveFailures - 1, 8))
				this.cursorStore.save({ ...cursor, version: 1, updatedAt: this.now().toISOString(), lastError: error instanceof Error ? error.message : String(error) })
				this.publish({ status: this.running ? "backoff" : "stopped", consecutiveFailures, lastChanged: this.snapshot.lastChanged, lastError: error instanceof Error ? error.message : String(error), cursor: this.cursorStore.load(), nextAttemptAt: new Date(this.now().getTime() + delay).toISOString() })
				this.schedule(delay)
				throw error
			})
			.finally(() => { this.syncing = undefined })
		return this.syncing
	}

	private schedule(delay: number): void {
		if (!this.running) return
		if (this.timer) clearTimeout(this.timer)
		this.timer = setTimeout(() => { this.timer = undefined; void this.syncOnce().catch(() => undefined) }, delay)
		const timer = this.timer as ReturnType<typeof setTimeout> & { unref?: () => void }
		timer.unref?.()
	}

	private publish(next: Partial<RelaySyncSchedulerSnapshot>): void {
		this.snapshot = { ...this.snapshot, ...next }
		this.onStatus?.(this.getStatus())
	}
}

export type { RelayPresenceRecord, RelayRevocationRecord }
