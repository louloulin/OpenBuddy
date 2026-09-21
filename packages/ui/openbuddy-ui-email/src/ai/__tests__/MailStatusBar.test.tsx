import { describe, expect, it, vi, beforeEach} from "vitest";
import { swrCacheInternal } from "../hooks/useSwrCache";
import { fireEvent, render, screen } from "@testing-library/react";
import { MailStatusBar } from "../components/MailStatusBar";

beforeEach(() => { swrCacheInternal.reset(); });
describe("MailStatusBar", () => {
  it("renders default shortcuts", () => {
    render(<MailStatusBar />);
    expect(screen.getByText("切换")).toBeTruthy();
    expect(screen.getByText("归档")).toBeTruthy();
    expect(screen.getByText("稍后")).toBeTruthy();
    expect(screen.getByText("回复")).toBeTruthy();
  });

  it("renders thread count when provided", () => {
    render(<MailStatusBar threadCount={42} />);
    expect(screen.getByText("42 封线程")).toBeTruthy();
  });

  it("renders pending plan count", () => {
    render(<MailStatusBar pendingPlanCount={3} />);
    expect(screen.getByText(/3 个 AI 计划/)).toBeTruthy();
  });

  it("renders AI status with pulse dot", () => {
    render(<MailStatusBar aiStatus="AI 摘要已生成" />);
    expect(screen.getByText("AI 摘要已生成")).toBeTruthy();
  });

  it("renders undo seconds remaining", () => {
    render(<MailStatusBar undoSecondsRemaining={15} />);
    expect(screen.getByText(/撤销 15s/)).toBeTruthy();
  });

  it("invokes onShowHelp when help clicked", () => {
    const onShowHelp = vi.fn();
    render(<MailStatusBar onShowHelp={onShowHelp} />);
    fireEvent.click(screen.getByRole("button", { name: /所有快捷键/ }));
    expect(onShowHelp).toHaveBeenCalled();
  });

  it("hides pending plan when zero", () => {
    render(<MailStatusBar pendingPlanCount={0} />);
    expect(screen.queryByText(/0 个 AI 计划/)).toBeNull();
  });
});
