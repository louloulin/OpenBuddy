import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectCollaborationTab } from "@openbuddy/ui-workbench";
import { useProjectsStore } from "@/stores/projects-store";

const mocks = vi.hoisted(() => ({
	collaborationSnapshot: vi.fn(),
	collaborationOnUpdate: vi.fn(),
	collaborationPropose: vi.fn(),
	collaborationExecute: vi.fn(),
	collaborationWorkflowPropose: vi.fn(),
	collaborationWorkflowExecute: vi.fn(),
	collaborationRevokeFederatedRoomGrant: vi.fn(),
}));

vi.mock("@/lib/agent/pi-client", () => mocks);

const project = {
	id: "project-ui",
	name: "UI 项目",
	createdAt: "2026-08-30T12:00:00.000Z",
	connectors: [],
	experts: [],
	skills: [],
	plans: [],
	tasks: [],
	assets: [],
	dataSources: [],
	members: [],
	activities: [],
	conversations: [],
};

beforeEach(() => {
	vi.clearAllMocks();
	useProjectsStore.setState({ projects: [project], activeProjectId: null });
	mocks.collaborationSnapshot.mockResolvedValue({ tasks: [], rooms: [], inbox: [], activity: [], capabilityCards: [], capabilities: { local: 0, room: 0, organization: 0, directory: 0 }, organization: { id: "org", members: [], delegations: [], approvals: [], taskControls: [] }, network: { communityId: "community", mode: "local-sandbox", peers: [], offers: [], proposals: [], bids: [], capabilityAgreements: [], deliveries: [], trustRoots: [] }, identity: { id: "buddy", handle: "buddy", displayName: "Buddy", ownerUserId: "user", trustLevel: "local", status: "idle" }, policy: { dataScopes: [], allowedActions: [], forbiddenActions: [], approval: "before_external_commit", expiresAt: "2026-08-30T13:00:00.000Z" }, protocol: "buddy/1.0", mode: "local-first", updatedAt: "2026-08-30T12:00:00.000Z" });
	mocks.collaborationPropose.mockResolvedValue({ taskId: "buddy-task-ui", eventId: "event-ui", status: "proposed", roomId: "project-room-ui", mode: "personal", projectId: "project-ui", executionRef: { executionId: "execution:buddy-task-ui", taskId: "buddy-task-ui", workflowId: "workflow:buddy-task-ui", stepId: "step:buddy-task-ui:root", teamId: "team:buddy-task-ui" }, contract: { dataScopes: ["room:project-room-ui"], artifactTypes: ["brief"], approval: "before_external_commit", execution: "local" } });
	mocks.collaborationOnUpdate.mockResolvedValue(() => undefined);
	mocks.collaborationWorkflowPropose.mockResolvedValue({ workflowId: "workflow-ui", title: "项目周报", mode: "organization", projectId: "project-ui", status: "proposed", nodes: [], createdAt: "2026-08-30T12:00:00.000Z", updatedAt: "2026-08-30T12:00:00.000Z" });
	mocks.collaborationWorkflowExecute.mockResolvedValue({ workflowId: "workflow-ui", status: "accepted", nodes: [] });
	mocks.collaborationRevokeFederatedRoomGrant.mockResolvedValue({ grantId: "grant-ui", status: "revoked" });
});

