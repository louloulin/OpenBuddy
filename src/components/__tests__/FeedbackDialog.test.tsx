import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FeedbackDialog } from "@openbuddy/ui-dialogs";
import { useFeedbackStore } from "@/stores/feedback-store";

const resetStore = () => {
  window.localStorage.removeItem("openbuddy.feedback");
  useFeedbackStore.setState({ entries: {} });
};

describe("FeedbackDialog", () => {
  beforeEach(resetStore);

  it("open=false 时不渲染", () => {
    const { container } = render(
      <FeedbackDialog
        open={false}
        sessionId="s1"
        messageId="m1"
        rating="up"
        onClose={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("open=true 渲染评分条 + 备注框 + 提交按钮", () => {
    render(
      <FeedbackDialog
        open
        sessionId="s1"
        messageId="m1"
        rating="up"
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // 5 个星按钮。
    expect(screen.getByLabelText("1 星")).toBeInTheDocument();
    expect(screen.getByLabelText("5 星")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("补充说明(可选)")).toBeInTheDocument();
    expect(screen.getByText("提交")).toBeInTheDocument();
  });

  it("赞方向时标题含「满意」", () => {
    render(
      <FeedbackDialog
        open
        sessionId="s1"
        messageId="m1"
        rating="up"
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/满意/)).toBeInTheDocument();
  });

  it("踩方向时标题含「改进」", () => {
    render(
      <FeedbackDialog
        open
        sessionId="s1"
        messageId="m1"
        rating="down"
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/改进/)).toBeInTheDocument();
  });

  it("选星后显示中文标签", () => {
    render(
      <FeedbackDialog
        open
        sessionId="s1"
        messageId="m1"
        rating="up"
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("4 星"));
    expect(screen.getByText("较好")).toBeInTheDocument();
  });

  it("提交写入 setDetailed(stars + note)并关闭", () => {
    const onClose = vi.fn();
    const onToast = vi.fn();
    render(
      <FeedbackDialog
        open
        sessionId="s1"
        messageId="m1"
        rating="down"
        onClose={onClose}
        onToast={onToast}
      />,
    );
    fireEvent.click(screen.getByLabelText("2 星"));
    fireEvent.change(screen.getByPlaceholderText("补充说明(可选)"), {
      target: { value: "太长了" },
    });
    fireEvent.click(screen.getByText("提交"));
    const e = useFeedbackStore.getState().entries["s1:m1"];
    expect(e.rating).toBe("down");
    expect(e.stars).toBe(2);
    expect(e.note).toBe("太长了");
    expect(onClose).toHaveBeenCalled();
    expect(onToast).toHaveBeenCalledWith("已提交反馈");
  });

  it("取消按钮关闭但不写入详细评分", () => {
    const onClose = vi.fn();
    render(
      <FeedbackDialog
        open
        sessionId="s1"
        messageId="m1"
        rating="up"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText("5 星"));
    fireEvent.click(screen.getByText("取消"));
    expect(onClose).toHaveBeenCalled();
    // 取消不写入详细评分(本测试未先 setRating,所以条目不存在)。
    expect(useFeedbackStore.getState().entries["s1:m1"]).toBeUndefined();
  });

  it("不填星与备注也可提交(stars/note 为 undefined)", () => {
    render(
      <FeedbackDialog
        open
        sessionId="s1"
        messageId="m1"
        rating="up"
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("提交"));
    const e = useFeedbackStore.getState().entries["s1:m1"];
    expect(e.rating).toBe("up");
    expect(e.stars).toBeUndefined();
    expect(e.note).toBeUndefined();
  });
});
