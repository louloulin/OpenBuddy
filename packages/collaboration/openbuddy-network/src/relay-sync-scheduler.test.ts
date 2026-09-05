import { describe, expect, it, vi } from "vitest"
import { MemoryRelaySyncCursorStore } from "./durable-relay"
import { RelaySyncScheduler } from "./relay-sync-scheduler"

describe("RelaySyncScheduler", () => {
	it("runs an immediate sync and persists the cursor", async () => {
		const syncAuthorityState = vi.fn().mockResolvedValue({
			changed: 2,
			cursor: { version: 1, revocationSequence: 4, presenceSequence: 3, updatedAt: "2026-08-30T12:00:00.000Z" },
			revocations: [],
			presences: [],
		})
		const statuses: string[] = []
		const scheduler = new RelaySyncScheduler({ transport: { syncAuthorityState }, cursorStore: new MemoryRelaySyncCursorStore(), intervalMs: 60_000, onStatus: (snapshot) => statuses.push(snapshot.status) })
		scheduler.start()
		await vi.waitFor(() => expect(syncAuthorityState).toHaveBeenCalledTimes(1))
		await vi.waitFor(() => expect(scheduler.getStatus().status).toBe("idle"))
		scheduler.stop()
		expect(scheduler.getStatus()).toMatchObject({ status: "stopped", lastChanged: 2, cursor: { revocationSequence: 4, presenceSequence: 3 } })
		expect(statuses).toEqual(expect.arrayContaining(["syncing", "idle", "stopped"]))
		expect(syncAuthorityState).toHaveBeenCalledWith(expect.anything(), expect.anything(), { persistCursor: false })
	})

	it("backs off after a failed sync and keeps the previous cursor", async () => {
		const store = new MemoryRelaySyncCursorStore()
		store.save({ version: 1, revocationSequence: 2, presenceSequence: 1 })
		const syncAuthorityState = vi.fn().mockRejectedValue(new Error("relay unavailable"))
		const scheduler = new RelaySyncScheduler({ transport: { syncAuthorityState }, cursorStore: store, intervalMs: 60_000, onStatus: () => undefined })
		scheduler.start()
		await vi.waitFor(() => expect(syncAuthorityState).toHaveBeenCalledTimes(1))
		await vi.waitFor(() => expect(scheduler.getStatus().status).toBe("backoff"))
		expect(scheduler.getStatus()).toMatchObject({ status: "backoff", consecutiveFailures: 1, lastError: "relay unavailable", cursor: { revocationSequence: 2, presenceSequence: 1 } })
		scheduler.stop()
	})

	it("does not advance the cursor when the local projection fails", async () => {
		const store = new MemoryRelaySyncCursorStore()
		const initial = { version: 1 as const, revocationSequence: 2, presenceSequence: 1 }
		store.save(initial)
		const syncAuthorityState = vi.fn().mockResolvedValue({ changed: 1, cursor: { version: 1, revocationSequence: 3, presenceSequence: 1 }, revocations: [], presences: [] })
		const scheduler = new RelaySyncScheduler({ transport: { syncAuthorityState }, cursorStore: store, intervalMs: 60_000, onSync: async () => { throw new Error("projection failed") } })
		scheduler.start()
		await vi.waitFor(() => expect(scheduler.getStatus().status).toBe("backoff"))
		expect(store.load()).toMatchObject({ revocationSequence: 2, presenceSequence: 1, lastError: "projection failed" })
		scheduler.stop()
	})
})
