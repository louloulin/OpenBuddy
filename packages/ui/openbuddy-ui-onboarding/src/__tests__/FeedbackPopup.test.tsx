import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeedbackPopup } from "../components/FeedbackPopup";

afterEach(() => cleanup());

describe("@openbuddy/ui-onboarding/FeedbackPopup", () => {
  it("未选择情绪时提交按钮禁用", () => {
    render(<FeedbackPopup onSubmit={() => {}} />);
    expect((screen.getByTestId("feedback-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("选择赞 / 踩后提交对应 payload", () => {
    const onSubmit = vi.fn();
    render(<FeedbackPopup onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId("feedback-up"));
    expect(screen.getByTestId("feedback-up").dataset.active).toBe("true");
    fireEvent.change(screen.getByTestId("feedback-comment"), {
      target: { value: "  很好用  " },
    });
    fireEvent.click(screen.getByTestId("feedback-submit"));
    expect(onSubmit).toHaveBeenCalledWith({ sentiment: "up", comment: "很好用" });
  });

  it("再点一次取消选择", () => {
    const onSubmit = vi.fn();
    render(<FeedbackPopup onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId("feedback-down"));
    fireEvent.click(screen.getByTestId("feedback-down"));
    expect(screen.getByTestId("feedback-down").dataset.active).toBe("false");
    expect((screen.getByTestId("feedback-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("备注可选:不填时 comment 为空串", () => {
    const onSubmit = vi.fn();
    render(<FeedbackPopup onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId("feedback-down"));
    fireEvent.click(screen.getByTestId("feedback-submit"));
    expect(onSubmit).toHaveBeenCalledWith({ sentiment: "down", comment: "" });
  });

  it("hideComment 隐藏备注框", () => {
    render(<FeedbackPopup onSubmit={() => {}} hideComment />);
    expect(screen.queryByTestId("feedback-comment")).toBeNull();
  });

  it("备注长度计数与上限", () => {
    render(<FeedbackPopup onSubmit={() => {}} maxLength={10} />);
    fireEvent.change(screen.getByTestId("feedback-comment"), { target: { value: "abc" } });
    expect(screen.getByTestId("feedback-counter").textContent).toContain("3 / 10");
    expect((screen.getByTestId("feedback-comment") as HTMLTextAreaElement).maxLength).toBe(10);
  });

  it("onDismiss 同时挂在关闭图标与次要按钮上", () => {
    const onDismiss = vi.fn();
    render(<FeedbackPopup onSubmit={() => {}} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId("feedback-dismiss-icon"));
    fireEvent.click(screen.getByTestId("feedback-dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("busy 时禁用提交并展示宿主错误", () => {
    render(<FeedbackPopup onSubmit={() => {}} busy error="网络不可用" />);
    expect(screen.getByTestId("feedback-error").textContent).toBe("网络不可用");
    expect((screen.getByTestId("feedback-submit") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("feedback-up") as HTMLButtonElement).disabled).toBe(true);
  });
});
