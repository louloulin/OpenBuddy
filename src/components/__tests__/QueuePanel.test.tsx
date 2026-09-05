import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueuePanel } from "@openbuddy/ui-automation";
import { useMessageQueueStore } from "@/stores/message-queue-store";

const resetStore = () => useMessageQueueStore.setState({ queues: {} });

describe("QueuePanel", () => {
  beforeEach(resetStore);

  it("空队列时不渲染", () => {
    const { container } = render(<QueuePanel sessionId="s1" />);
    expect(container.firstChild).toBeNull();
  });

  it("渲染队列条目并显示序号与文本", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "第一条");
    s.enqueue("s1", "第二条");
    render(<QueuePanel sessionId="s1" />);
    expect(screen.getByText("待发送队列(2)")).toBeInTheDocument();
    expect(screen.getByText("第一条")).toBeInTheDocument();
    expect(screen.getByText("第二条")).toBeInTheDocument();
  });

  it("删除按钮从队列移除条目", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "第一条");
    render(<QueuePanel sessionId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(useMessageQueueStore.getState().getQueue("s1")).toHaveLength(0);
  });

  it("点击文本进入编辑,Enter 提交修改", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "原文");
    render(<QueuePanel sessionId="s1" />);
    fireEvent.click(screen.getByText("原文"));
    const edit = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(edit, { target: { value: "改后" } });
    fireEvent.keyDown(edit, { key: "Enter", shiftKey: false });
    expect(useMessageQueueStore.getState().getQueue("s1")[0].text).toBe("改后");
  });

  it("暂停/恢复切换状态", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "条目");
    render(<QueuePanel sessionId="s1" />);
    const toggle = screen.getByRole("button", { name: "暂停" });
    fireEvent.click(toggle);
    expect(useMessageQueueStore.getState().getQueue("s1")[0].paused).toBe(true);
    // 切换后按钮文案变为「恢复」。
    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    expect(useMessageQueueStore.getState().getQueue("s1")[0].paused).toBe(false);
  });

  it("上移/下移调整顺序", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "a");
    s.enqueue("s1", "b");
    render(<QueuePanel sessionId="s1" />);
    // 第二条上移。
    const ups = screen.getAllByRole("button", { name: "上移" });
    fireEvent.click(ups[1]);
    expect(
      useMessageQueueStore.getState().getQueue("s1").map((i) => i.text),
    ).toEqual(["b", "a"]);
  });

  it("立即发送:移除条目并回调 onSendNow", () => {
    const s = useMessageQueueStore.getState();
    s.enqueue("s1", "马上发");
    const onSendNow = vi.fn();
    render(<QueuePanel sessionId="s1" onSendNow={onSendNow} />);
    fireEvent.click(screen.getByRole("button", { name: "立即发送" }));
    expect(onSendNow).toHaveBeenCalledWith("马上发");
    expect(useMessageQueueStore.getState().getQueue("s1")).toHaveLength(0);
  });

  it("paused 条目的立即发送按钮禁用", () => {
    const s = useMessageQueueStore.getState();
    const id = s.enqueue("s1", "暂停的");
    s.setPaused("s1", id, true);
    render(<QueuePanel sessionId="s1" onSendNow={vi.fn()} />);
    expect(screen.getByRole("button", { name: "立即发送" })).toBeDisabled();
  });
});
