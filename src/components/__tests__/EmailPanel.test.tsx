import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EmailPanel } from "@openbuddy/ui-email";
import { useProjectsStore } from "@/stores/projects-store";

const account = { id: "a1", address: "me@example.com", provider: "mcp" as const, status: "connected" as const, capabilities: { read: true, write: true, attachments: true, multipleAccounts: true } };
const secondAccount = { ...account, id: "a2", address: "work@example.com" };
const threads = [
  { id: "t1", accountId: "a1", subject: "重要客户", snippet: "请确认报价", from: { address: "customer@example.com", name: "客户" }, date: "2026-08-30T10:00:00.000Z", messageCount: 2, unread: true, starred: true, labels: ["IMPORTANT"] },
  { id: "t2", accountId: "a2", subject: "促销邮件", snippet: "优惠信息", from: { address: "promo@example.com" }, date: "2026-08-30T09:00:00.000Z", messageCount: 1, unread: false, labels: [] },
];

const mocks = vi.hoisted(() => ({
  emailListAccounts: vi.fn(), emailProviderDiagnostics: vi.fn(), emailListRules: vi.fn(), emailListProcessingPlans: vi.fn(), emailSaveRule: vi.fn(), emailDeleteRule: vi.fn(), emailRunRule: vi.fn(), emailSync: vi.fn(), emailListSyncStates: vi.fn(), emailTriage: vi.fn(), emailPrepareProcessingPlan: vi.fn(), emailConfirmProcessingPlan: vi.fn(), emailExecuteProcessingPlan: vi.fn(), emailCancelProcessingPlan: vi.fn(), emailListDrafts: vi.fn(), emailListScheduledSends: vi.fn(), emailCancelScheduledSend: vi.fn(), emailListPendingSends: vi.fn(), emailCancelPendingSend: vi.fn(), emailListThreadsPage: vi.fn(), emailReplyZero: vi.fn(), emailDigest: vi.fn(), emailListLabels: vi.fn(), emailListWorkspaceTags: vi.fn(), emailGetThread: vi.fn(), emailUpdateThread: vi.fn(), emailUnsubscribe: vi.fn(), emailSetSenderPolicy: vi.fn(), emailShareThread: vi.fn(), emailCreateFollowup: vi.fn(), emailMoveToProject: vi.fn(), emailDownloadAttachment: vi.fn(), emailCreateDraft: vi.fn(), emailPrepareSend: vi.fn(), emailQueueSend: vi.fn(), emailSendDraft: vi.fn(), emailListAnalyses: vi.fn(), emailSaveAnalysis: vi.fn(), emailReviewAnalysis: vi.fn(), emailLinkAnalysis: vi.fn(), emailCreateRemindersFromAnalysis: vi.fn(), emailActionCenterCreateReminders: vi.fn(), tasksAddForSession: vi.fn(),
  emailListRegistryConnections: vi.fn(), emailRegistryReadiness: vi.fn(), emailSetRegistryEnabled: vi.fn(), emailReauthorizeRegistryConnection: vi.fn(), emailRegisterRegistryConnection: vi.fn(), emailRemoveRegistryConnection: vi.fn(), emailRegistryDiagnostics: vi.fn(),
  mcpList: vi.fn(), mcpAuthTrigger: vi.fn(), searchStoredKnowledge: vi.fn(),
}));

const assistantMocks = vi.hoisted(() => ({
  propose: vi.fn(),
  requestApproval: vi.fn(),
}));

vi.mock("@/lib/agent/pi-client", () => mocks);
vi.mock("@/lib/agent/assistant-facade", () => ({ assistantFacade: assistantMocks }));
vi.mock("@/lib/files/knowledge-base-runtime", () => ({ searchStoredKnowledge: mocks.searchStoredKnowledge }));
vi.mock("@/lib/platform/electron-api", () => ({ open: vi.fn(async () => null) }));

import { useToastStore } from "@/stores/toast-store";

beforeEach(() => {
  vi.clearAllMocks();
  useProjectsStore.setState({ projects: [], activeProjectId: null });
  mocks.emailListRegistryConnections.mockResolvedValue([]);
  mocks.emailRegistryReadiness.mockResolvedValue([]);
  mocks.emailListAccounts.mockResolvedValue([account, secondAccount]);
  mocks.emailProviderDiagnostics.mockResolvedValue(null);
  mocks.emailListRules.mockResolvedValue([]);
  mocks.emailListProcessingPlans.mockResolvedValue([]);
  mocks.emailSaveRule.mockImplementation(async (input: Record<string, unknown>) => ({ id: input.id ?? "rule-1", name: input.name, enabled: input.enabled !== false, condition: input.condition ?? {}, actions: input.actions ?? [], createdAt: "2026-08-30T10:00:00.000Z", updatedAt: "2026-08-30T10:00:00.000Z" }));
  mocks.emailListSyncStates.mockResolvedValue([]);
  mocks.emailTriage.mockResolvedValue({ generatedAt: "2026-08-30T10:00:00.000Z", total: 2, items: [], counts: { urgent: 0, "needs-reply": 0, "waiting-for-reply": 0, noise: 0, normal: 2 } });
  mocks.emailPrepareProcessingPlan.mockResolvedValue({ id: "plan-1", status: "pending", operations: [], previews: [], createdAt: "2026-08-30T10:00:00.000Z", expiresAt: "2026-08-30T10:05:00.000Z" });
  mocks.emailConfirmProcessingPlan.mockResolvedValue("email-plan:test");
  mocks.emailExecuteProcessingPlan.mockResolvedValue({ id: "plan-1", status: "executed", operations: [], previews: [], result: [], createdAt: "2026-08-30T10:00:00.000Z", expiresAt: "2026-08-30T10:05:00.000Z" });
  mocks.emailCancelProcessingPlan.mockResolvedValue({ id: "plan-1", status: "cancelled", operations: [], previews: [], createdAt: "2026-08-30T10:00:00.000Z", expiresAt: "2026-08-30T10:05:00.000Z" });
  mocks.emailListDrafts.mockResolvedValue([]);
  mocks.emailListScheduledSends.mockResolvedValue([]);
  mocks.emailListPendingSends.mockResolvedValue([]);
  mocks.emailListThreadsPage.mockResolvedValue({ items: threads });
  mocks.emailReplyZero.mockResolvedValue({ generatedAt: "2026-08-30T10:00:00.000Z", items: [], needsReply: [], waitingForReply: [], noAction: [] });
  mocks.emailDigest.mockResolvedValue({ generatedAt: "2026-08-30T10:00:00.000Z", total: 2, unread: 1, needsReply: [], waitingForReply: [], highlights: [] });
  mocks.emailListLabels.mockResolvedValue([{ id: "important", name: "IMPORTANT", system: true }]);
  mocks.emailListWorkspaceTags.mockResolvedValue([]);
  mocks.emailGetThread.mockResolvedValue({ id: "t1", accountId: "a1", subject: "重要客户", labels: ["IMPORTANT"], messages: [{ id: "m1", threadId: "t1", from: { address: "customer@example.com", name: "客户" }, to: [{ address: "me@example.com" }], cc: [], subject: "重要客户", date: "2026-08-30T10:00:00.000Z", text: "请确认报价", unread: true, attachments: [] }] });
  mocks.emailUpdateThread.mockResolvedValue({ ok: true, provider: "fake", operation: "archive" });
  mocks.emailListAnalyses.mockResolvedValue([]);
  mocks.emailSaveAnalysis.mockResolvedValue({ id: "placeholder", kind: "summary" });
  mocks.emailReviewAnalysis.mockResolvedValue({ id: "placeholder", kind: "summary", review: "accepted" });
  mocks.emailLinkAnalysis.mockResolvedValue({ id: "placeholder", kind: "summary", review: "accepted" });
  mocks.emailMoveToProject.mockResolvedValue({ ok: true, provider: "openbuddy-local", operation: "move-to-project" });
  assistantMocks.propose.mockResolvedValue({ taskId: "calendar-task-1" });
  assistantMocks.requestApproval.mockResolvedValue({ ok: true });
  mocks.emailCreateRemindersFromAnalysis.mockResolvedValue({ analysis: { id: "placeholder", kind: "actions", review: "accepted", actions: [], facts: [], risks: [] }, reminders: [] });
  mocks.emailActionCenterCreateReminders.mockResolvedValue({ generatedAt: "2026-08-30T10:01:00.000Z", dryRun: true, requiresConfirmation: true, matchedAnalysisCount: 0, matchedActionCount: 0, created: [], skipped: [] });
  mocks.tasksAddForSession.mockImplementation(async (_sessionId: string, content: string) => ({ id: `task-${content.slice(-4)}`, content, status: "pending", createdAt: "2026-08-30T10:00:00.000Z", updatedAt: "2026-08-30T10:00:00.000Z", order: 0 }));
  mocks.emailSetSenderPolicy.mockResolvedValue({ ok: true });
  mocks.emailShareThread.mockResolvedValue({ ok: true });
  mocks.emailCreateFollowup.mockResolvedValue({ ok: true });
  mocks.mcpList.mockResolvedValue([]);
  mocks.searchStoredKnowledge.mockResolvedValue([]);
});

