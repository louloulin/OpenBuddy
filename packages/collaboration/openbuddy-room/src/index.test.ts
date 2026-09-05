import { describe, expect, it } from "vitest"
import { InMemoryRoomStore, presenceAt, buildWakePayload, consumeWake, type PresenceLease, type WakeTaskSnapshot } from "./index"
import type { BuddyIdentity, BuddyRoom } from "@openbuddy/collaboration-protocol"

const actor: BuddyIdentity = { id: "actor-1", handle: "actor-1", displayName: "actor", ownerUserId: "owner-1", trustLevel: "local", status: "working" }
const scope = { communityId: "c1", organizationId: "o1", roomId: "r1" }

function makeRoom(): BuddyRoom {
  return {
    id: "r1",
    handle: "room-1",
    kind: "team",
    ownerUserId: "owner-1",
    organizationId: "o1",
    visibility: "org",
    channels: [{ id: "general", handle: "general", kind: "channel" }],
    members: [],
    policy: { visibility: "org", allowedTrustLevels: ["local"], retention: "room", allowExternalSideEffects: false },
  }
}

describe("InMemoryRoomStore (no mock)", () => {
  it("creates a room and emits a room.created event", () => {
    const store = new InMemoryRoomStore()
    const room = makeRoom()
    const result = store.create(scope, room, actor)
    expect(result.value.id).toBe("r1")
    expect(result.event.kind).toBe("room.created")
  })

  it("rejects creating a duplicate room", () => {
    const store = new InMemoryRoomStore()
    store.create(scope, makeRoom(), actor)
    expect(() => store.create(scope, makeRoom(), actor)).toThrow("room already exists")
  })

  it("addMember activates a member and emits an event", () => {
    const store = new InMemoryRoomStore()
    store.create(scope, makeRoom(), actor)
    const result = store.addMember(scope, { principalId: "agent-1", role: "member", joinedAt: "2026-01-01T00:00:00.000Z", active: true }, actor)
    expect(result.value.active).toBe(true)
    expect(result.event.kind).toBe("room.member_added")
    expect(store.listMembers(scope).map((m) => m.principalId)).toContain("agent-1")
  })

  it("addMember rejects duplicates by principalId", () => {
    const store = new InMemoryRoomStore()
    store.create(scope, makeRoom(), actor)
    store.addMember(scope, { principalId: "agent-1", role: "member", joinedAt: "2026-01-01T00:00:00.000Z", active: true }, actor)
    expect(() => store.addMember(scope, { principalId: "agent-1", role: "member", joinedAt: "2026-01-01T00:00:00.000Z", active: true }, actor))
      .toThrow("member already active")
  })

  it("removeMember deactivates the member", () => {
    const store = new InMemoryRoomStore()
    store.create(scope, makeRoom(), actor)
    store.addMember(scope, { principalId: "agent-1", role: "member", joinedAt: "2026-01-01T00:00:00.000Z", active: true }, actor)
    store.removeMember(scope, "agent-1", actor)
    expect(store.listMembers(scope)).toEqual([])
  })

  it("setPresence requires an active room member", () => {
    const store = new InMemoryRoomStore()
    store.create(scope, makeRoom(), actor)
    const lease: PresenceLease = {
      agentId: "agent-1",
      bodyId: "body-1",
      status: "working",
      startedAt: "2026-01-01T00:00:00.000Z",
      lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:01:00.000Z",
    }
    expect(() => store.setPresence(scope, lease, actor)).toThrow("not an active room member")
    store.addMember(scope, { principalId: "agent-1", role: "member", joinedAt: "2026-01-01T00:00:00.000Z", active: true }, actor)
    const result = store.setPresence(scope, lease, actor)
    expect(result.event.kind).toBe("agent.presence")
  })

  it("heartbeat rejects when bodyId mismatches the existing lease", () => {
    const store = new InMemoryRoomStore()
    store.create(scope, makeRoom(), actor)
    store.addMember(scope, { principalId: "agent-1", role: "member", joinedAt: "2026-01-01T00:00:00.000Z", active: true }, actor)
    const lease: PresenceLease = {
      agentId: "agent-1",
      bodyId: "body-1",
      status: "working",
      startedAt: "2026-01-01T00:00:00.000Z",
      lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:01:00.000Z",
    }
    store.setPresence(scope, lease, actor)
    expect(() => store.heartbeat(scope, "agent-1", "wrong-body", "2026-01-01T00:02:00.000Z", "2026-01-01T00:01:30.000Z", actor))
      .toThrow("presence body lease not found")
  })

  it("presenceAt returns offline after expiry", () => {
    const lease: PresenceLease = {
      agentId: "agent-1",
      bodyId: "body-1",
      status: "working",
      startedAt: "2026-01-01T00:00:00.000Z",
      lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:01:00.000Z",
    }
    expect(presenceAt(lease, "2026-01-01T00:00:30.000Z")).toBe("working")
    expect(presenceAt(lease, "2026-01-01T00:01:00.000Z")).toBe("offline")
  })

  it("queryEvents filters by scope", () => {
    const store = new InMemoryRoomStore()
    store.create(scope, makeRoom(), actor)
    store.addMember(scope, { principalId: "agent-1", role: "member", joinedAt: "2026-01-01T00:00:00.000Z", active: true }, actor)
    const events = store.queryEvents(scope)
    const kinds = events.map((e) => e.kind).sort()
    expect(kinds).toEqual(["room.created", "room.member_added"])
  })
})

