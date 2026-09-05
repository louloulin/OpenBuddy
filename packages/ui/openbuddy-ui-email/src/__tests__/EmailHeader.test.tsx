import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { EmailProcessingPlan } from "@openbuddy/capability-email";
import { EmailHeader } from "../EmailHeader";

const plan = { id: "plan-1", status: "pending", operations: [], createdAt: "2026-01-01", expiresAt: "2026-01-02" } as unknown as EmailProcessingPlan;
const baseProps = () => ({
  pendingPlans: [plan], actionCenterLoading: false, accountId: "account-1", canCompose: true,
  onOpenPendingPlan: vi.fn(), onOpenActionCenter: vi.fn(), onRunReplyZero: vi.fn(), onRunDigest: vi.fn(), onRunTriage: vi.fn(), onRunSummary: vi.fn(), onCompose: vi.fn(),
});

describe("EmailHeader", () => {
  it("renders title and primary actions", () => {
    render(<EmailHeader {...baseProps()} />);
    expect(screen.getByRole("heading", { name: "邮件" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /AI 行动中心/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "写邮件" })).toBeTruthy();
  });
  it("opens first pending plan", () => {
    const props = baseProps(); render(<EmailHeader {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /待确认计划/ }));
    expect(props.onOpenPendingPlan).toHaveBeenCalledWith(plan);
  });
  it("disables pending plan when empty", () => {
    render(<EmailHeader {...baseProps()} pendingPlans={[]} />);
    expect(screen.getByRole("button", { name: /待确认计划/ }).hasAttribute("disabled")).toBe(true);
  });
  it("opens action center", () => {
    const props = baseProps(); render(<EmailHeader {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /AI 行动中心/ }));
    expect(props.onOpenActionCenter).toHaveBeenCalledTimes(1);
  });
  it("groups AI secondary actions in a menu", () => {
    render(<EmailHeader {...baseProps()} />);
    fireEvent.click(screen.getByText("AI 助手"));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "今日简报" })).toBeTruthy();
  });
  it("routes AI menu actions", () => {
    const props = baseProps(); render(<EmailHeader {...props} />); fireEvent.click(screen.getByText("AI 助手"));
    fireEvent.click(screen.getByRole("menuitem", { name: "待我回复" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "AI 分诊" }));
    expect(props.onRunReplyZero).toHaveBeenCalledWith("needs_reply"); expect(props.onRunTriage).toHaveBeenCalledTimes(1);
  });
  it("disables account actions without account", () => {
    render(<EmailHeader {...baseProps()} accountId="" />); fireEvent.click(screen.getByText("AI 助手"));
    expect(screen.getByRole("menuitem", { name: "今日简报" }).hasAttribute("disabled")).toBe(true);
  });
  it("routes compose and respects canCompose", () => {
    const props = baseProps(); render(<EmailHeader {...props} />); fireEvent.click(screen.getByRole("button", { name: "写邮件" })); expect(props.onCompose).toHaveBeenCalledTimes(1);
    render(<EmailHeader {...baseProps()} canCompose={false} />); expect(screen.getAllByRole("button", { name: "写邮件" }).at(-1)?.hasAttribute("disabled")).toBe(true);
  });
  it("shows loading label and disables action center", () => {
    render(<EmailHeader {...baseProps()} actionCenterLoading />); expect(screen.getByRole("button", { name: "加载 AI 行动中心…" }).hasAttribute("disabled")).toBe(true);
  });
});
