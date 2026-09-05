import { describe, expect, it } from "vitest"
import { computeAssistantBadges } from "../agent/assistant-badges"
import type { CollaborationSnapshot } from "../agent/pi-client"

function emptySnapshot(): CollaborationSnapshot {
  return {
    protocol: "buddy/1.0",
    mode: "local-first",
    identity: { id: "i-1", handle: "i", displayName: "Identity", status: "idle" },
    rooms: [],
    inbox: [],
    tasks: [],
    workflows: [],
    activity: [],
    capabilities: { local: 0, room: 0, organization: 0, directory: 0 },
    capabilityCards: [],
    mcpCapabilities: [],
    policy: { dataScopes: [], allowedActions: [], forbiddenActions: [], approval: "before_external_commit", expiresAt: "2099-01-01T00:00:00.000Z" },
    organization: {
      id: "org-1",
      members: [],
      delegations: [],
      approvals: [],
      taskControls: [],
    },
    network: {
      communityId: "c1",
      mode: "local-sandbox",
      trustRoots: [],
      deliveries: [],
      peers: [],
      capabilityDirectory: [],
      offers: [],
      capabilityAgreements: [],
      authorityRevocations: [],
      proposals: [],
      bids: [],
    },
    relay: { status: "local", pending: [] },
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

describe("organization: collaboration projection primitives", () => {
  it("builds a deterministic badge projection for the same snapshot", () => {
    const snapshot = emptySnapshot()
    const a = computeAssistantBadges(snapshot)
    const b = computeAssistantBadges(snapshot)
    expect(a).toEqual(b)
    expect(typeof a).toBe("object")
  })

  it("handles an empty snapshot without throwing", () => {
    const result = computeAssistantBadges(emptySnapshot())
    expect(typeof result).toBe("object")
    expect(result["助理·Rooms"]).toBe(0)
  })

  it("counts pending approvals in the governance badge", () => {
    const snapshot = emptySnapshot()
    snapshot.organization.approvals = [
      { id: "a1", taskId: "t1", requesterId: "u1", actions: ["send"], reason: "test", createdAt: "2026-01-01T00:00:00.000Z", status: "pending" },
    ]
    const result = computeAssistantBadges(snapshot)
    expect(result["治理·审批"]).toBe(1)
  })

  it("counts unread inbox items", () => {
    const snapshot = emptySnapshot()
    snapshot.inbox = [
      { id: "i1", kind: "message", title: "t", summary: "s", createdAt: "2026-01-01T00:00:00.000Z", read: false, eventId: "e1" },
      { id: "i2", kind: "message", title: "t", summary: "s", createdAt: "2026-01-01T00:00:00.000Z", read: true, eventId: "e2" },
    ]
    const result = computeAssistantBadges(snapshot)
    expect(result["助理·收件箱"]).toBe(1)
  })

  it("counts failed tasks", () => {
    const snapshot = emptySnapshot()
    snapshot.tasks = [
      { taskId: "t1", status: "failed", title: "task 1", updatedAt: "2026-01-01T00:00:00.000Z" },
      { taskId: "t2", status: "completed", title: "task 2", updatedAt: "2026-01-01T00:00:00.000Z" },
    ]
    const result = computeAssistantBadges(snapshot)
    expect(result["助理·跨项目任务"]).toBe("1/2")
  })

  it("returns an empty map for null", () => {
    const result = computeAssistantBadges(null)
    expect(result).toEqual({})
  })
})
