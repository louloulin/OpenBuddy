import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SearchOverlay } from "@openbuddy/ui-workbench";
import { useSessionsStore } from "@/stores/sessions-store";
import { useProjectsStore } from "@/stores/projects-store";

const mocks = vi.hoisted(() => ({
  sessionSearch: vi.fn(),
  emailListThreadsPage: vi.fn(),
  emailListWorkspaceTags: vi.fn(),
  tasksListForSession: vi.fn(),
  calendarList: vi.fn(),
  collaborationSnapshot: vi.fn(),
  searchStoredKnowledge: vi.fn(),
  // assistant-facade re-exports collaborationOnUpdate; the component uses
  // it for live updates, so the mock must include it.
  collaborationOnUpdate: vi.fn(),
}));

vi.mock(import("@/lib/agent/pi-client"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ...mocks };
});
vi.mock("@/lib/files/knowledge-base-runtime", () => ({ searchStoredKnowledge: mocks.searchStoredKnowledge }));

beforeEach(() => {
  vi.clearAllMocks();
  useSessionsStore.setState({ independent: [], workspaceSessions: {} });
  useProjectsStore.setState({ projects: [], activeProjectId: null });
  mocks.sessionSearch.mockResolvedValue([]);
  mocks.emailListThreadsPage.mockResolvedValue({ items: [] });
  mocks.emailListWorkspaceTags.mockResolvedValue([]);
  mocks.tasksListForSession.mockResolvedValue([]);
  mocks.calendarList.mockResolvedValue([]);
  mocks.collaborationSnapshot.mockResolvedValue({ inbox: [] });
  mocks.searchStoredKnowledge.mockResolvedValue([]);
});

