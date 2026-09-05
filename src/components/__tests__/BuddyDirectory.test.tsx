import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BuddyDirectory } from "@openbuddy/ui-workbench";
import type { CollaborationSnapshot } from "@/lib/agent/assistant-facade";

function makeSnapshot(overrides: Partial<CollaborationSnapshot> = {}): CollaborationSnapshot {
  return {
    protocol: "buddy/1.0",
    mode: "local-first",
    identity: { id: "buddy-local", handle: "local", displayName: "我的 Buddy", status: "idle" },
    rooms: [],
    inbox: [],
    tasks: [],
    workflows: [],
    activity: [],
    capabilities: { local: 0, room: 0, organization: 0, directory: 0 },
    capabilityCards: [],
    mcpCapabilities: [],
    organization: { id: "org", members: [], delegations: [], approvals: [], taskControls: [] },
    policy: { dataScopes: [], allowedActions: [], forbiddenActions: [], approval: "before_external_commit", expiresAt: "2026-08-30T13:00:00.000Z" },
    collaborationManifest: { protocol: "collaboration/1", pluginId: "openbuddy-collaboration", capabilities: [], invariants: [] },
    network: { communityId: "community", mode: "local-sandbox", trustRoots: [], deliveries: [], peers: [], capabilityDirectory: [], offers: [], capabilityAgreements: [], proposals: [], bids: [], authorityRevocations: [] },
    relay: { status: "local", pending: [] },
    updatedAt: "2026-08-30T12:00:00.000Z",
    ...overrides,
  };
}

