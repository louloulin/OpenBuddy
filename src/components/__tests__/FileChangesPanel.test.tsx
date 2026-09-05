import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FileChangesPanel } from "@openbuddy/ui-conversation";
import type { ChatMessage } from "@/stores/session-store";

function diffMsg(path: string, old: string, ne: string): ChatMessage {
  return {
    id: path,
    role: "assistant",
    complete: true,
    parts: [
      {
        kind: "tool_call",
        toolCall: {
          toolCallId: "t",
          title: "Edit",
          kind: "edit",
          status: "completed",
          content: [{ type: "diff", diff: { path, old, new: ne } }],
        },
      },
    ],
  };
}

describe("FileChangesPanel", () => {
  it("无 diff 时不渲染", () => {
    const { container } = render(<FileChangesPanel messages={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("渲染标题 + 文件数 + 增删汇总", () => {
    render(
      <FileChangesPanel
        messages={[diffMsg("a.ts", "x\ny", "z"), diffMsg("b.ts", "p", "q")]}
      />,
    );
    expect(screen.getByText("文件变更")).toBeInTheDocument();
    expect(screen.getByText(/2 个文件/)).toBeInTheDocument();
    // 汇总: totalAdded=2, totalRemoved=3。summary 区有「+2」「-3」。
    const summary = screen.getByText(/2 个文件/).parentElement;
    expect(summary?.textContent).toContain("+2");
    expect(summary?.textContent).toContain("-3");
  });

  it("每个文件一行,显示 basename + 增删", () => {
    render(<FileChangesPanel messages={[diffMsg("src/a.ts", "x\ny", "z")] } />);
    expect(screen.getByText("a.ts")).toBeInTheDocument();
  });

  it("多次编辑显示 ×N", () => {
    render(
      <FileChangesPanel
        messages={[diffMsg("a.ts", "x", "y"), diffMsg("a.ts", "y", "z")]}
      />,
    );
    expect(screen.getByText("×2")).toBeInTheDocument();
  });

  it("文件类型图标渲染", () => {
    render(<FileChangesPanel messages={[diffMsg("a.ts", "x", "y")] } />);
    expect(screen.getByText("📘")).toBeInTheDocument();
  });
});
