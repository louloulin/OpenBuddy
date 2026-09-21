import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EmailHeader } from "../EmailHeader";

const baseProps = () => ({
  onSearch: vi.fn(),
  onCompose: vi.fn(),
  onOpenPendingPlan: vi.fn(),
  onOpenActionCenter: vi.fn(),
  onRunReplyZero: vi.fn(),
  onRunDigest: vi.fn(),
  onRunTriage: vi.fn(),
  onRunSummary: vi.fn(),
  pendingPlanCount: 0,
  accountId: "a1",
  canCompose: true,
});

describe("EmailHeader (simplified)", () => {
  it("renders title + search + compose only (no 7 buttons)", () => {
    render(<EmailHeader {...baseProps()} />);
    expect(screen.getByRole("heading", { name: "邮件" })).toBeTruthy();
    expect(screen.getByLabelText("搜索邮件")).toBeTruthy();
    // 旧 7 个 AI 按钮不再渲染
    expect(screen.queryByRole("button", { name: /待确认计划/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /待我回复/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /今日简报/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /AI 分诊/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /AI 摘要/ })).toBeNull();
  });

  it("calls onCompose when 新建 clicked", () => {
    const props = baseProps();
    render(<EmailHeader {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /新建/ }));
    expect(props.onCompose).toHaveBeenCalled();
  });

  it("calls onSearch on Enter", () => {
    const props = baseProps();
    render(<EmailHeader {...props} />);
    const input = screen.getByLabelText("搜索邮件");
    fireEvent.change(input, { target: { value: "Q4" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onSearch).toHaveBeenCalledWith("Q4");
  });

  it("disables compose when no account", () => {
    const props = { ...baseProps(), accountId: "" };
    render(<EmailHeader {...props} />);
    expect(screen.getByRole("button", { name: /新建/ }).hasAttribute("disabled")).toBe(true);
  });

  it("disables compose when canCompose is false", () => {
    const props = { ...baseProps(), canCompose: false };
    render(<EmailHeader {...props} />);
    expect(screen.getByRole("button", { name: /新建/ }).hasAttribute("disabled")).toBe(true);
  });

  it("shows pending plan count on legacy AI action button", () => {
    render(<EmailHeader {...baseProps()} pendingPlanCount={3} />);
    const btn = screen.getByTitle(/AI 行动中心/);
    expect(btn.textContent).toContain("3");
  });

  it("legacy callbacks still fire (backward compat)", () => {
    const props = baseProps();
    render(<EmailHeader {...props} />);
    fireEvent.click(screen.getByTitle(/AI 行动中心/));
    expect(props.onOpenActionCenter).toHaveBeenCalled();
  });

  it("default noop callbacks don't crash when no provider", () => {
    render(<EmailHeader onCompose={vi.fn()} />);
    fireEvent.click(screen.getByTitle(/AI 行动中心/));
    expect(screen.getByRole("button", { name: /新建/ })).toBeTruthy();
  });
});
