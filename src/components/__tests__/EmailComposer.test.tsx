import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EmailComposer } from "@openbuddy/ui-email";

const account = { id: "a1", address: "me@example.com", provider: "mcp" as const, status: "connected" as const, capabilities: { read: true, write: true, attachments: true, multipleAccounts: true } };
const mocks = vi.hoisted(() => ({ emailCreateDraft: vi.fn(), emailPrepareSend: vi.fn(), emailQueueSend: vi.fn(), emailCancelPendingSend: vi.fn(), emailPrepareScheduleSend: vi.fn(), emailScheduleSend: vi.fn() }));
vi.mock("@/lib/agent/pi-client", () => mocks);
vi.mock("@/lib/platform/electron-api", () => ({ open: vi.fn(async () => null) }));

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.emailCreateDraft.mockResolvedValue({ id: "d1", accountId: "a1", to: [{ address: "you@example.com" }], cc: [], bcc: [], subject: "Hello", body: "Body", attachments: [], status: "draft", createdAt: "now", updatedAt: "now" }); mocks.emailPrepareSend.mockResolvedValue("send:once"); mocks.emailQueueSend.mockResolvedValue({ id: "pending-1", draftId: "d1", accountId: "a1", sendAt: new Date(Date.now() + 5_000).toISOString(), fingerprint: "f", status: "pending", createdAt: "now" }); mocks.emailCancelPendingSend.mockResolvedValue(undefined); mocks.emailPrepareScheduleSend.mockResolvedValue("schedule:once"); mocks.emailScheduleSend.mockResolvedValue({ ok: true }); });