it("confirms provider unsubscribe without opening message links", async () => {
  mocks.emailListAccounts.mockResolvedValueOnce([{ ...account, capabilities: { ...account.capabilities, management: true, managementOperations: ["unsubscribe"] } }]);
  mocks.emailGetThread.mockResolvedValueOnce({ id: "t1", accountId: "a1", subject: "促销", labels: [], messages: [{ id: "m1", threadId: "t1", from: { address: "promo@example.com" }, to: [], cc: [], subject: "促销", date: "2026-08-30T10:00:00.000Z", text: "优惠", unread: true, attachments: [], unsubscribeLinks: ["https://example.com/unsubscribe"] }] });
  mocks.emailUnsubscribe.mockResolvedValue({ ok: true, provider: "gmail", operation: "unsubscribe", method: "list-unsubscribe" });
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  render(<EmailPanel onToast={vi.fn()} />);
  await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
  fireEvent.click(screen.getByText("重要客户"));
  await waitFor(() => expect(screen.getByRole("button", { name: "退订邮件列表" })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "退订邮件列表" }));
  await waitFor(() => expect(screen.getByRole("alertdialog", { name: "退订邮件列表" })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "退订" }));
  await waitFor(() => expect(mocks.emailUnsubscribe).toHaveBeenCalledWith({ accountId: "a1", messageId: "m1", threadId: "t1", confirmed: true }));
  expect(open).not.toHaveBeenCalled();
  open.mockRestore();
});

