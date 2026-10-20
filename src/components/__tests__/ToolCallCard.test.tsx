import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToolCallCard } from "@openbuddy/ui-conversation";
import type { ToolCallView } from "@/stores/session-store";

const base: ToolCallView = {
  toolCallId: "tc1",
  title: "Write C:\\Users\\chenr\\hello.txt",
  kind: "edit",
  status: "completed",
  content: [],
};

describe("ToolCallCard", () => {
  it("renders compact row and opens detail on click", () => {
    const onOpen = vi.fn();
    render(<ToolCallCard tc={base} onOpen={onOpen} />);
    // edit 属专用渲染器,kind 标签显示为「✏️ 文件编辑」。
    expect(screen.getByText("✏️ 文件编辑")).toBeInTheDocument();
    expect(screen.getByText(/hello\.txt/)).toBeInTheDocument();
    // 卡片行是 role="button" 容器（内层还嵌着「内联展开」按钮，原生 button
    // 不能嵌套 button），所以这里必须按可访问名精确定位卡片行，不能用裸的
    // getByRole("button") —— 那会同时命中内层展开按钮。
    fireEvent.click(screen.getByRole("button", { name: /^edit\b/ }));
    expect(onOpen).toHaveBeenCalledWith(base);
  });

  it("专用渲染器(send-message)显示图标 + 标签 + 摘要", () => {
    render(
      <ToolCallCard
        tc={{
          ...base,
          kind: "send_message",
          title: "通知",
          rawInput: { message: "你好,这是一条通知" },
        }}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("💬 发送消息")).toBeInTheDocument();
    expect(screen.getByText("你好,这是一条通知")).toBeInTheDocument();
  });

  it("shows running status mark while in progress", () => {
    render(
      <ToolCallCard
        tc={{ ...base, status: "in_progress", title: "Execute notepad" }}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("…")).toBeInTheDocument();
  });
});
