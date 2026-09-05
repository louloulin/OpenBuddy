import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { EmailThread } from "@openbuddy/capability-email";
import { EmailDetail } from "../EmailDetail";

const thread = { id: "t1", accountId: "a1", subject: "Project", labels: [], messages: [{ id: "m1", threadId: "t1", from: { address: "sender@example.com" }, to: [], cc: [], subject: "Project", date: "2026-01-01T00:00:00.000Z", text: "Hello", html: undefined, unread: true, attachments: [] }] } as unknown as EmailThread;
const htmlThread = { ...thread, messages: [{ ...thread.messages[0], html: '<p>Hello <strong>team</strong></p><script>alert(1)</script><a href="javascript:alert(2)" onclick="alert(3)">bad link</a>' }] } as unknown as EmailThread;
const props = () => ({ selected: thread, selectedAccount: { capabilities: { write: true } } as never, folder: "inbox", messageIndex: 0, analyses: [], activeAnalysisId: null, projectsCount: 0, canManageSelected: true, canManageOperation: () => true, onUpdate: vi.fn(), onSnooze: vi.fn(), onChangeLabel: vi.fn(), onDelete: vi.fn(), onSenderPolicy: vi.fn(), onShare: vi.fn(), onFollowup: vi.fn(), onMoveToProject: vi.fn(), onReply: vi.fn(), onMessageIndexChange: vi.fn(), onRunAi: vi.fn(), onDownloadAttachment: vi.fn(), onUnsubscribe: vi.fn(), onReviewAnalysis: vi.fn(), onAdoptReplyDraft: vi.fn(), onAdoptActionsAsTasks: vi.fn(), onAdoptActionsAsProjectTasks: vi.fn(), onCreateReminder: vi.fn(), onProposeMeeting: vi.fn() });

describe("EmailDetail", () => {
 it("renders selected subject and body", () => { render(<EmailDetail {...props()} />); expect(screen.getByRole("heading", { name: "Project" })).toBeTruthy(); expect(screen.getByText("Hello")).toBeTruthy(); });
 it("renders provider HTML safely", () => { render(<EmailDetail {...props()} selected={htmlThread} />); expect(screen.getByText("team")).toBeTruthy(); expect(document.querySelector("script")).toBeNull(); expect(document.querySelector("[onclick]")).toBeNull(); expect(document.querySelector('a[href^="javascript:"]')).toBeNull(); });
 it("renders no-selection empty state", () => { render(<EmailDetail {...props()} selected={null} />); expect(screen.getByText("选择左侧线程查看详情")).toBeTruthy(); });
 it("routes archive and reply actions", () => { const p=props(); render(<EmailDetail {...p} />); fireEvent.click(screen.getByRole("button", { name: "归档" })); fireEvent.click(screen.getByRole("button", { name: "回复" })); expect(p.onUpdate).toHaveBeenCalledWith("archive"); expect(p.onReply).toHaveBeenCalledWith(false); });
 it("routes AI workflow action", () => { const p=props(); render(<EmailDetail {...p} />); fireEvent.click(screen.getByRole("button", { name: "摘要" })); expect(p.onRunAi).toHaveBeenCalledWith("summary"); });
 it("disables navigation for a single-message thread", () => { render(<EmailDetail {...props()} />); expect(screen.getByRole("button", { name: "上一封" }).hasAttribute("disabled")).toBe(true); expect(screen.getByRole("button", { name: "下一封" }).hasAttribute("disabled")).toBe(true); });
 it("routes sender policy", () => { const p=props(); render(<EmailDetail {...p} />); fireEvent.click(screen.getByRole("button", { name: "发件人 Signal" })); expect(p.onSenderPolicy).toHaveBeenCalledWith("signal"); });
});
