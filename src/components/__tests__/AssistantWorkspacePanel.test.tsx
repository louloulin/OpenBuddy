import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantWorkspacePanel } from "@openbuddy/ui-workbench";
import type { CollaborationSnapshot } from "@/lib/agent/assistant-facade";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  onUpdate: vi.fn(),
  addNetworkTrustRoot: vi.fn(),
  revokeNetworkTrustRoot: vi.fn(),
  setNetworkPeerTrust: vi.fn(),
  registerNetworkPeer: vi.fn(),
  submitNetworkBid: vi.fn(),
  awardNetworkBid: vi.fn(),
  retryNetworkDeliveries: vi.fn(),
  proposeNetworkService: vi.fn(),
  publishNetworkOffer: vi.fn(),
  grantDelegation: vi.fn(),
  revokeDelegation: vi.fn(),
  addOrganizationMember: vi.fn(),
  addRoomMember: vi.fn(),
  removeRoomMember: vi.fn(),
  proposeWorkflow: vi.fn(),
  ackInbox: vi.fn(),
  ackEmailInbox: vi.fn(),
  issueFederatedRoomGrant: vi.fn(),
  revokeFederatedRoomGrant: vi.fn(),
}));

vi.mock("@/lib/agent/assistant-facade", () => ({ assistantFacade: mocks }));
vi.mock("@/lib/agent/pi-client", () => ({ collaborationRegisterNetworkPeer: vi.fn() }));
vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({ useRendererContributions: () => [] }));

function snapshot(): CollaborationSnapshot {
  return {
    protocol: "buddy/1.0",
    mode: "local-first",
    identity: { id: "local", handle: "local", displayName: "我的 Buddy", status: "idle" },
    rooms: [{ room: { id: "project-team-room", handle: "项目团队 Room", kind: "team", visibility: "org" }, memberCount: 1, channelCount: 2, members: [{ principalId: "local", role: "owner", joinedAt: "2026-08-30T12:00:00.000Z", active: true }] }],
    inbox: [],
    tasks: [],
    workflows: [],
    activity: [],
    capabilities: { local: 0, room: 0, organization: 0, directory: 0 },
    capabilityCards: [],
    mcpCapabilities: [],
    organization: { id: "org", members: [{ identity: { id: "buddy-1", handle: "worker", displayName: "Worker Buddy", ownerUserId: "user-2", organizationId: "org", trustLevel: "org", status: "idle" }, role: "member", joinedAt: "2026-08-30T12:00:00.000Z", active: true }], delegations: [], approvals: [], taskControls: [] },
    policy: { dataScopes: [], allowedActions: [], forbiddenActions: [], approval: "before_external_commit", expiresAt: "2026-08-30T13:00:00.000Z" },
    collaborationManifest: {
      protocol: "collaboration/1",
      pluginId: "openbuddy-collaboration",
      capabilities: [{ id: "tasks", version: "collaboration/1", modes: ["personal", "organization", "network"], transport: "ipc", redactedProjection: true }],
      invariants: ["single-runtime-source-of-truth", "discovery-is-not-authorization", "provider-cannot-self-verify", "renderer-receives-redacted-projection"],
    },
    network: {
      communityId: "community",
      mode: "local-sandbox",
      trustRoots: [{ keyRef: "ed25519:test-root", addedAt: "2026-08-30T12:00:00.000Z" }],
      deliveries: [],
      peers: [],
      capabilityDirectory: [],
      offers: [],
      capabilityAgreements: [],
      proposals: [],
      bids: [],
      authorityRevocations: [],
    },
    relay: { status: "local", pending: [] },
    updatedAt: "2026-08-30T12:00:00.000Z",
  } as CollaborationSnapshot;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.snapshot.mockResolvedValue(snapshot());
  mocks.onUpdate.mockResolvedValue(() => undefined);
  mocks.addNetworkTrustRoot.mockResolvedValue({ keyRef: "ed25519:new-root", addedAt: "2026-08-30T12:01:00.000Z" });
  mocks.revokeNetworkTrustRoot.mockResolvedValue([]);
  mocks.grantDelegation.mockResolvedValue({ id: "delegation-1", granteeId: "buddy-1", allowedCapabilities: ["research"], allowedDataScopes: ["room:personal-room"], expiresAt: "2026-08-30T13:00:00.000Z" });
  mocks.revokeDelegation.mockResolvedValue({ id: "delegation-1", revokedAt: "2026-08-30T12:02:00.000Z" });
  mocks.addOrganizationMember.mockResolvedValue({ identity: { id: "buddy-2", handle: "writer", displayName: "Writer Buddy", ownerUserId: "user-3" }, role: "member", active: true });
  mocks.addRoomMember.mockResolvedValue({ principalId: "buddy-1", role: "observer", active: true });
  mocks.removeRoomMember.mockResolvedValue({ principalId: "buddy-1", role: "observer", active: false });
  mocks.proposeWorkflow.mockResolvedValue({ workflowId: "workflow-1", title: "组织流程", mode: "organization", status: "proposed", nodes: [], createdAt: "2026-08-30T12:00:00.000Z", updatedAt: "2026-08-30T12:00:00.000Z" });
  mocks.issueFederatedRoomGrant.mockResolvedValue({ grantId: "grant-1", projectId: "p", roomId: "r", organizationId: "org", providerOrganizationId: "external-org", communityId: "c", allowedPrincipals: [], allowedCapabilities: [], allowedDataScopes: [], allowedActions: [], allowedOperations: [], issuedAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", issuerId: "local", status: "active" });
  mocks.revokeFederatedRoomGrant.mockResolvedValue({ grantId: "grant-1", projectId: "p", roomId: "r", organizationId: "org", communityId: "c", allowedPrincipals: [], allowedCapabilities: [], allowedDataScopes: [], allowedActions: [], allowedOperations: [], issuedAt: "2026-08-30T12:00:00.000Z", expiresAt: "2026-08-30T13:00:00.000Z", revokedAt: "2026-08-30T12:01:00.000Z", issuerId: "local", status: "revoked" });
  mocks.ackEmailInbox.mockResolvedValue({ accountId: "gmail:a1", threadId: "thread-1", acknowledgedAt: "2026-08-30T12:02:00.000Z" });
});

it("opens and acknowledges an email projection without using collaboration ack", async () => {
  const current = snapshot();
  current.inbox = [{ id: "email-inbox:gmail:a1:thread-1", kind: "message", title: "待回复：报价", summary: "客户等待确认", createdAt: "2026-08-30T12:00:00.000Z", read: false, eventId: "email:gmail:a1:thread-1", source: "email", emailAccountId: "gmail:a1", emailThreadId: "thread-1" }];
  mocks.snapshot.mockResolvedValue(current);
  const navigate = vi.fn();
  render(<AssistantWorkspacePanel section="inbox" onNavigate={navigate} />);
  await waitFor(() => expect(screen.getByText("待回复：报价")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "打开邮件" }));
  expect(navigate).toHaveBeenCalledWith("邮件");
  fireEvent.click(screen.getByRole("button", { name: "标记已处理" }));
  await waitFor(() => expect(mocks.ackEmailInbox).toHaveBeenCalledWith("gmail:a1", "thread-1", "2026-08-30T12:00:00.000Z"));
  expect(mocks.ackInbox).not.toHaveBeenCalled();
});

