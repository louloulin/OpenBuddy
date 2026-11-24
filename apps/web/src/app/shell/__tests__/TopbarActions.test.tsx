import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TopbarActions } from "../TopbarActions";
import { useSessionStore } from "@/features/chat/state/session-store";
const { fork, exportJsonl, saveDialog } = vi.hoisted(() => ({ fork: vi.fn(), exportJsonl: vi.fn(), saveDialog: vi.fn() }));
vi.mock("@openbuddy/client/agent-client", () => ({ agentForkSession: fork, exportTextFile: vi.fn(), agentExportJsonl: exportJsonl, saveFileDialog: saveDialog, agentSetSessionPinned: vi.fn(), agentSetSessionArchived: vi.fn() }));
beforeEach(() => { fork.mockReset(); exportJsonl.mockReset(); saveDialog.mockReset(); useSessionStore.setState({ streaming: false }); });
describe("会话 JSONL 导出 (pii W6.5)", () => {
  it("uses the save dialog and exports the current session", async () => {
    saveDialog.mockResolvedValue("/tmp/session.jsonl");
    exportJsonl.mockResolvedValue("/tmp/session.jsonl");
    const toast = vi.fn();
    render(<TopbarActions sessionId="s1" title="季度报告" onToast={toast} />);
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("button", { name: "导出为 JSONL（可导入）" }));
    await waitFor(() => expect(exportJsonl).toHaveBeenCalledWith("s1", "/tmp/session.jsonl"));
    expect(saveDialog.mock.calls[0][0].defaultPath).toContain("季度报告");
    await waitFor(() => expect(toast).toHaveBeenCalledWith("已导出到 /tmp/session.jsonl"));
  });
});
describe("保存为自动化 (pii W4.3)", () => {
  it("hands the title, last user message and workspace to the automation form", () => {
    useSessionStore.setState({
      streaming: false,
      messages: [
        { id: "u1", role: "user", complete: true, parts: [{ kind: "text", text: "把季度销售数据整理成报告" }] },
        { id: "a1", role: "assistant", complete: true, parts: [{ kind: "text", text: "好的" }] },
      ],
    } as never);
    const save = vi.fn();
    render(<TopbarActions sessionId="s1" title="季度销售" cwd="/ws" onSaveAsAutomation={save} />);
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("button", { name: "保存为自动化" }));
    expect(save).toHaveBeenCalledWith({ name: "季度销售", prompt: "把季度销售数据整理成报告", cwds: "/ws" });
  });
});

describe("actual session fork", () => {
  it("opens only the child acknowledged by Pi", async () => {
    fork.mockResolvedValue("child"); const opened = vi.fn();
    render(<TopbarActions sessionId="parent" title="Parent" onForked={opened} />);
    fireEvent.click(screen.getByRole("button", { name: "更多操作" })); fireEvent.click(screen.getByRole("button", { name: "复制会话" }));
    await waitFor(() => expect(opened).toHaveBeenCalledWith("child")); expect(fork).toHaveBeenCalledWith("parent");
  });
  it("keeps the parent selected when Pi rejects a fork", async () => {
    fork.mockRejectedValue(new Error("session busy")); const opened = vi.fn(); const toast = vi.fn();
    render(<TopbarActions sessionId="parent" title="Parent" onForked={opened} onToast={toast} />);
    fireEvent.click(screen.getByRole("button", { name: "更多操作" })); fireEvent.click(screen.getByRole("button", { name: "复制会话" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining("复制会话失败"))); expect(opened).not.toHaveBeenCalled();
  });
});