describe("ProjectCollaborationTab", () => {
	it("creates one canonical Buddy task and keeps a project weak reference", async () => {
		render(<ProjectCollaborationTab projectId="project-ui" projectName="UI 项目" />);
		await waitFor(() => expect(mocks.collaborationOnUpdate).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(screen.getByText("当前项目还没有 Buddy 协作任务。")).toBeInTheDocument());
		fireEvent.change(screen.getByLabelText("Buddy 任务标题"), { target: { value: "整理项目周报" } });
		fireEvent.change(screen.getByLabelText("Buddy 任务目标"), { target: { value: "生成项目周报摘要" } });
		fireEvent.click(screen.getByRole("button", { name: "提出协作任务" }));
		await waitFor(() => expect(mocks.collaborationPropose).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-ui", agentRef: { type: "personal-buddy", id: "buddy" }, contextRefs: ["project:project-ui:instructions", "project:project-ui:selected-resources"] })));
		expect(useProjectsStore.getState().projects[0].tasks).toEqual([expect.objectContaining({ title: "整理项目周报", source: "buddy", collaborationTaskId: "buddy-task-ui", executionRef: expect.objectContaining({ executionId: "execution:buddy-task-ui", workflowId: "workflow:buddy-task-ui" }) })]);
	});

	it("shows the canonical execution trace and verification projection", async () => {
		mocks.collaborationSnapshot.mockResolvedValueOnce({
			...mocks.collaborationSnapshot.mock.results[0]?.value,
			tasks: [{ taskId: "buddy-task-ui", status: "accepted", title: "整理项目周报", projectId: "project-ui", updatedAt: "2026-08-30T12:00:00.000Z", mode: "personal", executionRef: { executionId: "execution:buddy-task-ui", taskId: "buddy-task-ui", workflowId: "workflow:buddy-task-ui", stepId: "step:buddy-task-ui:root", sessionId: "pi-session-ui" } }],
			activity: [{ id: "evidence-ui", kind: "task.evidence_verified", taskId: "buddy-task-ui", subject: "Buddy 交付已验证", createdAt: "2026-08-30T12:01:00.000Z", executionRef: { executionId: "execution:buddy-task-ui", taskId: "buddy-task-ui", sessionId: "pi-session-ui" } }],
		});
		render(<ProjectCollaborationTab projectId="project-ui" projectName="UI 项目" />);
		await waitFor(() => expect(screen.getByText("执行 execution:buddy-task-ui")).toBeInTheDocument());
		expect(screen.getByText("Pi pi-session-ui")).toBeInTheDocument();
		expect(screen.getByText("已独立验收")).toBeInTheDocument();
	});

	it("routes a project workflow to an active organization Buddy", async () => {
		mocks.collaborationSnapshot.mockResolvedValue({
			...await mocks.collaborationSnapshot(),
			identity: { id: "personal-buddy", handle: "personal", displayName: "Personal Buddy", ownerUserId: "user", trustLevel: "local", status: "idle" },
			organization: { id: "org", members: [{ identity: { id: "org-buddy", handle: "writer", displayName: "Writer Buddy", ownerUserId: "user-2", organizationId: "org", trustLevel: "org", status: "idle" }, role: "member", joinedAt: "2026-08-30T12:00:00.000Z", active: true }], delegations: [], approvals: [], taskControls: [] },
		});
		render(<ProjectCollaborationTab projectId="project-ui" projectName="UI 项目" />);
		await waitFor(() => expect(screen.getByLabelText("项目工作流标题")).toBeInTheDocument());
		fireEvent.change(screen.getByLabelText("项目工作流标题"), { target: { value: "项目周报" } });
		fireEvent.change(screen.getByLabelText("项目准备节点目标"), { target: { value: "汇总项目进展" } });
		fireEvent.change(screen.getByLabelText("项目交付节点目标"), { target: { value: "生成周报" } });
		fireEvent.change(screen.getByLabelText("工作流 Buddy 类型"), { target: { value: "organization" } });
		await waitFor(() => expect(screen.getByLabelText("项目准备节点 Buddy")).toHaveValue("org-buddy"));
		fireEvent.change(screen.getByLabelText("项目交付节点 Buddy"), { target: { value: "org-buddy" } });
		fireEvent.click(screen.getByRole("button", { name: "提出项目工作流" }));
		await waitFor(() => expect(mocks.collaborationWorkflowPropose).toHaveBeenCalledWith(expect.objectContaining({ mode: "organization", projectId: "project-ui", nodes: expect.arrayContaining([expect.objectContaining({ agentRef: { type: "organization-buddy", id: "org-buddy" } })]) })));
	});
});