it("keeps the complete workbench menu in the assistant workspace header", async () => {
  render(<AssistantWorkspacePanel section="inbox" />);

  await waitFor(() => expect(screen.getByRole("navigation", { name: "助理工作台导航" })).toBeInTheDocument());
  for (const label of ["总览", "本地助理", "收件箱", "跨项目任务", "工作流", "开放网络"]) {
    expect(screen.getByRole("tab", { name: new RegExp(label) })).toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole("button", { name: /协作/ }));
  for (const label of ["日程", "Rooms", "助理与 Buddy"]) {
    expect(screen.getByRole("menuitem", { name: new RegExp(label) })).toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole("button", { name: /治理/ }));
  for (const label of ["能力与策略", "证据与审计", "副作用恢复"]) {
    expect(screen.getByRole("menuitem", { name: new RegExp(label) })).toBeInTheDocument();
  }
});

describe("AssistantWorkspacePanel workflow routing", () => {
  it("binds organization workflow nodes to an active Buddy", async () => {
    render(<AssistantWorkspacePanel section="workflows" />);

    expect(screen.getByLabelText("助理工作台导航")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("工作流标题")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("工作流标题"), { target: { value: "组织流程" } });
    fireEvent.change(screen.getByLabelText("工作流范围"), { target: { value: "organization" } });
    fireEvent.change(screen.getByLabelText("准备节点目标"), { target: { value: "准备资料" } });
    fireEvent.change(screen.getByLabelText("交付节点目标"), { target: { value: "提交报告" } });
    fireEvent.change(screen.getByLabelText("准备节点 Buddy"), { target: { value: "buddy-1" } });
    fireEvent.change(screen.getByLabelText("交付节点 Buddy"), { target: { value: "buddy-1" } });
    fireEvent.click(screen.getByRole("button", { name: "提出工作流" }));

    await waitFor(() => expect(mocks.proposeWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      mode: "organization",
      nodes: expect.arrayContaining([
        expect.objectContaining({ agentRef: { type: "organization-buddy", id: "buddy-1" } }),
      ]),
    })));
  });
});