describe("wake payload validation (no mock)", () => {
  function task(): WakeTaskSnapshot {
    return {
      taskId: "task-1",
      roomRef: "c1:o1:r1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      wakeNonce: "nonce-1",
    }
  }

  it("rejects missing identifiers", () => {
    expect(() => buildWakePayload({ taskId: "", roomRef: "x", principalId: "p", reason: "new_task", nonce: "n" }))
      .toThrow("stable identifiers")
  })

  it("consumeWake accepts when context matches", () => {
    const result = consumeWake(
      buildWakePayload({ taskId: "task-1", roomRef: "c1:o1:r1", principalId: "p1", reason: "new_task", nonce: "nonce-1" }),
      { now: "2026-01-01T00:00:00.000Z", principalId: "p1", isRoomMember: () => true, getTask: () => task() },
    )
    expect(result.accepted).toBe(true)
  })

  it("consumeWake rejects wrong principal", () => {
    const result = consumeWake(
      buildWakePayload({ taskId: "task-1", roomRef: "c1:o1:r1", principalId: "p1", reason: "new_task", nonce: "nonce-1" }),
      { now: "2026-01-01T00:00:00.000Z", principalId: "p2", isRoomMember: () => true, getTask: () => task() },
    )
    expect(result).toEqual({ accepted: false, reason: "wrong_principal" })
  })

  it("consumeWake rejects room mismatch", () => {
    const result = consumeWake(
      buildWakePayload({ taskId: "task-1", roomRef: "wrong", principalId: "p1", reason: "new_task", nonce: "nonce-1" }),
      { now: "2026-01-01T00:00:00.000Z", principalId: "p1", isRoomMember: () => true, getTask: () => task() },
    )
    expect(result).toEqual({ accepted: false, reason: "room_mismatch" })
  })

  it("consumeWake rejects expired task", () => {
    const result = consumeWake(
      buildWakePayload({ taskId: "task-1", roomRef: "c1:o1:r1", principalId: "p1", reason: "new_task", nonce: "nonce-1" }),
      { now: "2099-12-31T00:00:00.000Z", principalId: "p1", isRoomMember: () => true, getTask: () => task() },
    )
    expect(result).toEqual({ accepted: false, reason: "expired" })
  })

  it("consumeWake rejects stale nonce", () => {
    const result = consumeWake(
      buildWakePayload({ taskId: "task-1", roomRef: "c1:o1:r1", principalId: "p1", reason: "new_task", nonce: "different-nonce" }),
      { now: "2026-01-01T00:00:00.000Z", principalId: "p1", isRoomMember: () => true, getTask: () => task() },
    )
    expect(result).toEqual({ accepted: false, reason: "stale_nonce" })
  })
})
