import { describe, expect, it } from "vitest";
import { selectProjectCollaboration } from "../collaboration/collaboration-projection";
import type { CollaborationSnapshot } from "../agent/assistant-facade";

function snapshot(overrides: Partial<CollaborationSnapshot> = {}): CollaborationSnapshot {
  return {
    protocol: "buddy/1.0",
    mode: "local-first",
    identity: { id: "local", handle: "local", displayName: "Local Buddy", status: "idle" },
    rooms: [],
    inbox: [],
    tasks: [],
    workflows: [],
    activity: [],
    capabilities: { local: 0, room: 0, organization: 0, directory: 0 },
    capabilityCards: [],
    mcpCapabilities: [],
    policy: { dataScopes: [], allowedActions: [], forbiddenActions: [], approval: "before_external_commit", expiresAt: "2026-08-30T13:00:00.000Z" },
    organization: { id: "org", members: [], delegations: [], approvals: [], taskControls: [] },
    network: { communityId: "community", mode: "local-sandbox", trustRoots: [], deliveries: [], peers: [], offers: [], proposals: [], bids: [], capabilityAgreements: [], capabilityDirectory: [], authorityRevocations: [] },
    relay: { status: "local", pending: [] },
    updatedAt: "2026-08-30T12:00:00.000Z",
    ...overrides,
  };
}

describe("selectProjectCollaboration", () => {
  it("keeps every project projection scoped to projectId", () => {
    const result = selectProjectCollaboration(snapshot({
      tasks: [
        { taskId: "task-a", title: "A", status: "accepted", projectId: "project-a", updatedAt: "2026-08-30T12:00:00.000Z" },
        { taskId: "task-b", title: "B", status: "accepted", projectId: "project-b", updatedAt: "2026-08-30T12:00:00.000Z" },
      ],
      workflows: [
        { workflowId: "workflow-a", title: "A", mode: "personal", projectId: "project-a", status: "accepted", nodes: [], createdAt: "2026-08-30T12:00:00.000Z", updatedAt: "2026-08-30T12:00:00.000Z" },
        { workflowId: "workflow-b", title: "B", mode: "personal", projectId: "project-b", status: "accepted", nodes: [], createdAt: "2026-08-30T12:00:00.000Z", updatedAt: "2026-08-30T12:00:00.000Z" },
      ],
      federatedRoomGrants: [
        { grantId: "grant-a", projectId: "project-a", communityId: "community", roomId: "room-a", allowedPrincipals: [], allowedCapabilities: [], allowedDataScopes: [], allowedActions: [], allowedOperations: ["events.query"], issuedAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", issuerId: "local", status: "active" },
        { grantId: "grant-b", projectId: "project-b", communityId: "community", roomId: "room-b", allowedPrincipals: [], allowedCapabilities: [], allowedDataScopes: [], allowedActions: [], allowedOperations: ["events.query"], issuedAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", issuerId: "local", status: "active" },
      ],
      activity: [
        { id: "evidence-a", kind: "task.evidence_verified", taskId: "task-a", subject: "A verified", createdAt: "2026-08-30T12:00:00.000Z" },
        { id: "evidence-b", kind: "task.evidence_verified", taskId: "task-b", subject: "B verified", createdAt: "2026-08-30T12:00:00.000Z" },
        { id: "unrelated", kind: "task.evidence_verified", taskId: "missing", subject: "outside", createdAt: "2026-08-30T12:00:00.000Z" },
      ],
    }), "project-a");

    expect(result.tasks.map((task) => task.taskId)).toEqual(["task-a"]);
    expect(result.workflows.map((workflow) => workflow.workflowId)).toEqual(["workflow-a"]);
    expect(result.grants.map((grant) => grant.grantId)).toEqual(["grant-a"]);
    expect(result.activity.map((event) => event.id)).toEqual(["evidence-a"]);
    expect(result.evidenceByTask.get("task-a")).toBe("已独立验收");
    expect(result.evidenceByTask.has("task-b")).toBe(false);
  });

  it("returns an empty projection without a usable scope", () => {
    expect(selectProjectCollaboration(null, "project-a")).toEqual({ tasks: [], workflows: [], grants: [], activity: [], evidenceByTask: new Map() });
    expect(selectProjectCollaboration(snapshot(), "")).toEqual({ tasks: [], workflows: [], grants: [], activity: [], evidenceByTask: new Map() });
  });
});
