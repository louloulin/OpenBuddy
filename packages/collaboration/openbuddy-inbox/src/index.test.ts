import { describe, expect, it } from "vitest"
import { InboxProjection } from "./index"
import type { BuddyEvent, EventQueryScope } from "@openbuddy/collaboration-protocol"

const baseScope: EventQueryScope = { communityId: "community-1" }

function event(overrides: { id: string; kind: BuddyEvent["kind"]; communityId?: string; organizationId?: string; roomId?: string; taskId?: string; createdAt?: string; subject?: string }): BuddyEvent {
  const e: BuddyEvent = {
    id: overrides.id,
    kind: overrides.kind,
    actor: { id: "actor-1", handle: "actor-1", displayName: "actor", ownerUserId: "owner-1", trustLevel: "local", status: "working" },
    communityId: overrides.communityId ?? "community-1",
    organizationId: overrides.organizationId,
    roomId: overrides.roomId,
    taskId: overrides.taskId,
    nonce: `nonce-${overrides.id}`,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    payload: {},
    payloadDigest: `d-${overrides.id}`,
    subject: overrides.subject,
  }
  return e
}

describe("InboxProjection (in-memory, no mock)", () => {
  it("classifies events by kind into inbox kinds", () => {
    const inbox = new InboxProjection()
    inbox.ingest(event({ id: "e1", kind: "task.proposed", subject: "New task" }), "p1", baseScope)
    inbox.ingest(event({ id: "e2", kind: "approval.pending" }), "p1", baseScope)
    inbox.ingest(event({ id: "e3", kind: "task.failed" }), "p1", baseScope)
    inbox.ingest(event({ id: "e4", kind: "verification.pending" }), "p1", baseScope)
    inbox.ingest(event({ id: "e5", kind: "room.message" }), "p1", baseScope)
    const list = inbox.list("p1", baseScope)
    const kinds = list.map((item) => item.kind).sort()
    expect(kinds).toEqual(["approval", "failed", "incoming", "message", "verification"])
  })

  it("ignores events from a different community", () => {
    const inbox = new InboxProjection()
    inbox.ingest(event({ id: "e1", kind: "task.proposed", communityId: "other" }), "p1", baseScope)
    const list = inbox.list("p1", baseScope)
    expect(list).toEqual([])
  })

  it("filters by taskId and roomId scope", () => {
    const inbox = new InboxProjection()
    inbox.ingest(event({ id: "e1", kind: "task.proposed", taskId: "task-a", roomId: "room-a" }), "p1", baseScope)
    inbox.ingest(event({ id: "e2", kind: "task.proposed", taskId: "task-b", roomId: "room-b" }), "p1", baseScope)
    const filtered = inbox.list("p1", { communityId: "community-1", taskId: "task-a" })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].taskId).toBe("task-a")
  })

  it("sorts by createdAt descending", () => {
    const inbox = new InboxProjection()
    inbox.ingest(event({ id: "e1", kind: "task.proposed", createdAt: "2026-01-01T00:00:00.000Z" }), "p1", baseScope)
    inbox.ingest(event({ id: "e2", kind: "task.proposed", createdAt: "2026-01-02T00:00:00.000Z" }), "p1", baseScope)
    inbox.ingest(event({ id: "e3", kind: "task.proposed", createdAt: "2026-01-03T00:00:00.000Z" }), "p1", baseScope)
    const list = inbox.list("p1", baseScope)
    expect(list.map((item) => item.eventId)).toEqual(["e3", "e2", "e1"])
  })

  it("ack marks an item read and records the cursor", () => {
    const inbox = new InboxProjection()
    inbox.ingest(event({ id: "e1", kind: "task.proposed" }), "p1", baseScope)
    expect(inbox.list("p1", baseScope)[0].read).toBe(false)
    const cursor = inbox.ack("p1", "e1")
    expect(cursor.lastReadEventId).toBe("e1")
    expect(cursor.acknowledgedEventIds).toContain("e1")
    expect(inbox.list("p1", baseScope)[0].read).toBe(true)
  })

  it("restoreCursor seeds acknowledgedEventIds so future ingests are pre-read", () => {
    const inbox = new InboxProjection()
    inbox.restoreCursor({ principalId: "p1", acknowledgedEventIds: ["e1"] })
    inbox.ingest(event({ id: "e1", kind: "task.proposed" }), "p1", baseScope)
    expect(inbox.list("p1", baseScope)[0].read).toBe(true)
  })

  it("does not leak items across principal ids", () => {
    const inbox = new InboxProjection()
    inbox.ingest(event({ id: "e1", kind: "task.proposed" }), "p1", baseScope)
    inbox.ingest(event({ id: "e2", kind: "task.proposed" }), "p2", baseScope)
    expect(inbox.list("p1", baseScope)).toHaveLength(1)
    expect(inbox.list("p2", baseScope)).toHaveLength(1)
  })

  it("replaces items from rebuild", () => {
    const inbox = new InboxProjection()
    inbox.ingest(event({ id: "e1", kind: "task.proposed" }), "p1", baseScope)
    inbox.ingest(event({ id: "e2", kind: "task.proposed" }), "p1", baseScope)
    inbox.rebuild([event({ id: "e2", kind: "task.proposed" })], "p1", baseScope)
    expect(inbox.list("p1", baseScope).map((i) => i.eventId)).toEqual(["e2"])
  })

  it("ack is idempotent", () => {
    const inbox = new InboxProjection()
    inbox.ingest(event({ id: "e1", kind: "task.proposed" }), "p1", baseScope)
    inbox.ack("p1", "e1")
    inbox.ack("p1", "e1")
    const cursor = inbox.getCursor("p1")
    expect(cursor.acknowledgedEventIds.filter((id) => id === "e1")).toHaveLength(1)
  })

  it("getCursor returns empty default cursor for unknown principal", () => {
    const inbox = new InboxProjection()
    const cursor = inbox.getCursor("unknown")
    expect(cursor.acknowledgedEventIds).toEqual([])
  })
})
