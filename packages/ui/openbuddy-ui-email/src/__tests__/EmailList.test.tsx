import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { EmailThreadPreview } from "@openbuddy/capability-email";
import { EmailList } from "../EmailList";

const item = (id: string, overrides: Partial<EmailThreadPreview> = {}): EmailThreadPreview => ({ id, accountId: "a1", subject: `Subject ${id}`, snippet: "Preview", from: { address: `${id}@example.com` }, date: "2026-01-01T00:00:00.000Z", messageCount: 1, unread: false, labels: [], ...overrides });
const props = () => ({ threads: [item("t1")], selectedThreadIds: [], focusedIndex: -1, loading: false, folder: "inbox", canManageSelection: () => true, canManageOperation: () => true, onBulkUpdate: vi.fn(), onClearSelection: vi.fn(), onSelectionChange: vi.fn(), onOpenThread: vi.fn(), onQuickUpdate: vi.fn(), onCancelScheduled: vi.fn(), onCancelPending: vi.fn(), onLoadMore: vi.fn() });

describe("EmailList", () => {
 it("renders thread subject and sender", () => { render(<EmailList {...props()} />); expect(screen.getByText("Subject t1")).toBeTruthy(); expect(screen.getByText(/t1@example.com/)).toBeTruthy(); });
 it("opens thread on row click", () => { const p=props(); render(<EmailList {...p} />); fireEvent.click(screen.getByRole("button", { name: /Subject t1/ })); expect(p.onOpenThread).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" })); });
 it("reports checkbox selection", () => { const p=props(); render(<EmailList {...p} />); fireEvent.click(screen.getByRole("checkbox", { name: "选择 Subject t1" })); expect(p.onSelectionChange).toHaveBeenCalledWith("a1:t1", true); });
 it("renders empty state", () => { render(<EmailList {...props()} threads={[]} />); expect(screen.getByText("没有匹配的邮件")).toBeTruthy(); });
 it("renders loading state", () => { render(<EmailList {...props()} threads={[]} loading />); expect(screen.getByText("正在同步邮件列表…")).toBeTruthy(); });
 it("renders bulk toolbar and routes actions", () => { const p=props(); render(<EmailList {...p} selectedThreadIds={["a1:t1"]} />); fireEvent.click(screen.getByRole("button", { name: "预览归档" })); expect(p.onBulkUpdate).toHaveBeenCalledWith("archive"); fireEvent.click(screen.getByRole("button", { name: "取消" })); expect(p.onClearSelection).toHaveBeenCalledTimes(1); });
 it("renders load more when cursor exists", () => { const p=props(); render(<EmailList {...p} nextCursor="next" />); fireEvent.click(screen.getByRole("button", { name: "加载更多" })); expect(p.onLoadMore).toHaveBeenCalledTimes(1); });
 it("renders scheduled cancel action", () => { const p=props(); render(<EmailList {...p} folder="scheduled" />); fireEvent.click(screen.getByRole("button", { name: "取消计划" })); expect(p.onCancelScheduled).toHaveBeenCalledWith("t1"); });
 it("renders pending cancel action", () => { const p=props(); render(<EmailList {...p} folder="pending" />); fireEvent.click(screen.getByRole("button", { name: "撤回发送" })); expect(p.onCancelPending).toHaveBeenCalledWith("t1"); });
});
