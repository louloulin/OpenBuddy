import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SubagentCards } from "../SubagentCards";
import { useSubagentStore } from "../state/subagent-store";
import { usePermissionStore } from "@/features/approvals/state/permission-store";
import { selectPermissionForSession } from "@/features/approvals/state/permission-store";

beforeEach(() => {
  useSubagentStore.setState({ bySession: {} });
  usePermissionStore.setState({ queues: {} });
});

describe("子代理卡片 (pii W3.4)", () => {
  it("shows a running child, then its answer with a 3-line preview that expands", () => {
    const apply = useSubagentStore.getState().apply;
    apply({ parentId: "p", childId: "c1", status: "started", agent: "分析师", task: "统计本周数据" });
    const { rerender } = render(<SubagentCards sessionId="p" />);
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByText("分析师")).toBeInTheDocument();

    apply({ parentId: "p", childId: "c1", status: "done", agent: "分析师", ms: 2400, summary: "第一行\n第二行\n第三行\n第四行\n第五行" });
    rerender(<SubagentCards sessionId="p" />);
    expect(screen.getByText(/已完成/)).toBeInTheDocument();
    expect(screen.getByText(/1s|2s|3s/)).toBeInTheDocument();
    // Collapsed: three lines plus an ellipsis, not the fourth.
    expect(screen.queryByText(/第四行/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText(/第四行/)).toBeInTheDocument();
  });

  it("renders nothing for a session without children", () => {
    const { container } = render(<SubagentCards sessionId="none" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("surfaces a child's approval on the parent card and tags it 来自子代理", () => {
    usePermissionStore.getState().request({
      requestId: "r1",
      sessionId: "child",
      toolCallId: "t1",
      toolKind: "bash",
      title: "bash",
      rawInput: { command: "ls" },
      options: [{ optionId: "allow", kind: "allow", title: "允许本次" }],
      subagent: { parentId: "p", name: "分析师" },
    });
    const head = selectPermissionForSession("p")(usePermissionStore.getState());
    expect(head).toMatchObject({ requestId: "r1", sessionId: "child", subagent: { name: "分析师" } });
    // The child's own session still resolves it too (the request belongs to the child).
    expect(selectPermissionForSession("child")(usePermissionStore.getState())).toMatchObject({ requestId: "r1" });
  });
});
