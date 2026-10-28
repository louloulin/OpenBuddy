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
    // 折叠行(compact)：专用渲染器不再重复显示工具类别 chip ——
    // summary 本身已经是「动词 + 目标」(编辑/读取/运行)。类别信息仍在
    // aria-label / title 里,读屏用户不丢信息,视觉上少一块重复噪音。
    expect(screen.queryByText("✏️ 文件编辑")).toBeNull();
    expect(screen.getByText(/hello\.txt/)).toBeInTheDocument();
    // 卡片行是 role="button" 容器（内层还嵌着「内联展开」按钮，原生 button
    // 不能嵌套 button），所以这里必须按可访问名精确定位卡片行，不能用裸的
    // getByRole("button") —— 那会同时命中内层展开按钮。
    fireEvent.click(screen.getByRole("button", { name: /^edit\b/ }));
    expect(onOpen).toHaveBeenCalledWith(base);
  });

  it("内联展开后类别 chip 回到可见(折叠/展开两态的契约)", () => {
    render(<ToolCallCard tc={base} onOpen={() => {}} />);
    expect(screen.queryByText("✏️ 文件编辑")).toBeNull();
    // 双击折叠行 = 内联展开(见 ToolCallCard 的 onDoubleClick)。
    fireEvent.doubleClick(screen.getByRole("button", { name: /^edit\b/ }));
    expect(screen.getByText("✏️ 文件编辑")).toBeInTheDocument();
  });

  it("专用渲染器(send-message)折叠行显示摘要,类别 chip 收起", () => {
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
    expect(screen.queryByText("💬 发送消息")).toBeNull();
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
