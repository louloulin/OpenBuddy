import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TopbarActions } from "../TopbarActions";
import { useSessionStore } from "@/features/chat/state/session-store";
const { fork } = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("@openbuddy/client/agent-client", () => ({ agentForkSession: fork, exportTextFile: vi.fn(), agentSetSessionPinned: vi.fn(), agentSetSessionArchived: vi.fn() }));
beforeEach(() => { fork.mockReset(); useSessionStore.setState({ streaming: false }); });
describe("actual session fork", () => {
  it("opens only the child acknowledged by Pi", async () => {
    fork.mockResolvedValue("child"); const opened = vi.fn();
    render(<TopbarActions sessionId="parent" title="Parent" onForked={opened} />);
    fireEvent.click(screen.getByRole("button", { name: "更多操作" })); fireEvent.click(screen.getByRole("button", { name: "分叉为新会话" }));
    await waitFor(() => expect(opened).toHaveBeenCalledWith("child")); expect(fork).toHaveBeenCalledWith("parent");
  });
  it("keeps the parent selected when Pi rejects a fork", async () => {
    fork.mockRejectedValue(new Error("session busy")); const opened = vi.fn(); const toast = vi.fn();
    render(<TopbarActions sessionId="parent" title="Parent" onForked={opened} onToast={toast} />);
    fireEvent.click(screen.getByRole("button", { name: "更多操作" })); fireEvent.click(screen.getByRole("button", { name: "分叉为新会话" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining("分叉失败"))); expect(opened).not.toHaveBeenCalled();
  });
});