describe("EmailPanel", () => {
  it("shows the connected accounts and unified inbox", async () => {
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    expect(screen.getByRole("option", { name: "全部账户（统一收件箱）" })).toBeInTheDocument();
    expect(screen.getByText("促销邮件")).toBeInTheDocument();
    expect(mocks.emailListThreadsPage).toHaveBeenCalledWith(expect.objectContaining({ accountId: undefined, folder: "inbox" }));
  });

  it("shows account-level capabilities for a composite provider", async () => {
    mocks.emailProviderDiagnostics.mockResolvedValueOnce({
      provider: "mcp:multi",
      serverName: "gmail, outlook",
      profile: "composite",
      toolDiscovery: "discovered",
      discoveredTools: ["list_emails"],
      accounts: [
        { id: "gmail:a1", address: "me@example.com", status: "connected", provider: "gmail", capabilities: { read: true, write: true, attachments: true, multipleAccounts: true, management: true, sync: true } },
        { id: "outlook:a2", address: "work@example.com", status: "connected", provider: "outlook", capabilities: { read: true, write: false, attachments: false, multipleAccounts: true, management: false, sync: false } },
      ],
      operations: [],
      availableCapabilities: ["邮件读取"],
      missingCapabilities: ["发送邮件"],
      readiness: "partial",
    });
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("me@example.com：可写 · 管理 · 附件 · 同步")).toBeInTheDocument());
    expect(screen.getByText("work@example.com：只读")).toBeInTheDocument();
  });

  it("explains provider operation readiness and links to connector settings", async () => {
    const onNavigate = vi.fn();
    mocks.emailProviderDiagnostics.mockResolvedValueOnce({
      provider: "mcp:gmail",
      serverName: "gmail",
      profile: "gmail",
      toolDiscovery: "discovered",
      discoveredTools: ["list_emails"],
      accounts: [],
      operations: [
        { name: "邮件读取", ready: true, requiredTools: ["list_emails"], missingTools: [] },
        { name: "受控发送", ready: false, requiredTools: ["send_email"], missingTools: ["send_email"] },
      ],
      availableCapabilities: ["邮件读取"],
      missingCapabilities: ["发送邮件"],
      readiness: "partial",
    });
    render(<EmailPanel onToast={vi.fn()} onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByText("邮箱能力部分可用")).toBeInTheDocument());
    fireEvent.click(screen.getByText("查看逐项能力"));
    expect(screen.getByText(/邮件读取/)).toBeInTheDocument();
    expect(screen.getByText(/受控发送/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "配置邮箱连接器" }));
    expect(onNavigate).toHaveBeenCalledWith("专家·技能·连接器");
  });

  it("resolves a project number when associating an email thread", async () => {
    useProjectsStore.setState({ projects: [{ id: "project-1", name: "客户报价项目", createdAt: "2026-08-30T09:00:00.000Z", connectors: [], experts: [], skills: [], plans: [], tasks: [], assets: [], dataSources: [], members: [], activities: [], conversations: [] }] });
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByText("重要客户"));
    await waitFor(() => expect(screen.getByRole("button", { name: "关联项目" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "关联项目" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "关联邮件到项目" })).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("项目编号或项目 ID"), { target: { value: "1" } });
    const projectButtons = screen.getAllByRole("button", { name: "关联项目" });
    fireEvent.click(projectButtons[projectButtons.length - 1]);
    await waitFor(() => expect(mocks.emailMoveToProject).toHaveBeenCalledWith({ accountId: "a1", threadId: "t1", projectId: "project-1" }));
  });

  it("passes advanced search filters and saves reusable presets", async () => {
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "高级筛选" }));
    fireEvent.change(screen.getByRole("textbox", { name: "发件人筛选" }), { target: { value: "customer@example.com" } });
    fireEvent.change(screen.getByRole("combobox", { name: "未读筛选" }), { target: { value: "unread" } });
    fireEvent.change(screen.getByRole("combobox", { name: "附件筛选" }), { target: { value: "with" } });
    fireEvent.click(screen.getByRole("button", { name: "保存预设" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "保存搜索预设" })).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("预设名称"), { target: { value: "客户未读附件" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("openbuddy.email.search-presets") ?? "[]")).toEqual([expect.objectContaining({ name: "客户未读附件", filters: { from: "customer@example.com", unread: true, hasAttachment: true } })]));
    await waitFor(() => expect(mocks.emailListThreadsPage).toHaveBeenCalledWith(expect.objectContaining({ from: "customer@example.com", unread: true, hasAttachment: true })));
  });

  it("keeps unified-inbox selections isolated by account", async () => {
    mocks.emailListThreadsPage.mockResolvedValueOnce({ items: [threads[0], { ...threads[1], id: "t1", subject: "另一个账户同 ID" }] });
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("另一个账户同 ID")).toBeInTheDocument());
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    expect(screen.getByText("已选 2")).toBeInTheDocument();
    fireEvent.click(screen.getByText("预览归档"));
    await waitFor(() => expect(mocks.emailUpdateThread).toHaveBeenCalledWith(expect.objectContaining({ accountId: "a1", threadIds: ["t1"] })));
    await waitFor(() => expect(mocks.emailUpdateThread).toHaveBeenCalledWith(expect.objectContaining({ accountId: "a2", threadIds: ["t1"] })));
  });

  it("supports Macro-style keyboard triage and the two-key compose chord", async () => {
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());

    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(mocks.emailGetThread).toHaveBeenCalledWith("a2", "t2"));

    fireEvent.keyDown(window, { key: "c" });
    fireEvent.keyDown(window, { key: "e" });
    expect(screen.getByRole("dialog", { name: "撰写邮件" })).toBeInTheDocument();
  });

  it("archives the selected thread with the e shortcut", async () => {
    mocks.emailGetThread.mockResolvedValueOnce({ ...threads[0], messages: [{ id: "m1", threadId: "t1", from: threads[0].from, to: [{ address: "me@example.com" }], cc: [], subject: threads[0].subject, date: threads[0].date, text: threads[0].snippet, unread: true, attachments: [] }] });
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByText("重要客户"));
    await waitFor(() => expect(screen.getByRole("button", { name: "归档" })).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "e" });
    await waitFor(() => expect(mocks.emailUpdateThread).toHaveBeenCalledWith(expect.objectContaining({ accountId: "a1", threadId: "t1", kind: "archive" })));
  });

  it("exposes structured Reply Zero and digest actions", async () => {
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "待我回复" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "待我回复" }));
    await waitFor(() => expect(mocks.emailReplyZero).toHaveBeenCalledWith({ accountId: undefined, limit: 50 }));
    fireEvent.click(screen.getByRole("button", { name: "今日简报" }));
    await waitFor(() => expect(mocks.emailDigest).toHaveBeenCalledWith({ accountId: undefined, limit: 50 }));
  });

  it("opens the AI email action center and returns to the source thread", async () => {
    mocks.emailListAnalyses.mockResolvedValueOnce([
      { id: "analysis-actions", accountId: "a1", threadId: "t1", kind: "actions", generatedAt: "2026-08-30T10:01:00.000Z", summary: "确认客户报价", facts: [], actions: [{ content: "确认报价", citations: [{ messageId: "m1" }] }], risks: [], confidence: 0.92, needsReview: true, review: "pending" },
      { id: "analysis-reply", accountId: "a2", threadId: "t2", kind: "reply", generatedAt: "2026-08-30T10:00:00.000Z", summary: "建议回复促销邮件", facts: [], actions: [], risks: [], replyDraft: { subject: "Re: 促销邮件", body: "谢谢", citations: [{ messageId: "m2" }] }, confidence: 0.8, needsReview: true, review: "pending" },
    ]);
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "AI 行动中心" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "AI 邮件行动中心" })).toBeInTheDocument());
    const center = screen.getByRole("region", { name: "AI 邮件行动中心" });
    expect(center).toHaveTextContent("2");
    expect(center).toHaveTextContent("确认客户报价");
    expect(center).toHaveTextContent("回复草稿");
    fireEvent.click(screen.getByRole("button", { name: /行动项 · t1/ }));
    await waitFor(() => expect(mocks.emailGetThread).toHaveBeenCalledWith("a1", "t1"));
    expect(screen.queryByRole("region", { name: "AI 邮件行动中心" })).toBeNull();
  });

  it("runs read-only AI triage and renders the category summary", async () => {
    mocks.emailTriage.mockResolvedValueOnce({ generatedAt: "2026-08-30T10:00:00.000Z", total: 2, items: [{ accountId: "a1", threadId: "t1", subject: "重要客户", sender: { address: "customer@example.com" }, date: "2026-08-30T10:00:00.000Z", category: "urgent", score: 90, reasons: ["待我回复"], unread: true, labels: ["IMPORTANT"] }, { accountId: "a2", threadId: "t2", subject: "促销邮件", sender: { address: "promo@example.com" }, date: "2026-08-30T09:00:00.000Z", category: "noise", score: 10, reasons: ["促销标签"], unread: false, labels: [] }], counts: { urgent: 1, "needs-reply": 0, "waiting-for-reply": 0, noise: 1, normal: 0 } });
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "AI 分诊" }));
    await waitFor(() => expect(mocks.emailTriage).toHaveBeenCalledWith({ accountId: undefined, limit: 50 }));
    const triage = screen.getByRole("region", { name: "AI 邮件分诊结果" });
    expect(triage).toHaveTextContent("紧急 1");
    fireEvent.click(screen.getByRole("button", { name: "紧急 1" }));
    expect(screen.getByText("重要客户")).toBeInTheDocument();
    expect(screen.queryByText("促销邮件")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "显示全部" }));
    expect(screen.getByText("促销邮件")).toBeInTheDocument();
  });

  it("restores a queue of pending processing plans with a count badge", async () => {
    const firstPlan = { id: "plan-first", status: "pending" as const, operations: [{ accountId: "a1", threadIds: ["t1"], kind: "archive" as const }], previews: [], createdAt: "2026-08-30T10:02:00.000Z", expiresAt: "2026-08-30T10:05:00.000Z" };
    const secondPlan = { id: "plan-second", status: "pending" as const, operations: [{ accountId: "a2", threadIds: ["t2", "t3"], kind: "mark-read" as const }], previews: [], createdAt: "2026-08-30T10:01:00.000Z", expiresAt: "2026-08-30T10:04:00.000Z" };
    mocks.emailListProcessingPlans.mockResolvedValueOnce([secondPlan, firstPlan]);
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "待确认计划（2）" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "待确认计划（2）" }));
    expect(screen.getByRole("region", { name: "邮件处理计划预览" })).toHaveTextContent("将处理 1 个线程");
    expect(screen.getByRole("button", { name: /计划 n-second/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /计划 n-second/ }));
    expect(screen.getByRole("region", { name: "邮件处理计划预览" })).toHaveTextContent("将处理 2 个线程");
    expect(mocks.emailConfirmProcessingPlan).not.toHaveBeenCalled();
  });

  it("opens a thread, switches Signal/Noise and exposes Macro actions", async () => {
    render(<EmailPanel onToast={vi.fn()} onLaunch={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Signal"));
    expect(screen.getByText("重要客户")).toBeInTheDocument();
    fireEvent.click(screen.getByText("重要客户"));
    await waitFor(() => expect(screen.getByText("请确认报价")).toBeInTheDocument());
    expect(screen.getByText("回复全部")).toBeInTheDocument();
    expect(screen.getByText("跟进提醒")).toBeInTheDocument();
    expect(screen.getByText("关联项目")).toBeInTheDocument();
  });

  it("sanitizes HTML mail and blocks active or remote content", async () => {
    mocks.emailGetThread.mockResolvedValueOnce({ id: "t1", accountId: "a1", subject: "HTML", labels: [], messages: [{ id: "m1", threadId: "t1", from: { address: "customer@example.com" }, to: [], cc: [], subject: "HTML", date: "2026-08-30T10:00:00.000Z", html: "<script>window.__mailInjected = true</script><b onclick=alert(1)>安全正文</b><a href='javascript:alert(1)'>危险链接</a><img src='https://tracker.invalid/pixel.gif'>", unread: false, attachments: [] }] });
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByText("重要客户"));
    await waitFor(() => expect(screen.getByText("安全正文")).toBeInTheDocument());
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("[onclick]")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("a[href^='javascript:']")).toBeNull();
  });

  it("previews a bulk archive before executing it", async () => {
    const toast = vi.fn();
    render(<EmailPanel onToast={toast} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 重要客户" }));
    fireEvent.click(screen.getByText("预览归档"));
    await waitFor(() => expect(mocks.emailUpdateThread).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, threadIds: ["t1"] })));
    expect(screen.getByText("确认归档")).toBeInTheDocument();
  });

  it("previews destructive bulk management and confirms before execution", async () => {
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 重要客户" }));
    fireEvent.click(screen.getByRole("button", { name: "预览删除" }));
    await waitFor(() => expect(mocks.emailUpdateThread).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, kind: "trash", threadIds: ["t1"] })));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(screen.getByRole("alertdialog", { name: /批量/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(mocks.emailUpdateThread).toHaveBeenCalledWith(expect.objectContaining({ kind: "trash", confirmed: true, threadIds: ["t1"] })));
  });

  it("supports bulk restore and unread management through the same preview path", async () => {
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 重要客户" }));
    fireEvent.click(screen.getByRole("button", { name: "预览标记未读" }));
    await waitFor(() => expect(mocks.emailUpdateThread).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, kind: "mark-unread", threadIds: ["t1"] })));
    expect(screen.getByRole("button", { name: "确认未读" })).toBeInTheDocument();
  });

  it("gates bulk actions by each account operation capability", async () => {
    mocks.emailListAccounts.mockResolvedValueOnce([{ ...account, capabilities: { ...account.capabilities, management: true, managementOperations: ["star"] } }, secondAccount]);
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 重要客户" }));
    expect(screen.getByText("预览归档")).toBeDisabled();
    expect(screen.getByText("预览标记已读")).toBeDisabled();
    expect(screen.getByText("预览收藏")).toBeEnabled();
  });

  it("opens a locally persisted draft for continued editing", async () => {
    const draft = { id: "draft-1", accountId: "a1", to: [{ address: "you@example.com" }], cc: [], bcc: [], subject: "继续编辑", body: "草稿正文", attachments: [], status: "draft" as const, createdAt: "2026-08-30T10:00:00.000Z", updatedAt: "2026-08-30T10:00:00.000Z", threadId: "t1", messageId: "m1" };
    mocks.emailListDrafts.mockResolvedValueOnce([draft]);
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByText("草稿"));
    await waitFor(() => expect(screen.getByText("继续编辑")).toBeInTheDocument());
    fireEvent.click(screen.getByText("继续编辑"));
    await waitFor(() => expect(screen.getByDisplayValue("草稿正文")).toBeInTheDocument());
    expect(screen.getByDisplayValue("you@example.com")).toBeInTheDocument();
  });

  it("offers authorization when an email MCP is configured but not connected", async () => {
    mocks.emailListAccounts.mockResolvedValue([]);
    mocks.mcpList.mockResolvedValue([{ name: "gmail", enabled: true, runtimeStatus: "failed", runtimeError: "OAuth expired" }]);
    mocks.mcpAuthTrigger.mockResolvedValue({ status: "authenticated" });
    const onNavigate = vi.fn();
    render(<EmailPanel sessionId="session-mail" onToast={vi.fn()} onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByText(/检测到邮箱连接器「gmail」/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "授权邮箱" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "授权邮箱" }));
    await waitFor(() => expect(mocks.mcpAuthTrigger).toHaveBeenCalled());
  });

  it("shows mainstream provider onboarding when no mailbox is connected", async () => {
    mocks.emailListAccounts.mockResolvedValue([]);
    const onNavigate = vi.fn();
    render(<EmailPanel onToast={vi.fn()} onNavigate={onNavigate} />);
    expect(await screen.findByRole("region", { name: "主流邮箱接入向导" })).toBeInTheDocument();
    expect(screen.getByText("Gmail / Google Workspace")).toBeInTheDocument();
    expect(screen.getByText("Outlook / Microsoft 365")).toBeInTheDocument();
    expect(screen.getByText("QQ / 163 / 企业邮箱")).toBeInTheDocument();
    expect(screen.getByText("Fastmail / JMAP")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开连接器" }));
    expect(onNavigate).toHaveBeenCalledWith("专家·技能·连接器");
  });

  it("shows read-only and attachment capability status", async () => {
    mocks.emailListAccounts.mockResolvedValueOnce([{ ...account, capabilities: { read: true, write: false, attachments: false, multipleAccounts: false } }]);
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    expect(screen.getByText("只读")).toBeInTheDocument();
    expect(screen.getByText("不支持附件")).toBeInTheDocument();
  });

  it("keeps management-only accounts manageable without enabling compose", async () => {
    mocks.emailListAccounts.mockResolvedValueOnce([{ ...account, capabilities: { read: true, write: false, attachments: false, multipleAccounts: false, management: true } }]);
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByText("重要客户"));
    await waitFor(() => expect(screen.getByRole("button", { name: "归档" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "写邮件" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "回复" })).toBeDisabled();
    expect(screen.getByText("支持邮件管理")).toBeInTheDocument();
  });

  it("uses a writable account as the default composer in the unified inbox", async () => {
    mocks.emailListAccounts.mockResolvedValueOnce([{ ...account, capabilities: { ...account.capabilities, write: false } }, secondAccount]);
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "写邮件" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "发件账户" })).toHaveValue("a2"));
  });

  it("exposes starred and important provider folders", async () => {
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "星标" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重要" })).toBeInTheDocument();
  });

  it("creates a custom AI email rule from the rule editor", async () => {
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "新建规则" }));
    fireEvent.change(screen.getByRole("textbox", { name: "规则名称" }), { target: { value: "客户邮件自动归档" } });
    fireEvent.change(screen.getByRole("textbox", { name: "规则发件人" }), { target: { value: "customer@example.com" } });
    fireEvent.change(screen.getByRole("textbox", { name: "规则搜索语法" }), { target: { value: "is:unread" } });
    fireEvent.change(screen.getByRole("combobox", { name: "规则未读状态" }), { target: { value: "true" } });
    fireEvent.change(screen.getByRole("combobox", { name: "规则动作 1" }), { target: { value: "archive" } });
    fireEvent.click(screen.getByRole("button", { name: "添加动作" }));
    fireEvent.change(screen.getByRole("combobox", { name: "规则动作 2" }), { target: { value: "mark-read" } });
    fireEvent.click(screen.getByRole("button", { name: "保存规则" }));
    await waitFor(() => expect(mocks.emailSaveRule).toHaveBeenCalledWith(expect.objectContaining({
      name: "客户邮件自动归档",
      condition: { query: "is:unread", fromContains: "customer@example.com", unread: true },
      actions: [{ kind: "archive", rationale: expect.any(String) }, { kind: "mark-read", rationale: expect.any(String) }],
    })));
    expect(screen.queryByRole("textbox", { name: "规则名称" })).toBeNull();
  });

  it("persists the scheduled scan interval when saving a rule", async () => {
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "新建规则" }));
    fireEvent.change(screen.getByRole("textbox", { name: "规则名称" }), { target: { value: "定时归档规则" } });
    fireEvent.click(screen.getByLabelText("启用定时扫描（仅生成待确认预览）"));
    fireEvent.change(screen.getByRole("spinbutton", { name: "规则扫描间隔" }), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "保存规则" }));
    await waitFor(() => expect(mocks.emailSaveRule).toHaveBeenCalledWith(expect.objectContaining({
      name: "定时归档规则",
      schedule: { intervalMinutes: 30 },
    })));
  });

  it("shows and filters OpenBuddy workspace tags separately from provider labels", async () => {
    mocks.emailListWorkspaceTags.mockResolvedValueOnce([{ id: "tag-1", name: "客户", color: "#6da9ff", scope: "personal", createdAt: "2026-08-30T10:00:00.000Z" }]);
    mocks.emailListThreadsPage.mockResolvedValueOnce({ items: [{ ...threads[0], tags: ["客户"] }, threads[1]] });
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "工作区标签" })).toHaveValue("");
    expect(screen.getAllByLabelText("工作区标签").some((element) => element.textContent?.includes("客户"))).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "工作区标签" }), { target: { value: "客户" } });
    await waitFor(() => expect(mocks.emailListThreadsPage).toHaveBeenCalledWith(expect.objectContaining({ tags: ["客户"] })));
  });

  it("shows pending sends and restores their draft when opened", async () => {
    const draft = { id: "draft-pending", accountId: "a1", to: [{ address: "you@example.com" }], cc: [], bcc: [], subject: "待发送草稿", body: "稍后发送", attachments: [], status: "draft" as const, createdAt: "2026-08-30T10:00:00.000Z", updatedAt: "2026-08-30T10:00:00.000Z" };
    mocks.emailListDrafts.mockResolvedValueOnce([draft]);
    mocks.emailListPendingSends.mockResolvedValueOnce([{ id: "pending-1", draftId: draft.id, accountId: "a1", sendAt: "2026-08-30T10:00:05.000Z", fingerprint: "f", status: "pending", createdAt: draft.createdAt }]);
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "待发送" }));
    await waitFor(() => expect(screen.getByText("待发送草稿")).toBeInTheDocument());
    fireEvent.click(screen.getByText("待发送草稿"));
    await waitFor(() => expect(screen.getByDisplayValue("稍后发送")).toBeInTheDocument());
  });

  it("renders AI analysis results with citations and supports review", async () => {
    mocks.emailListAnalyses.mockResolvedValue([
      {
        id: "analysis-1", accountId: "a1", threadId: "t1", kind: "actions",
        generatedAt: "2026-08-30T10:01:00.000Z", generatedBy: "ai",
        summary: "需要在 9 月初确认报价并安排会议",
        facts: [{ statement: "客户要求 8 月底前确认报价", citations: [{ messageId: "m1", quote: "请尽快确认" }] }],
        actions: [{ content: "向客户发送确认邮件", owner: "我", dueAt: "2026-09-02T17:00:00.000Z", citations: [{ messageId: "m1" }] }],
        risks: [], confidence: 0.5, needsReview: true, review: "pending",
      },
    ]);
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByText("重要客户"));
    await waitFor(() => expect(screen.getByText("向客户发送确认邮件")).toBeInTheDocument());
    expect(screen.getByText(/置信度\s*50%/)).toBeInTheDocument();
    expect(screen.getByText("行动项")).toBeInTheDocument();
    expect(screen.getByText("客户要求 8 月底前确认报价")).toBeInTheDocument();
    expect(screen.getByText("向客户发送确认邮件")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "采纳" }));
    await waitFor(() => expect(mocks.emailReviewAnalysis).toHaveBeenCalledWith({ id: "analysis-1", review: "accepted", reviewNote: undefined }));
  });

  it("submits a high-confidence meeting analysis for calendar approval without opening the meeting link", async () => {
    mocks.emailListAnalyses.mockResolvedValue([{
      id: "analysis-meeting", accountId: "a1", threadId: "t1", kind: "meeting",
      generatedAt: "2026-08-30T10:01:00.000Z", generatedBy: "ai", summary: "确认项目评审时间",
      facts: [], actions: [], risks: [], confidence: 0.9, needsReview: false, review: "pending",
      meetingProposal: { title: "项目评审", start: "2026-09-02T02:00:00.000Z", end: "2026-09-02T03:00:00.000Z", timeZone: "Asia/Shanghai", meetingUrl: "https://meet.example.com/project", attendees: [{ address: "customer@example.com" }], citations: [{ messageId: "m1", quote: "请确认报价" }] },
    }]);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const onToast = vi.fn();
    render(<EmailPanel onToast={onToast} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByText("重要客户"));
    await waitFor(() => expect(screen.getByText("建议加入日历：项目评审")).toBeInTheDocument());
    expect(screen.getByText("会议链接仅作参考，不会自动打开")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "提交日历审批" }));
    await waitFor(() => expect(screen.getByRole("alertdialog", { name: "提交会议到日历" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "提交审批" }));
    await waitFor(() => expect(assistantMocks.propose).toHaveBeenCalledWith(expect.objectContaining({ capability: "calendar:create", capabilityInput: expect.objectContaining({ description: expect.stringContaining("https://meet.example.com/project"), attendees: ["customer@example.com"] }) })));
    expect(assistantMocks.requestApproval).toHaveBeenCalledWith({ taskId: "calendar-task-1", actions: ["task:execute"], reason: "从邮件创建日程需要人工确认" });
    expect(mocks.emailLinkAnalysis).toHaveBeenCalledWith({ id: "analysis-meeting", linkedCalendarTaskId: "calendar-task-1" });
    expect(onToast).toHaveBeenCalledWith("日历创建提案已提交，请在助理·收件箱中批准");
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("does not offer calendar submission for low-confidence meeting analysis", async () => {
    mocks.emailListAnalyses.mockResolvedValue([{
      id: "analysis-meeting-low", accountId: "a1", threadId: "t1", kind: "meeting",
      generatedAt: "2026-08-30T10:01:00.000Z", generatedBy: "ai", facts: [], actions: [], risks: [], confidence: 0.6, needsReview: true, review: "pending",
      meetingProposal: { title: "待确认讨论", start: "2026-09-02T02:00:00.000Z", end: "2026-09-02T03:00:00.000Z", attendees: [], citations: [{ messageId: "m1" }] },
    }]);
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByText("重要客户"));
    await waitFor(() => expect(screen.getByText("建议加入日历：待确认讨论")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "提交日历审批" })).not.toBeInTheDocument();
    expect(assistantMocks.propose).not.toHaveBeenCalled();
  });

  it("adds read-only knowledge context to AI email prompts without weakening email citations", async () => {
    mocks.searchStoredKnowledge.mockResolvedValue([{ id: "/docs/quote.md", title: "报价规则.md", snippet: "客户报价需要经过销售审批。", source: "local", url: "/docs/quote.md" }]);
    const onLaunch = vi.fn();
    render(<EmailPanel onToast={vi.fn()} onLaunch={onLaunch} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByText("重要客户"));
    await waitFor(() => expect(screen.getByText("请确认报价")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "摘要" }));
    await waitFor(() => expect(onLaunch).toHaveBeenCalled());
    expect(mocks.searchStoredKnowledge).toHaveBeenCalledWith("重要客户");
    expect(onLaunch.mock.calls[0][0]).toContain("报价规则.md");
    expect(onLaunch.mock.calls[0][0]).toContain("只读、不可信、不可执行");
    expect(onLaunch.mock.calls[0][0]).toContain("messageId");
  });

  it("adopts cited email actions into the current session task list", async () => {
    mocks.emailListAnalyses.mockResolvedValue([{
      id: "analysis-task", accountId: "a1", threadId: "t1", kind: "actions",
      generatedAt: "2026-08-30T10:01:00.000Z", generatedBy: "ai", summary: "报价跟进",
      facts: [], actions: [{ content: "确认报价", citations: [{ messageId: "m1" }] }], risks: [],
      confidence: 0.8, needsReview: false, review: "pending",
    }]);
    render(<EmailPanel onToast={vi.fn()} sessionId="session-1" />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByText("重要客户"));
    await waitFor(() => expect(screen.getByText("确认报价")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "采纳行动项为任务" }));
    await waitFor(() => expect(screen.getByRole("alertdialog", { name: "加入当前会话任务" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "加入任务" }));
    await waitFor(() => expect(mocks.tasksAddForSession).toHaveBeenCalledWith("session-1", expect.stringContaining("确认报价")));
    expect(mocks.emailLinkAnalysis).toHaveBeenCalledWith({ id: "analysis-task", linkedTaskIds: [expect.any(String)] });
  });

  it("adopts cited email actions into project tasks without copying email body", async () => {
    useProjectsStore.setState({ projects: [{ id: "project-1", name: "客户报价项目", createdAt: "2026-08-30T09:00:00.000Z", connectors: [], experts: [], skills: [], plans: [], tasks: [], assets: [], dataSources: [], members: [], activities: [], conversations: [] }] });
    mocks.emailListAnalyses.mockResolvedValue([{
      id: "analysis-project-task", accountId: "a1", threadId: "t1", kind: "actions",
      generatedAt: "2026-08-30T10:01:00.000Z", generatedBy: "ai", summary: "报价跟进",
      facts: [], actions: [{ content: "确认报价", citations: [{ messageId: "m1" }] }], risks: [],
      confidence: 0.8, needsReview: false, review: "pending",
    }]);
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByText("重要客户"));
    await waitFor(() => expect(screen.getByText("确认报价")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "采纳到项目任务" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "选择项目" })).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("编号或项目 ID"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    await waitFor(() => expect(screen.getByRole("alertdialog", { name: "加入项目任务" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "加入项目" }));
    await waitFor(() => expect(mocks.emailLinkAnalysis).toHaveBeenCalledWith({ id: "analysis-project-task", linkedProjectTaskIds: [expect.any(String)] }));
    const task = useProjectsStore.getState().projects[0]?.tasks[0];
    expect(task).toMatchObject({ source: "email", tags: ["邮件行动项"] });
    expect(task?.title).toContain("确认报价");
    expect(task?.title).toContain("m1");
    expect(task?.title).not.toContain("请确认报价");
  });

  it("previews and executes an AI noise archive plan only after confirmation", async () => {
    mocks.emailTriage.mockResolvedValueOnce({
      generatedAt: "2026-08-30T10:00:00.000Z",
      total: 1,
      items: [{ accountId: "a2", threadId: "t2", subject: "促销邮件", sender: { address: "promo@example.com" }, date: "2026-08-30T09:00:00.000Z", category: "noise", score: 0.9, reasons: ["Promotion 标签"], unread: false, labels: [] }],
      counts: { urgent: 0, "needs-reply": 0, "waiting-for-reply": 0, noise: 1, normal: 0 },
    });
    mocks.emailPrepareProcessingPlan.mockResolvedValueOnce({ id: "plan-1", status: "pending", operations: [{ accountId: "a2", threadIds: ["t2"], kind: "archive", rationale: "AI 分诊识别为 Noise；请用户在预览后确认" }], previews: [{ ok: true, provider: "fake", operation: "archive", matched: 1, sampleIds: ["t2"], dryRun: true }], createdAt: "2026-08-30T10:00:00.000Z", expiresAt: "2026-08-30T10:05:00.000Z" });
    mocks.emailExecuteProcessingPlan.mockResolvedValueOnce({ id: "plan-1", status: "executed", operations: [{ accountId: "a2", threadIds: ["t2"], kind: "archive" }], previews: [], result: [{ ok: true, provider: "fake", operation: "archive", threadId: "t2" }], createdAt: "2026-08-30T10:00:00.000Z", expiresAt: "2026-08-30T10:05:00.000Z" });
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("促销邮件")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "AI 分诊" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "预览归档噪声" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "预览归档噪声" }));
    await waitFor(() => expect(mocks.emailPrepareProcessingPlan).toHaveBeenCalledWith({ operations: [{ accountId: "a2", threadIds: ["t2"], kind: "archive", rationale: "AI 分诊识别为 Noise；请用户在预览后确认" }] }));
    expect(screen.getByText("处理计划预览")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "邮件处理计划预览" })).toHaveTextContent("归档");
    expect(screen.getByRole("region", { name: "邮件处理计划预览" })).toHaveTextContent("AI 理由：AI 分诊识别为 Noise；请用户在预览后确认");
    expect(screen.getByRole("region", { name: "邮件处理计划预览" })).toHaveTextContent("预览匹配：1 · 样本：t2");
    fireEvent.click(screen.getByRole("button", { name: "确认执行处理计划" }));
    await waitFor(() => expect(mocks.emailConfirmProcessingPlan).toHaveBeenCalledWith("plan-1"));
    await waitFor(() => expect(mocks.emailExecuteProcessingPlan).toHaveBeenCalledWith("plan-1", "email-plan:test"));
    expect(screen.getByText("已执行")).toBeInTheDocument();
  });

  it("persists cancellation when a pending AI processing plan is dismissed", async () => {
    mocks.emailTriage.mockResolvedValueOnce({
      generatedAt: "2026-08-30T10:00:00.000Z",
      total: 1,
      items: [{ accountId: "a2", threadId: "t2", subject: "促销邮件", sender: { address: "promo@example.com" }, date: "2026-08-30T09:00:00.000Z", category: "noise", score: 0.9, reasons: ["Promotion 标签"], unread: false, labels: [] }],
      counts: { urgent: 0, "needs-reply": 0, "waiting-for-reply": 0, noise: 1, normal: 0 },
    });
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("促销邮件")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "AI 分诊" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "预览归档噪声" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "预览归档噪声" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "取消计划" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "取消计划" }));
    await waitFor(() => expect(mocks.emailCancelProcessingPlan).toHaveBeenCalledWith("plan-1"));
    expect(screen.getByText("已取消")).toBeInTheDocument();
  });

  it("opens the keyboard help dialog with the ? key", async () => {
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "?" });
    expect(await screen.findByRole("dialog", { name: "键盘快捷键" })).toBeInTheDocument();
  });

  it("navigates the focused thread index with j and k", async () => {
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    screen.getAllByRole("button", { name: /.*重要客户|.*促销|.*账单.*/i })
    fireEvent.keyDown(window, { key: "j" })
    fireEvent.keyDown(window, { key: "k" })
    expect(screen.getByText("重要客户")).toBeInTheDocument()
  })

  it("switches to inbox via g i chord", async () => {
    render(<EmailPanel onToast={vi.fn()} />)
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "已发送" }))
    expect(screen.getByRole("button", { name: "已发送" }).className).toContain("is-active")
    fireEvent.keyDown(window, { key: "g" })
    fireEvent.keyDown(window, { key: "i" })
    await waitFor(() => expect(screen.getByRole("button", { name: "收件箱" }).className).toContain("is-active"))
  })

  it("ignores shortcuts when typing in inputs", async () => {
    render(<EmailPanel onToast={vi.fn()} />)
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument())
    const searchInput = screen.getByPlaceholderText("搜索邮件")
    fireEvent.change(searchInput, { target: { value: "j" } })
    expect(searchInput).toHaveValue("j")
    fireEvent.keyDown(searchInput, { key: "j" })
    expect(screen.queryByRole("dialog", { name: "键盘快捷键" })).not.toBeInTheDocument()
  })


  it("exposes an add-connection button and registers a new Gmail connection through the modal", async () => {
    mocks.emailListRegistryConnections.mockResolvedValueOnce([]);
    mocks.emailRegistryReadiness.mockResolvedValueOnce([]);
    mocks.emailRegisterRegistryConnection.mockResolvedValueOnce({
      id: "gmail-work",
      providerType: "gmail-api",
      displayName: "Work Gmail",
      credentialRef: "vault://gmail/work",
      enabled: true,
      status: "connected",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    } as never);
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("邮箱连接注册表")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "+ 添加邮箱连接" }));
    const dialog = await screen.findByRole("dialog", { name: "添加邮箱连接" });
    expect(dialog).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("显示名称"), { target: { value: "Work Gmail" } });
    fireEvent.change(within(dialog).getByLabelText("credentialRef（MCP server 名 / vault key）"), { target: { value: "vault://gmail/work" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "添加并尝试连接" }));
    await waitFor(() => expect(mocks.emailRegisterRegistryConnection).toHaveBeenCalledWith(expect.objectContaining({
      providerType: "gmail-api",
      displayName: "Work Gmail",
      credentialRef: "vault://gmail/work",
    })));
  });

  it("shows the empty registry state and lets the user open the add modal", async () => {
    mocks.emailListRegistryConnections.mockResolvedValueOnce([]);
    mocks.emailRegistryReadiness.mockResolvedValueOnce([]);
    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/尚未配置任何邮箱连接/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "+ 添加邮箱连接" }));
    expect(await screen.findByRole("dialog", { name: "添加邮箱连接" })).toBeInTheDocument();
  });
  it("batch creates follow-up reminders from the AI action center with single confirmation", async () => {
    const toast = vi.fn();
    mocks.emailListAnalyses.mockResolvedValue([{
      id: "analysis-actions-1", accountId: "a1", threadId: "t1", kind: "actions",
      generatedAt: "2026-08-30T10:01:00.000Z", generatedBy: "ai", summary: "客户报价",
      facts: [], actions: [{ content: "确认报价", citations: [{ messageId: "m1" }] }], risks: [],
      confidence: 0.9, needsReview: false, review: "pending",
    }]);
    // mockReset clears any stale mockResolvedValueOnce queue from previous tests.
    mocks.emailActionCenterCreateReminders.mockReset();
    mocks.emailActionCenterCreateReminders
      .mockResolvedValueOnce({ generatedAt: "2026-08-30T10:01:00.000Z", dryRun: true, requiresConfirmation: true, matchedAnalysisCount: 1, matchedActionCount: 1, created: [], skipped: [] })
      .mockResolvedValueOnce({ generatedAt: "2026-08-30T10:01:00.000Z", dryRun: false, requiresConfirmation: false, matchedAnalysisCount: 1, matchedActionCount: 1, created: [{ analysisId: "analysis-actions-1", threadId: "t1", accountId: "a1", actionIndex: 0, content: "确认报价", owner: "我", dueAt: "2026-09-02T17:00:00.000Z", receipt: "rem-1" }], skipped: [] });
    render(<EmailPanel onToast={toast} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "AI 行动中心" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "AI 邮件行动中心" })).toBeInTheDocument());
    // Switch the review filter to "pending" so the dry-run payload carries reviewStates.
    fireEvent.click(screen.getByRole("button", { name: "待审阅1" }));
    fireEvent.click(screen.getByRole("button", { name: "批量跟进" }));
    await waitFor(() => expect(mocks.emailActionCenterCreateReminders).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, confirmed: false, reviewStates: ["pending"] })));
    const dialog = await screen.findByRole("alertdialog", { name: "批量创建跟进提醒" });
    expect(dialog).toHaveTextContent("1 项行动项");
    fireEvent.click(within(dialog).getByRole("button", { name: "创建 1 项" }));
    await waitFor(() => expect(mocks.emailActionCenterCreateReminders).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false, confirmed: true })));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("已批量创建 1 项跟进提醒，跳过 0 项"));
  });

  it("skips the action center batch follow-up when no eligible action remains", async () => {
    const toast = vi.fn();
    mocks.emailListAnalyses.mockResolvedValue([{
      id: "analysis-empty", accountId: "a1", threadId: "t1", kind: "actions",
      generatedAt: "2026-08-30T10:01:00.000Z", generatedBy: "ai", summary: "无行动项",
      facts: [], actions: [], risks: [],
      confidence: 0.9, needsReview: false, review: "pending",
    }]);
    mocks.emailActionCenterCreateReminders.mockReset();
    mocks.emailActionCenterCreateReminders.mockResolvedValueOnce({ generatedAt: "2026-08-30T10:01:00.000Z", dryRun: true, requiresConfirmation: true, matchedAnalysisCount: 0, matchedActionCount: 0, created: [], skipped: [] });
    render(<EmailPanel onToast={toast} />);
    await waitFor(() => expect(screen.getByText("重要客户")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "AI 行动中心" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "AI 邮件行动中心" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "批量跟进" }));
    await waitFor(() => expect(mocks.emailActionCenterCreateReminders).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true })));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("当前过滤条件下没有待跟进行动项"));
    expect(screen.queryByRole("alertdialog", { name: "批量创建跟进提醒" })).toBeNull();
  });

  // R7.0 regression — when no email MCP is connected, `email:accounts` and
  // `email:threads-page` reject with `provider_unavailable`. Earlier the
  // EmailPanel's `useCallback(loadAccounts)` included `onToast` in its
  // dependency array. App.tsx's `showToast` was not memoized, so each
  // parent render produced a new `onToast` reference, invalidating the
  // callback, re-firing its `useEffect`, hitting IPC again, pushing a
  // fresh toast, re-rendering App, and looping — locking the renderer
  // event loop. The fix is to (a) memoize `showToast` in App.tsx and
  // (b) read `onToast` through a ref in EmailPanel so callback identity
  // is independent of prop identity.
  it("does not retrigger email IPC in a loop when the parent re-renders with a fresh onToast and provider is unavailable", async () => {
    const onToast = vi.fn();
    mocks.emailListAccounts.mockReset();
    mocks.emailListAccounts.mockRejectedValue(Object.assign(new Error("没有已连接的邮箱 MCP 服务"), { code: "provider_unavailable" }));
    mocks.emailListSyncStates.mockReset();
    mocks.emailListSyncStates.mockResolvedValue([]);
    mocks.emailListRules.mockReset();
    mocks.emailListRules.mockResolvedValue([]);
    mocks.emailListProcessingPlans.mockReset();
    mocks.emailListProcessingPlans.mockResolvedValue([]);
    mocks.emailProviderDiagnostics.mockReset();
    mocks.emailProviderDiagnostics.mockResolvedValue(null);
    mocks.emailListThreadsPage.mockReset();
    mocks.emailListThreadsPage.mockRejectedValue(Object.assign(new Error("没有已连接的邮箱 MCP 服务"), { code: "provider_unavailable" }));

    // Wrap EmailPanel in a component that recreates `onToast` on every
    // render — the exact shape of the bug as it manifests in App.tsx.
    function Wrapper({ tick }: { tick: number }) {
      // Recreating the function on every render is what triggers the
      // broken `useCallback`/useEffect loop.
      const unstable = () => onToast(`render-${tick}`);
      return <EmailPanel onToast={unstable} />;
    }

    const { rerender } = render(<Wrapper tick={1} />);
    // Initial mount: account list + threads are each requested once.
    await waitFor(() => expect(mocks.emailListAccounts).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.emailListThreadsPage).toHaveBeenCalledTimes(1));

    // Simulate the parent re-rendering many times with a fresh prop
    // identity. Pre-fix this would trigger the IPC loop; post-fix the
    // callbacks stay stable so no further IPC fires.
    await act(async () => {
      for (let tick = 2; tick <= 8; tick += 1) {
        rerender(<Wrapper tick={tick} />);
      }
    });

    // Allow async IPC rejections (and any toast pushes they trigger)
    // to settle before counting.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(mocks.emailListAccounts.mock.calls.length).toBeLessThanOrEqual(2);
    expect(mocks.emailListThreadsPage.mock.calls.length).toBeLessThanOrEqual(2);

    // The user-facing toast may still fire — that is fine — but it must
    // not be re-fired on every parent re-render.
    expect(onToast.mock.calls.length).toBeLessThanOrEqual(4);
  });

  // R7.0 strict — proves the IPC is called O(1) times regardless of how
  // many parent re-renders happen after the provider error. Pre-fix,
  // each parent rerender re-creates the onToast closure, invalidating
  // `loadAccounts` / `loadThreads` via their `useCallback` dep arrays,
  // re-firing their `useEffect`, hitting IPC again, throwing again, and
  // pushing another toast — an O(N) cascade that locks the renderer.
  it("does not cascade email IPC calls when parent rerenders 8 times after provider error", async () => {
    const onToast = vi.fn();
    mocks.emailListAccounts.mockReset();
    mocks.emailListAccounts.mockRejectedValue(Object.assign(new Error("没有已连接的邮箱 MCP 服务"), { code: "provider_unavailable" }));
    mocks.emailListSyncStates.mockReset();
    mocks.emailListSyncStates.mockResolvedValue([]);
    mocks.emailListRules.mockReset();
    mocks.emailListRules.mockResolvedValue([]);
    mocks.emailListProcessingPlans.mockReset();
    mocks.emailListProcessingPlans.mockResolvedValue([]);
    mocks.emailProviderDiagnostics.mockReset();
    mocks.emailProviderDiagnostics.mockResolvedValue(null);
    mocks.emailListThreadsPage.mockReset();
    mocks.emailListThreadsPage.mockRejectedValue(Object.assign(new Error("没有已连接的邮箱 MCP 服务"), { code: "provider_unavailable" }));

    // Use a ref to track wrapper renders without relying on closure capture.
    const renderTracker = { count: 0 };
    function Wrapper({ tick }: { tick: number }) {
      renderTracker.count += 1;
      const unstable = () => onToast(`render-${tick}`);
      return <EmailPanel onToast={unstable} />;
    }

    const { rerender } = render(<Wrapper tick={0} />);
    await waitFor(() => expect(mocks.emailListAccounts).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.emailListThreadsPage).toHaveBeenCalledTimes(1));

    // RTL rerender is auto-wrapped in act; no manual wrapping needed.
    for (let tick = 1; tick <= 8; tick += 1) {
      rerender(<Wrapper tick={tick} />);
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // The whole point: IPC count is bounded regardless of wrapper render count.
    expect(mocks.emailListAccounts.mock.calls.length).toBeLessThanOrEqual(2);
    expect(mocks.emailListThreadsPage.mock.calls.length).toBeLessThanOrEqual(2);
    expect(onToast.mock.calls.length).toBeLessThanOrEqual(8);
    // Sanity: the wrapper did re-render at least a few times.
    expect(renderTracker.count).toBeGreaterThanOrEqual(3);
  });

  // R7.1 — provider_unavailable toast 必须带 ttlMs > 0 才能自动消失,
  // 否则会永久占位、占满 toast 队列,造成 UI 视觉混乱 + 用户觉得「卡住」。
  it("provider-unavailable toast uses ttlMs > 0 so it auto-dismisses", async () => {
    useToastStore.setState({ queue: [] });
    mocks.emailListAccounts.mockReset();
    mocks.emailListAccounts.mockRejectedValue(Object.assign(new Error("没有已连接的邮箱 MCP 服务"), { code: "provider_unavailable" }));
    mocks.emailListSyncStates.mockResolvedValue([]);
    mocks.emailListRules.mockResolvedValue([]);
    mocks.emailListProcessingPlans.mockResolvedValue([]);
    mocks.emailProviderDiagnostics.mockResolvedValue(null);

    render(<EmailPanel onToast={vi.fn()} />);
    await waitFor(() => expect(mocks.emailListAccounts).toHaveBeenCalled());

    const queue = useToastStore.getState().queue;
    const providerToast = queue.find((t) => t.id === "email:provider-unavailable");
    expect(providerToast).toBeDefined();
    // R7.1: ttlMs 必须大于 0,允许 toast 自动消失,避免永久占位。
    expect(providerToast!.ttlMs).toBeGreaterThan(0);
    // R7.1: 必须附带 action,让用户在 toast 上能直接执行下一步(打开连接器 / 停止 AI)。
    expect(providerToast!.action).toBeDefined();
  });
});