describe("BuddyDirectory", () => {
  it("renders the loading state when snapshot is null", () => {
    render(<BuddyDirectory snapshot={null} loading={true} />);
    expect(screen.getByText(/正在读取 Buddy 投影/)).toBeInTheDocument();
  });

  it("renders the empty state when snapshot is null and not loading", () => {
    render(<BuddyDirectory snapshot={null} loading={false} />);
    expect(screen.getByText(/当前没有可见 Buddy/)).toBeInTheDocument();
  });

  it("aggregates self + organization members + network peers under a single directory", () => {
    const snapshot = makeSnapshot({
      organization: {
        id: "org",
        members: [
          { identity: { id: "buddy-1", handle: "writer", displayName: "Writer Buddy", ownerUserId: "user-2", organizationId: "org", trustLevel: "org", status: "idle" }, role: "member", joinedAt: "2026-08-30T12:00:00.000Z", active: true },
          { identity: { id: "buddy-2", handle: "researcher", displayName: "Researcher Buddy", ownerUserId: "user-3", organizationId: "org", trustLevel: "org", status: "working" }, role: "admin", joinedAt: "2026-08-30T12:00:00.000Z", active: false },
        ],
        delegations: [],
        approvals: [],
        taskControls: [],
      },
      network: {
        communityId: "community",
        mode: "local-sandbox",
        trustRoots: [],
        deliveries: [],
        peers: [
          { identity: { id: "peer-1", handle: "ext", displayName: "External Buddy", organizationId: "external-org", trustLevel: "known_peer", status: "idle" }, trust: "trusted", capabilities: [{ id: "research:brief", description: "公开研究简报" }], agentCardStatus: "verified", firstSeenAt: "2026-08-30T11:00:00.000Z", lastSeenAt: "2026-08-30T12:00:00.000Z" },
        ],
        capabilityDirectory: [],
        offers: [],
        capabilityAgreements: [],
        proposals: [],
        bids: [],
        authorityRevocations: [],
      },
    });
    render(<BuddyDirectory snapshot={snapshot} loading={false} />);
    expect(screen.getByText("我的 Buddy")).toBeInTheDocument();
    expect(screen.getByText("Writer Buddy")).toBeInTheDocument();
    expect(screen.getByText("Researcher Buddy")).toBeInTheDocument();
    expect(screen.getByText("External Buddy")).toBeInTheDocument();
    const header = screen.getByText(/本人 1 · 组织 2 · Peer 1/);
    expect(header).toBeInTheDocument();
  });

  it("skips the user's own Buddy from the organization list to avoid duplication", () => {
    const snapshot = makeSnapshot({
      organization: {
        id: "org",
        members: [
          { identity: { id: "buddy-local", handle: "local", displayName: "我的 Buddy", ownerUserId: "user-1", organizationId: "org", trustLevel: "org", status: "idle" }, role: "owner", joinedAt: "2026-08-30T12:00:00.000Z", active: true },
          { identity: { id: "buddy-1", handle: "writer", displayName: "Writer Buddy", ownerUserId: "user-2", organizationId: "org", trustLevel: "org", status: "idle" }, role: "member", joinedAt: "2026-08-30T12:00:00.000Z", active: true },
        ],
        delegations: [],
        approvals: [],
        taskControls: [],
      },
    });
    render(<BuddyDirectory snapshot={snapshot} loading={false} />);
    expect(screen.getAllByText("我的 Buddy")).toHaveLength(1);
  });

  it("labels every Buddy with its source and trust level without exposing private prompts", () => {
    const snapshot = makeSnapshot({
      network: {
        communityId: "community",
        mode: "local-sandbox",
        trustRoots: [],
        deliveries: [],
        peers: [
          { identity: { id: "peer-1", handle: "ext", displayName: "External Buddy", organizationId: "external-org", trustLevel: "known_peer", status: "idle" }, trust: "pending", capabilities: [], agentCardStatus: "missing", firstSeenAt: "2026-08-30T11:00:00.000Z", lastSeenAt: "2026-08-30T12:00:00.000Z" },
        ],
        capabilityDirectory: [],
        offers: [],
        capabilityAgreements: [],
        proposals: [],
        bids: [],
        authorityRevocations: [],
      },
    });
    render(<BuddyDirectory snapshot={snapshot} loading={false} />);
    const card = screen.getByText("External Buddy").closest("li");
    expect(card).not.toBeNull();
    if (!card) return;
    expect(within(card).getByText("网络 Peer")).toBeInTheDocument();
    expect(within(card).getByText("已知 Peer")).toBeInTheDocument();
    expect(within(card).getByText("pending")).toBeInTheDocument();
    expect(within(card).getByText("missing")).toBeInTheDocument();
  });

  it("renders declared capabilities only when provided", () => {
    const snapshot = makeSnapshot({
      network: {
        communityId: "community",
        mode: "local-sandbox",
        trustRoots: [],
        deliveries: [],
        peers: [
          { identity: { id: "peer-1", handle: "ext", displayName: "External Buddy", organizationId: "external-org", trustLevel: "known_peer", status: "idle" }, trust: "trusted", capabilities: [{ id: "research:brief", description: "公开研究简报" }], agentCardStatus: "verified", firstSeenAt: "2026-08-30T11:00:00.000Z", lastSeenAt: "2026-08-30T12:00:00.000Z" },
        ],
        capabilityDirectory: [],
        offers: [],
        capabilityAgreements: [],
        proposals: [],
        bids: [],
        authorityRevocations: [],
      },
    });
    render(<BuddyDirectory snapshot={snapshot} loading={false} />);
    expect(screen.getByText("research:brief")).toBeInTheDocument();
    expect(screen.getByText("公开研究简报")).toBeInTheDocument();
  });

  it("preserves the Discovery ≠ Authorization invariant in the header note", () => {
    render(<BuddyDirectory snapshot={makeSnapshot()} loading={false} />);
    expect(screen.getByText(/Discovery.*Authorization/)).toBeInTheDocument();
  });

  it("flags organization members who have been deactivated", () => {
    const snapshot = makeSnapshot({
      organization: {
        id: "org",
        members: [
          { identity: { id: "buddy-1", handle: "writer", displayName: "Writer Buddy", ownerUserId: "user-2", organizationId: "org", trustLevel: "org", status: "idle" }, role: "member", joinedAt: "2026-08-30T12:00:00.000Z", active: false },
        ],
        delegations: [],
        approvals: [],
        taskControls: [],
      },
    });
    render(<BuddyDirectory snapshot={snapshot} loading={false} />);
    expect(screen.getByText("已停用")).toBeInTheDocument();
  });
});