describe("SearchOverlay unified search", () => {
  it("searches email alongside sessions and opens the selected thread", async () => {
    const onSelectEmail = vi.fn();
    mocks.emailListThreadsPage.mockResolvedValue({ items: [{ id: "thread-1", accountId: "gmail:a1", subject: "客户报价", snippet: "请确认报价", from: { address: "customer@example.com" }, date: "2026-08-30T10:00:00.000Z", messageCount: 1, unread: true, labels: [], tags: ["客户"] }] });
    render(<SearchOverlay open onClose={vi.fn()} onSelect={vi.fn()} onSelectEmail={onSelectEmail} />);
    fireEvent.change(screen.getByPlaceholderText("搜索会话标题或内容…"), { target: { value: "报价" } });
    await waitFor(() => expect(mocks.emailListThreadsPage).toHaveBeenCalledWith({ query: "报价", limit: 20 }), { timeout: 1000 });
    expect(await screen.findByText("邮件结果 (1)")).toBeInTheDocument();
    expect(screen.getByText("客户报价")).toBeInTheDocument();
    fireEvent.click(screen.getByText("客户报价"));
    expect(onSelectEmail).toHaveBeenCalledWith("gmail:a1", "thread-1");
  });

  it("ranks email subject matches before weaker body matches and exposes thread state", async () => {
    mocks.emailListThreadsPage.mockResolvedValue({ items: [
      { id: "body-hit", accountId: "gmail:a1", subject: "普通通知", snippet: "报价出现在正文中", from: { address: "sender@example.com" }, date: "2026-08-30T11:00:00.000Z", messageCount: 1, unread: false, labels: [] },
      { id: "subject-hit", accountId: "gmail:a1", subject: "报价确认", snippet: "请查看", from: { address: "sender@example.com" }, date: "2026-08-30T09:00:00.000Z", messageCount: 2, unread: true, starred: true, labels: [], tags: ["客户"] },
    ] });
    render(<SearchOverlay open onClose={vi.fn()} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("搜索会话标题或内容…"), { target: { value: "报价" } });
    await waitFor(() => expect(screen.getByText("邮件结果 (2)")).toBeInTheDocument());
    const results = screen.getAllByRole("button", { name: /报价|普通通知/ });
    expect(results[0]).toHaveTextContent("报价确认");
    expect(results[0]).toHaveTextContent("未读");
    expect(results[0]).toHaveTextContent("星标");
  });

  it("keeps session search usable when email provider is unavailable", async () => {
    mocks.emailListThreadsPage.mockRejectedValue(new Error("mail unavailable"));
    mocks.sessionSearch.mockResolvedValue([{ sessionId: "s1", title: "报价会话", snippet: "session result" }]);
    render(<SearchOverlay open onClose={vi.fn()} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("搜索会话标题或内容…"), { target: { value: "报价" } });
    expect(await screen.findByText("报价会话")).toBeInTheDocument();
    expect(screen.queryByText(/邮件结果/)).not.toBeInTheDocument();
  });

  it("searches current-session tasks and calendar events without widening task scope", async () => {
    mocks.tasksListForSession.mockResolvedValue([{ id: "task-1", description: "跟进报价", status: "pending", createdAt: "2026-08-30T09:00:00.000Z", updatedAt: "2026-08-30T09:00:00.000Z", order: 0 }]);
    mocks.calendarList.mockResolvedValue([{ id: "event-1", title: "报价评审", start: "2026-08-31T10:00:00.000Z", end: "2026-08-31T11:00:00.000Z", allDay: false, status: "confirmed", roomId: "personal-room", contextRefs: [], attendees: [], createdAt: "2026-08-30T09:00:00.000Z", updatedAt: "2026-08-30T09:00:00.000Z" }]);
    render(<SearchOverlay open onClose={vi.fn()} onSelect={vi.fn()} currentSessionId="session-1" onSelectCalendar={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("搜索会话标题或内容…"), { target: { value: "报价" } });
    await waitFor(() => expect(mocks.tasksListForSession).toHaveBeenCalledWith("session-1"), { timeout: 1000 });
    expect(await screen.findByText("当前会话任务 (1)")).toBeInTheDocument();
    expect(screen.getByText("日程 (1)")).toBeInTheDocument();
    expect(screen.getByText("跟进报价")).toBeInTheDocument();
    expect(screen.getByText("报价评审")).toBeInTheDocument();
  });

  it("searches local projects and assistant inbox items", async () => {
    useProjectsStore.setState({ projects: [{ id: "project-1", name: "客户报价项目", tags: ["重点客户"], createdAt: "2026-08-30T09:00:00.000Z", connectors: [], experts: [], skills: [], plans: [], tasks: [{ id: "task-1", title: "跟进报价", scope: "personal", source: "email", status: "pending", tags: ["邮件"] }], assets: [{ id: "asset-1", name: "报价单.pdf", kind: "file" }], dataSources: [], members: [], activities: [], conversations: [] }] });
    mocks.collaborationSnapshot.mockResolvedValue({ inbox: [{ id: "inbox-1", kind: "email", title: "待处理报价", summary: "客户等待报价确认", createdAt: "2026-08-30T09:00:00.000Z", read: false, eventId: "event-1", source: "email", emailAccountId: "gmail:a1", emailThreadId: "thread-1" }] });
    const onSelectProject = vi.fn();
    const onSelectEmail = vi.fn();
    render(<SearchOverlay open onClose={vi.fn()} onSelect={vi.fn()} onSelectProject={onSelectProject} onSelectEmail={onSelectEmail} />);
    fireEvent.change(screen.getByPlaceholderText("搜索会话标题或内容…"), { target: { value: "报价" } });
    expect(await screen.findByText("项目与资料 (1)")).toBeInTheDocument();
    expect(screen.getByText("助理收件箱 (1)")).toBeInTheDocument();
    fireEvent.click(screen.getByText("客户报价项目"));
    expect(onSelectProject).toHaveBeenCalledWith("project-1");
    fireEvent.click(screen.getByText("待处理报价"));
    expect(onSelectEmail).toHaveBeenCalledWith("gmail:a1", "thread-1");
  });

  it("finds a project by a workspace tag and displays the tag", async () => {
    useProjectsStore.setState({ projects: [{ id: "project-tagged", name: "客户项目", tags: ["重点客户"], createdAt: "2026-08-30T09:00:00.000Z", connectors: [], experts: [], skills: [], plans: [], tasks: [], assets: [], dataSources: [], members: [], activities: [], conversations: [] }] });
    render(<SearchOverlay open onClose={vi.fn()} onSelect={vi.fn()} onSelectProject={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("搜索会话标题或内容…"), { target: { value: "重点客户" } });
    expect(await screen.findByText("项目与资料 (1)")).toBeInTheDocument();
    expect(screen.getByText("客户项目")).toBeInTheDocument();
    expect(screen.getByText(/标签：重点客户/)).toBeInTheDocument();
  });

  it("searches email threads by OpenBuddy workspace tag and merges duplicate results", async () => {
    mocks.emailListWorkspaceTags.mockResolvedValue([{ id: "tag-1", name: "重点客户", color: "#ffcc66", scope: "personal", createdAt: "2026-08-30T09:00:00.000Z" }]);
    mocks.emailListThreadsPage
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ id: "thread-tag", accountId: "gmail:a1", subject: "客户跟进", snippet: "标签命中", from: { address: "customer@example.com" }, date: "2026-08-30T10:00:00.000Z", messageCount: 1, unread: true, labels: [], tags: ["重点客户"] }] });
    const onSelectEmail = vi.fn();
    render(<SearchOverlay open onClose={vi.fn()} onSelect={vi.fn()} onSelectEmail={onSelectEmail} />);
    fireEvent.change(screen.getByPlaceholderText("搜索会话标题或内容…"), { target: { value: "重点客户" } });
    expect(await screen.findByText("邮件结果 (1)")).toBeInTheDocument();
    expect(screen.getByText("客户跟进")).toBeInTheDocument();
    expect(mocks.emailListThreadsPage).toHaveBeenNthCalledWith(2, { tags: ["重点客户"], tagMatch: "any", limit: 20 });
    fireEvent.click(screen.getByText("客户跟进"));
    expect(onSelectEmail).toHaveBeenCalledWith("gmail:a1", "thread-tag");
  });

  it("searches persisted knowledge documents and returns the source path", async () => {
    const onSelectKnowledge = vi.fn();
    mocks.searchStoredKnowledge.mockResolvedValue([{ id: "/docs/customer.md", title: "客户合同.md", snippet: "合同条款", source: "local", url: "/docs/customer.md" }]);
    render(<SearchOverlay open onClose={vi.fn()} onSelect={vi.fn()} onSelectKnowledge={onSelectKnowledge} />);
    fireEvent.change(screen.getByPlaceholderText("搜索会话标题或内容…"), { target: { value: "合同" } });
    await waitFor(() => expect(screen.getByText("知识库文档 (1)")).toBeInTheDocument());
    expect(screen.getByText("客户合同.md")).toBeInTheDocument();
    fireEvent.click(screen.getByText("客户合同.md"));
    expect(onSelectKnowledge).toHaveBeenCalledWith("/docs/customer.md", "/docs/customer.md");
  });
});
