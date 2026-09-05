import { describe, expect, it } from "vitest"
import {
  OPENBUDDY_COLLABORATION_PROTOCOL_VERSION,
  createEvent,
  matchesDataScope,
  stableDigest,
  stableSerialize,
  type BuddyEvent,
  type BuddyIdentity,
} from "./index"

const actor: BuddyIdentity = {
  id: "actor-1",
  handle: "actor",
  displayName: "Actor",
  ownerUserId: "user-1",
  trustLevel: "local",
  status: "working",
}

describe("collaboration protocol (no mock)", () => {
  it("exports the pinned protocol version", () => {
    expect(OPENBUDDY_COLLABORATION_PROTOCOL_VERSION).toBe("collaboration/1")
  })

  it("stableSerialize sorts object keys for deterministic output", () => {
    expect(stableSerialize({ b: 1, a: 2 })).toBe(stableSerialize({ a: 2, b: 1 }))
    expect(stableSerialize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it("stableSerialize handles arrays and primitives", () => {
    expect(stableSerialize(undefined)).toBe("undefined")
    expect(stableSerialize(null)).toBe("null")
    expect(stableSerialize("hello")).toBe('"hello"')
    expect(stableSerialize(42)).toBe("42")
    expect(stableSerialize([3, 1, 2])).toBe("[3,1,2]")
    expect(stableSerialize({ arr: [1, 2] })).toBe('{"arr":[1,2]}')
  })

  it("stableDigest is deterministic for the same input regardless of key order", () => {
    const a = { b: "x", a: 1 }
    const b = { a: 1, b: "x" }
    expect(stableDigest(a)).toBe(stableDigest(b))
  })

  it("stableDigest differs for different inputs", () => {
    expect(stableDigest({ x: 1 })).not.toBe(stableDigest({ x: 2 }))
  })

  it("matchesDataScope accepts identical scopes", () => {
    expect(matchesDataScope("user.read", "user.read")).toBe(true)
  })

  it("matchesDataScope supports wildcard prefixes", () => {
    expect(matchesDataScope("user.*", "user.read")).toBe(true)
    expect(matchesDataScope("user.*", "user.write")).toBe(true)
    expect(matchesDataScope("user.*", "admin.read")).toBe(false)
  })

  it("matchesDataScope rejects non-matching scopes", () => {
    expect(matchesDataScope("user.read", "admin.read")).toBe(false)
    expect(matchesDataScope("user.read", "user.write")).toBe(false)
  })

  it("createEvent fills payloadDigest from the payload", () => {
    const event = createEvent({
      id: "evt-1",
      kind: "task.proposed",
      actor,
      communityId: "c1",
      nonce: "nonce-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      payload: { title: "Do thing" },
    })
    expect(event.id).toBe("evt-1")
    expect(event.payloadDigest).toBe(stableDigest({ title: "Do thing" }))
  })

  it("createEvent is stable for the same payload", () => {
    const input = {
      id: "evt-1",
      kind: "task.proposed",
      actor,
      communityId: "c1",
      nonce: "nonce-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      payload: { title: "Do thing", priority: 1 },
    } as const
    const a = createEvent(input)
    const b = createEvent(input)
    expect(a.payloadDigest).toBe(b.payloadDigest)
  })

  it("createEvent produces different digests for different payloads", () => {
    const base = {
      id: "evt-1",
      kind: "task.proposed",
      actor,
      communityId: "c1",
      nonce: "nonce-1",
      createdAt: "2026-01-01T00:00:00.000Z",
    }
    const a = createEvent({ ...base, payload: { title: "A" } })
    const b = createEvent({ ...base, payload: { title: "B" } })
    expect(a.payloadDigest).not.toBe(b.payloadDigest)
  })
})