describe("EmailComposer", () => {
  it("selects the sending account and saves a draft", async () => {
    const onSaved = vi.fn();
    render(<EmailComposer account={account} accounts={[account, { ...account, id: "a2", address: "work@example.com" }]} onSaved={onSaved} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "发件账户" }), { target: { value: "a2" } });
    fireEvent.change(screen.getByLabelText("收件人"), { target: { value: "you@example.com" } });
    fireEvent.change(screen.getByLabelText("主题"), { target: { value: "Hello" } });
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "Body" } });
    fireEvent.click(screen.getByText("保存草稿"));
    await waitFor(() => expect(mocks.emailCreateDraft).toHaveBeenCalledWith(expect.objectContaining({ accountId: "a2" })));
    expect(onSaved).toHaveBeenCalled();
  });

  it("requires modal confirmation before sending", async () => {
    render(<EmailComposer account={account} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("收件人"), { target: { value: "you@example.com" } });
    fireEvent.change(screen.getByLabelText("主题"), { target: { value: "Hello" } });
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "Body" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    // 确认弹框出现,且不会直接调用 prepareSend。
    const dialog = await screen.findByRole("alertdialog", { name: "确认发送邮件?" });
    expect(dialog).toBeInTheDocument();
    expect(mocks.emailPrepareSend).not.toHaveBeenCalled();
    // 点取消后弹框关闭,仍然不发送。
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mocks.emailPrepareSend).not.toHaveBeenCalled();
  });

  it("adds email mentions to Cc without changing explicit recipients", async () => {
    render(<EmailComposer account={account} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("收件人"), { target: { value: "primary@example.com" } });
    fireEvent.change(screen.getByLabelText("主题"), { target: { value: "Mention" } });
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "请 @teammate@example.com 和 @teammate@example.com 查看。" } });
    fireEvent.click(screen.getByText("保存草稿"));
    await waitFor(() => expect(mocks.emailCreateDraft).toHaveBeenCalledWith(expect.objectContaining({ to: [{ address: "primary@example.com" }], cc: [{ address: "teammate@example.com" }] })));
  });

  it("resolves contact names from the local email context index", async () => {
    render(<EmailComposer account={account} contacts={[{ address: "customer@example.com", name: "客户", accountIds: ["a1"], interactionCount: 2 }]} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("收件人"), { target: { value: "客户" } });
    fireEvent.change(screen.getByLabelText("主题"), { target: { value: "报价" } });
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "您好" } });
    fireEvent.click(screen.getByText("保存草稿"));
    await waitFor(() => expect(mocks.emailCreateDraft).toHaveBeenCalledWith(expect.objectContaining({ to: [{ address: "customer@example.com", name: "客户" }] })));
    expect(screen.getByText(/联系人建议来自已读取邮件/)).toBeInTheDocument();
  });

  it("inserts a user-confirmed document link without changing permissions", async () => {
    render(<EmailComposer account={account} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("插入文档链接"));
    const labelDialog = await screen.findByRole("dialog", { name: "插入文档链接" });
    fireEvent.change(within(labelDialog).getByPlaceholderText("文档名称，例如《2026 战略》"), { target: { value: "报价文档" } });
    fireEvent.click(within(labelDialog).getByRole("button", { name: "下一步" }));
    const urlDialog = await screen.findByRole("dialog", { name: "文档链接" });
    fireEvent.change(within(urlDialog).getByPlaceholderText("https://example.com/doc"), { target: { value: "https://docs.example.com/quote" } });
    fireEvent.click(within(urlDialog).getByRole("button", { name: "插入" }));
    await waitFor(() => expect(screen.getByDisplayValue("[报价文档](https://docs.example.com/quote)")).toBeInTheDocument());
    expect(screen.getByText(/不会自动修改文档权限/)).toBeInTheDocument();
  });

  it("previews Markdown without rendering active HTML", async () => {
    render(<EmailComposer account={account} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "**安全正文**\n\n<script>window.__mailInjected = true</script>" } });
    fireEvent.click(screen.getByRole("button", { name: "预览正文" }));
    expect(screen.getByText("安全正文")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.queryByLabelText("正文")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "编辑正文" }));
    expect(screen.getByLabelText("正文")).toHaveValue("**安全正文**\n\n<script>window.__mailInjected = true</script>");
  });

  it("saves a sanitized HTML representation alongside Markdown", async () => {
    render(<EmailComposer account={account} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("收件人"), { target: { value: "you@example.com" } });
    fireEvent.change(screen.getByLabelText("主题"), { target: { value: "HTML" } });
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "**安全**\n\n<script>alert(1)</script>" } });
    fireEvent.click(screen.getByText("保存草稿"));
    await waitFor(() => expect(mocks.emailCreateDraft).toHaveBeenCalledWith(expect.objectContaining({ body: "**安全**\n\n<script>alert(1)</script>", bodyHtml: expect.stringContaining("<strong>安全</strong>") })));
    const call = mocks.emailCreateDraft.mock.calls.at(-1)?.[0] as { bodyHtml?: string };
    expect(call.bodyHtml).not.toContain("<script");
  });

  it("reuses the existing draft id when continuing an AI draft", async () => {
    const draft = { id: "draft-ai", accountId: "a1", to: [{ address: "you@example.com" }], cc: [], bcc: [], subject: "AI 回复", body: "初稿", attachments: [], status: "draft" as const, createdAt: "now", updatedAt: "now" };
    mocks.emailCreateDraft.mockResolvedValueOnce({ ...draft, body: "修订后" });
    render(<EmailComposer account={account} onSaved={vi.fn()} onClose={vi.fn()} initial={{ draftId: draft.id, accountId: draft.accountId, to: "you@example.com", subject: draft.subject, body: draft.body }} />);
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "修订后" } });
    fireEvent.click(screen.getByText("保存草稿"));
    await waitFor(() => expect(mocks.emailCreateDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: "draft-ai" })));
  });

  it("inserts a saved quick template and signature without sending", async () => {
    localStorage.setItem("openbuddy.email.quick-templates", JSON.stringify([{ id: "tpl-1", name: "跟进", subject: "项目跟进", body: "请确认下一步。" }]));
    localStorage.setItem("openbuddy.email.signature", "OpenBuddy 团队");
    render(<EmailComposer account={account} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "快捷模板" }), { target: { value: "tpl-1" } });
    expect(screen.getByDisplayValue("项目跟进")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/请确认下一步。/)).toBeInTheDocument();
    expect(screen.getByText("已设置签名")).toBeInTheDocument();
    expect(mocks.emailQueueSend).not.toHaveBeenCalled();
  });

  it("saves a composed message as a local template", async () => {
    render(<EmailComposer account={account} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "感谢您的反馈" } });
    fireEvent.click(screen.getByText("保存为模板"));
    const dialog = await screen.findByRole("dialog", { name: "保存邮件模板" });
    fireEvent.change(within(dialog).getByPlaceholderText("模板名称"), { target: { value: "客户回访" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("openbuddy.email.quick-templates") ?? "[]")).toEqual(expect.arrayContaining([expect.objectContaining({ name: "客户回访", body: "感谢您的反馈" })])));
  });

  it("starts a new draft with the configured signature", async () => {
    localStorage.setItem("openbuddy.email.signature", "OpenBuddy 团队");
    render(<EmailComposer account={account} onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByDisplayValue("OpenBuddy 团队")).toBeInTheDocument();
  });

  it("queues a confirmed send and exposes the undo window", async () => {
    render(<EmailComposer account={account} onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("收件人"), { target: { value: "you@example.com" } });
    fireEvent.change(screen.getByLabelText("主题"), { target: { value: "Hello" } });
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "Body" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    const dialog = await screen.findByRole("alertdialog", { name: "确认发送邮件?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "发送" }));
    await waitFor(() => expect(mocks.emailQueueSend).toHaveBeenCalledWith("d1", "send:once", 5_000));
    expect(screen.getByText(/邮件将在/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("撤回发送"));
    await waitFor(() => expect(mocks.emailCancelPendingSend).toHaveBeenCalledWith("pending-1"));
  });
});