describe("AssistantWorkspacePanel collaboration manifest", () => {
	 it("shows the versioned collaboration contract in capabilities", async () => {
		render(<AssistantWorkspacePanel section="capabilities" />);
		await waitFor(() => expect(screen.getByText("统一协作协议")).toBeInTheDocument());
		expect(screen.getByText("openbuddy-collaboration")).toBeInTheDocument();
		expect(screen.getByText(/single-runtime-source-of-truth/)).toBeInTheDocument();
	 });
});

describe("AssistantWorkspacePanel organization delegation", () => {
  it("creates and revokes a minimum-scope delegation through the assistant facade", async () => {
    render(<AssistantWorkspacePanel section="buddies" />);

    await waitFor(() => expect(screen.getByText("Worker Buddy")).toBeInTheDocument());
    const next = snapshot();
    next.organization.delegations = [{ id: "delegation-1", granteeId: "buddy-1", allowedCapabilities: ["research"], allowedDataScopes: ["room:project-1"], expiresAt: "2026-08-30T13:00:00.000Z" }];
    mocks.snapshot.mockResolvedValue(next);
    fireEvent.change(screen.getByLabelText("委托能力"), { target: { value: "research, calendar" } });
    fireEvent.change(screen.getByLabelText("委托数据范围"), { target: { value: "room:project-1" } });
    fireEvent.click(screen.getByRole("button", { name: "创建委托" }));
    await waitFor(() => expect(mocks.grantDelegation).toHaveBeenCalledWith(expect.objectContaining({ granteeId: "buddy-1", allowedCapabilities: ["research", "calendar"], allowedDataScopes: ["room:project-1"] })));

    await waitFor(() => expect(screen.getByRole("button", { name: "撤销" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(mocks.revokeDelegation).toHaveBeenCalledWith("delegation-1"));
  });
});

describe("AssistantWorkspacePanel organization members", () => {
  it("adds an organization Buddy through the assistant facade", async () => {
    render(<AssistantWorkspacePanel section="buddies" />);

    await waitFor(() => expect(screen.getByText("Worker Buddy")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("成员 ID"), { target: { value: "buddy-2" } });
    fireEvent.change(screen.getByLabelText("成员句柄"), { target: { value: "writer" } });
    fireEvent.change(screen.getByLabelText("成员显示名称"), { target: { value: "Writer Buddy" } });
    fireEvent.change(screen.getByLabelText("成员所属用户"), { target: { value: "user-3" } });
    fireEvent.click(screen.getByRole("button", { name: "添加组织 Buddy" }));

    await waitFor(() => expect(mocks.addOrganizationMember).toHaveBeenCalledWith({ id: "buddy-2", handle: "writer", displayName: "Writer Buddy", ownerUserId: "user-3", role: "member" }));
  });
});

describe("AssistantWorkspacePanel Rooms", () => {
  it("adds and removes an organization member from a team Room", async () => {
    render(<AssistantWorkspacePanel section="rooms" />);

    await waitFor(() => expect(screen.getAllByText("项目团队 Room").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Room 成员"), { target: { value: "buddy-1" } });
    fireEvent.change(screen.getByLabelText("Room 角色"), { target: { value: "observer" } });
    const next = snapshot();
    next.rooms[0].members.push({ principalId: "buddy-1", role: "observer", joinedAt: "2026-08-30T12:01:00.000Z", active: true });
    next.rooms[0].memberCount = 2;
    mocks.snapshot.mockResolvedValue(next);
    fireEvent.click(screen.getByRole("button", { name: "加入 Room" }));
    await waitFor(() => expect(mocks.addRoomMember).toHaveBeenCalledWith({ roomId: "project-team-room", principalId: "buddy-1", role: "observer" }));

    fireEvent.click(screen.getByRole("button", { name: "移出" }));
    await waitFor(() => expect(mocks.removeRoomMember).toHaveBeenCalledWith({ roomId: "project-team-room", principalId: "buddy-1" }));
  });
});

describe("AssistantWorkspacePanel Federated Room Grants cross-org surfacing", () => {
  function withFederatedGrants(grants: NonNullable<CollaborationSnapshot["federatedRoomGrants"]>) {
    const next = snapshot();
    next.federatedRoomGrants = grants;
    return next;
  }

  const sameOrgGrant = {
    grantId: "grant-same-org",
    projectId: "project-same",
    communityId: "community",
    organizationId: "org",
    providerOrganizationId: "org",
    roomId: "project-team-room",
    allowedPrincipals: ["buddy-1"],
    allowedCapabilities: ["research"],
    allowedDataScopes: ["public:brief"],
    allowedActions: ["read:room"],
    allowedOperations: ["events.query"] as Array<"endpoint.register" | "task.send" | "events.query">,
    issuedAt: "2026-08-30T12:00:00.000Z",
    expiresAt: "2026-08-30T13:00:00.000Z",
    issuerId: "local",
    status: "active" as const,
  };

  const crossOrgGrant = {
    grantId: "grant-cross-org",
    projectId: "project-cross",
    communityId: "community",
    organizationId: "org",
    providerOrganizationId: "external-org",
    roomId: "project-team-room",
    allowedPrincipals: ["external-buddy"],
    allowedCapabilities: ["research"],
    allowedDataScopes: ["public:brief"],
    allowedActions: ["read:room"],
    allowedOperations: ["task.send", "events.query"] as Array<"endpoint.register" | "task.send" | "events.query">,
    issuedAt: "2026-08-30T12:00:00.000Z",
    expiresAt: "2026-08-30T13:00:00.000Z",
    issuerId: "local",
    status: "active" as const,
  };

  it("renders the cross-org badge when providerOrganizationId differs from grantor organization", async () => {
    mocks.snapshot.mockResolvedValue(withFederatedGrants([sameOrgGrant, crossOrgGrant]));
    render(<AssistantWorkspacePanel section="rooms" />);

    await waitFor(() => expect(screen.getByTestId("federated-grant-grant-same-org")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("federated-grant-grant-cross-org")).toBeInTheDocument());

    const crossCard = screen.getByTestId("federated-grant-grant-cross-org");
    expect(crossCard.className).toMatch(/assistant-workspace__grant-item--cross-org/);
    expect(within(crossCard).getByText("跨组织")).toBeInTheDocument();
    expect(within(crossCard).getByText(/external-org/)).toBeInTheDocument();
    expect(within(crossCard).getByText(/颁发方组织：org/)).toBeInTheDocument();

    const sameCard = screen.getByTestId("federated-grant-grant-same-org");
    expect(sameCard.className).not.toMatch(/assistant-workspace__grant-item--cross-org/);
    expect(within(sameCard).getByText(/同组织/)).toBeInTheDocument();
  });

  it("revokes the grant through the assistant facade when the revoke button is clicked", async () => {
    mocks.snapshot.mockResolvedValue(withFederatedGrants([crossOrgGrant]));
    render(<AssistantWorkspacePanel section="rooms" />);

    await waitFor(() => expect(screen.getByTestId("federated-grant-grant-cross-org")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(mocks.revokeFederatedRoomGrant).toHaveBeenCalledWith("grant-cross-org"));
  });

  it("renders allowed data scopes, actions and operations in the grant detail", async () => {
    mocks.snapshot.mockResolvedValue(withFederatedGrants([crossOrgGrant]));
    render(<AssistantWorkspacePanel section="rooms" />);
    const card = await waitFor(() => screen.getByTestId("federated-grant-grant-cross-org"));
    expect(within(card).getByText("数据范围：public:brief")).toBeInTheDocument();
    expect(within(card).getByText("动作：read:room")).toBeInTheDocument();
    expect(within(card).getByText(/task\.send/)).toBeInTheDocument();
  });

  it("falls back to empty state when there are no federated grants", async () => {
    mocks.snapshot.mockResolvedValue(withFederatedGrants([]));
    render(<AssistantWorkspacePanel section="rooms" />);
    await waitFor(() => expect(screen.getByText(/暂无跨组织授权/)).toBeInTheDocument());
  });
});

describe("AssistantWorkspacePanel open network", () => {
  it("renders local trust roots and manages them through the assistant facade", async () => {
    render(<AssistantWorkspacePanel section="network" />);

    await waitFor(() => expect(screen.getByText("ed25519:test-root")).toBeInTheDocument());
    expect(screen.getByText("本地 Agent Card 信任根")).toBeInTheDocument();
    expect(screen.getByText("只保存公钥；这是本机 trust root，不是公网目录。只有验签通过的 Agent Card 才能进入网络服务流转。")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Agent Card 公钥"), { target: { value: "-----BEGIN PUBLIC KEY-----\npublic-key\n-----END PUBLIC KEY-----" } });
    fireEvent.click(screen.getByRole("button", { name: "添加公钥信任根" }));
    await waitFor(() => expect(mocks.addNetworkTrustRoot).toHaveBeenCalledWith("-----BEGIN PUBLIC KEY-----\npublic-key\n-----END PUBLIC KEY-----"));

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(mocks.revokeNetworkTrustRoot).toHaveBeenCalledWith("ed25519:test-root"));
  });
});
