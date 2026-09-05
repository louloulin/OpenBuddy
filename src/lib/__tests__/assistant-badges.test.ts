import { describe, expect, it } from "vitest";
import { computeAssistantBadges } from "../agent/assistant-badges";
import type { CollaborationSnapshot } from "../agent/assistant-facade";

function snapshot(partial: Partial<CollaborationSnapshot> = {}): CollaborationSnapshot {
  return {
    protocol: "buddy/1.0",
    mode: "local-first",
    identity: { id: "local", handle: "local", displayName: "我", status: "idle" },
    rooms: [],
    inbox: [],
    tasks: [],
    workflows: [],
    activity: [],
    capabilities: { local: 0, room: 0, organization: 0, directory: 0 },
    capabilityCards: [],
    mcpCapabilities: [],
    organization: { id: "org", members: [], delegations: [], approvals: [], taskControls: [] },
    policy: { dataScopes: [], allowedActions: [], forbiddenActions: [], approval: "before_external_commit", expiresAt: new Date(Date.now() + 60_000).toISOString() },
    collaborationManifest: { protocol: "collaboration/1", pluginId: "openbuddy-collaboration", capabilities: [], invariants: [] },
    network: { peers: [], trustRoots: [], proposals: [], bids: [], offers: [], capabilityAgreements: [], deliveries: [] },
    ...partial,
  } as CollaborationSnapshot;
}

describe("computeAssistantBadges", () => {
  it("返回空 map 当 snapshot 为空", () => {
    expect(computeAssistantBadges(null)).toEqual({});
  });

  it("统计待处理审批、副作用和过期委托", () => {
    const now = Date.now();
    const result = computeAssistantBadges(snapshot({
      organization: {
        id: "org",
        members: [],
        delegations: [
          { id: "d1", granteeId: "b", allowedCapabilities: ["x"], allowedDataScopes: [], expiresAt: new Date(now - 60_000).toISOString() },
          { id: "d2", granteeId: "b", allowedCapabilities: ["x"], allowedDataScopes: [], expiresAt: new Date(now + 60_000).toISOString() },
        ],
        approvals: [{ id: "a1", taskId: "t", requesterId: "buddy-1", actions: ["x"], reason: "test", status: "pending", createdAt: new Date().toISOString() }],
        taskControls: [],
      },
      sideEffectIntents: [
        { intentId: "s1", taskId: "t", approvalId: "a1", roomId: "r", capability: "c", action: "a", fingerprint: "f", summary: "x", createdAt: new Date().toISOString(), expiresAt: new Date(now + 60_000).toISOString(), status: "pending" },
      ],
    }));
    expect(result["治理·审批"]).toBe(1);
    expect(result["治理·副作用"]).toBe(1);
    expect(result["治理·委托"]).toBe(1);
  });

  it("跳过已撤销的委托", () => {
    const now = Date.now();
    const result = computeAssistantBadges(snapshot({
      organization: {
        id: "org",
        members: [],
        delegations: [
          { id: "d1", granteeId: "b", allowedCapabilities: ["x"], allowedDataScopes: [], expiresAt: new Date(now - 60_000).toISOString(), revokedAt: new Date(now - 30_000).toISOString() },
        ],
        approvals: [],
        taskControls: [],
      },
    }));
    expect(result["治理·委托"]).toBe(0);
  });

  it("统计协作分组未读与活跃 Rooms", () => {
    const result = computeAssistantBadges(snapshot({
      rooms: [
        { room: { id: "r-personal", handle: "personal", kind: "personal", visibility: "private" }, memberCount: 1, channelCount: 1, members: [] },
        { room: { id: "r-team", handle: "team", kind: "team", visibility: "org" }, memberCount: 3, channelCount: 2, members: [] },
      ],
      inbox: [
        { id: "m1", kind: "mention", title: "@你", summary: "", createdAt: new Date().toISOString(), read: false, eventId: "e1" },
        { id: "m2", kind: "invite", title: "邀请", summary: "", createdAt: new Date().toISOString(), read: false, eventId: "e2" },
        { id: "m3", kind: "handover", title: "交接", summary: "", createdAt: new Date().toISOString(), read: true, eventId: "e3" },
        { id: "m4", kind: "message", title: "邮件", summary: "", createdAt: new Date().toISOString(), read: false, eventId: "e4", source: "email", emailAccountId: "g", emailThreadId: "t" },
        { id: "m5", kind: "approval", title: "审批", summary: "", createdAt: new Date().toISOString(), read: false, eventId: "e5" },
      ],
    }));
    expect(result["协作·未读"]).toBe(2);
    expect(result["协作·活跃"]).toBe(1);
  });
});
