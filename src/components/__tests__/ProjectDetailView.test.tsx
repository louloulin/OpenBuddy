import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectDetailView } from "@openbuddy/ui-workbench";
import { useProjectsStore } from "@/stores/projects-store";

const mocks = vi.hoisted(() => ({
  emailListProjectThreads: vi.fn(),
  // @/lib/agent/pi-client now exposes collaborationOnUpdate via the
  // assistant-facade. The component under test imports it through the
  // facade, so a mock without it makes `useAssistantFacade()` throw.
  collaborationOnUpdate: vi.fn(),
}));

vi.mock(import("@/lib/agent/pi-client"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ...mocks };
});
vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({ useRendererContributions: () => [] }));
vi.mock("../shared/project-picker", () => ({
  ConfigRow: () => null,
  RefPickerDialog: () => null,
  useLiveProjectPickerOptions: () => ({ connectors: [], experts: [], skills: [] }),
}));
vi.mock("../shared/project-tabs", () => ({
  ActivityTab: () => <div>动态内容</div>,
  PlanTab: () => <div>计划内容</div>,
  TaskTab: () => <div>任务内容</div>,
  AssetsTab: () => <div>资产内容</div>,
}));
vi.mock("../workbench/ProjectCollaborationTab", () => ({ ProjectCollaborationTab: () => <div>协作内容</div> }));
vi.mock("@openbuddy/ui-automation", () => ({ AutomationPanel: () => <div>自动化内容</div> }));
vi.mock("@openbuddy/ui-dialogs", () => ({ ProjectInputDialog: () => null }));
vi.mock("../workbench/RendererContributionView", () => ({ RendererContributionView: () => null }));
vi.mock("@openbuddy/ui-primitives/icons", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    // Replace only the icons the test asserts on with deterministic
    // spans; everything else passes through to the real module so
    // transitive imports (MarketHeader, etc.) resolve.
    FolderIcon: () => <span aria-hidden="true" />,
    ChevronDownIcon: () => <span aria-hidden="true" />,
  };
});

const project = {
  id: "project-mail",
  name: "客户项目",
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
  localStorage.clear();
  useProjectsStore.setState({ projects: [project], activeProjectId: null });
  mocks.emailListProjectThreads.mockResolvedValue([
    {
      accountId: "account-work",
      threadId: "thread-proposal",
      projectId: "project-mail",
      subject: "客户报价确认",
      from: { address: "customer@example.com", name: "客户" },
      date: "2026-08-30T10:00:00.000Z",
      unread: true,
      messageCount: 2,
      tags: ["重点客户", "本周"],
    },
  ]);
});

describe("ProjectDetailView 邮件页签", () => {
  it("反查项目邮件并回到原邮件线程", async () => {
    const onNavigate = vi.fn();
    render(<ProjectDetailView project={project} onBack={vi.fn()} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "邮件" }));
    await waitFor(() => expect(mocks.emailListProjectThreads).toHaveBeenCalledWith("project-mail"));
    const thread = await screen.findByRole("button", { name: /客户报价确认/ });
    expect(screen.getByText("重点客户")).toBeInTheDocument();
    expect(screen.getByText("本周")).toBeInTheDocument();

    fireEvent.click(thread);

    expect(JSON.parse(localStorage.getItem("openbuddy.email.inbox-target") ?? "{}")).toEqual({
      accountId: "account-work",
      threadId: "thread-proposal",
    });
    expect(onNavigate).toHaveBeenCalledWith("邮件");
  });

  it("显示无关联邮件空态并支持打开邮件工作区", async () => {
    mocks.emailListProjectThreads.mockResolvedValueOnce([]);
    const onNavigate = vi.fn();
    render(<ProjectDetailView project={project} onBack={vi.fn()} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "邮件" }));
    expect(await screen.findByText("暂无关联邮件，可在邮件线程中选择“关联项目”。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开邮件" }));
    expect(onNavigate).toHaveBeenCalledWith("邮件");
  });
});
