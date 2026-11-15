import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BranchTree } from "@openbuddy/protocol/branches";
import type { ChatMessage } from "@/features/chat/state/session-store";

const mocks = vi.hoisted(() => ({
  agentTree: vi.fn(),
  agentNavigate: vi.fn(),
  confirmWithOption: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@openbuddy/client/agent-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openbuddy/client/agent-client")>()),
  agentTree: mocks.agentTree,
  agentNavigate: mocks.agentNavigate,
}));
vi.mock("../../../shared/ui/AppDialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/ui/AppDialog")>()),
  appConfirmWithOption: mocks.confirmWithOption,
  appConfirm: mocks.confirm,
}));

import { TurnView } from "../TurnView";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";
import { useBranchStore } from "../state/branch-store";

const user: ChatMessage = { id: "u2", role: "user", complete: true, parts: [{ kind: "text", text: "second question" }], meta: { timestamp: 200 } };
const answer: ChatMessage = { id: "a2", role: "assistant", complete: true, parts: [{ kind: "text", text: "answer 3" }], meta: { timestamp: 201 } };
const sibling = (n: number, files: string[] = []) => ({ entryId: `u${n}`, leafId: `leaf${n}`, timestamp: 100 + n, preview: "second question", files });
function tree(files: string[][] = [[], [], []]): BranchTree {
  return { sessionId: "s1", leafId: "leaf2", turns: [
    { entryId: "u0", timestamp: 50, index: 0, total: 1, siblings: [] },
    { entryId: "u2", timestamp: 200, index: 2, total: 3, siblings: files.map((f, i) => sibling(i, f)) },
  ] };
}
const toast = vi.fn();
const view = () => render(<ThemeProvider><TurnView messages={[answer]} user={user} running={false} isLast sessionId="s1" onToast={toast} /></ThemeProvider>);

describe("branch switcher ‹1/2› (W1.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBranchStore.setState({ trees: {}, switching: {} });
    mocks.agentNavigate.mockResolvedValue({ navigated: true, restored: [], conflicts: [] });
  });

  it("shows the version count on a regenerated turn and switches with the arrows", async () => {
    mocks.agentTree.mockResolvedValue(tree());
    view();
    const group = await screen.findByRole("group", { name: "回答版本 3/3" });
    expect(group).toHaveTextContent("3/3");
    expect(screen.getByRole("button", { name: "下一版本" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "上一版本" }));
    await waitFor(() => expect(mocks.agentNavigate).toHaveBeenCalledWith("s1", "leaf1", { summarize: false, restoreFiles: false }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("已切换到第 2 版"));
    // The tree is asked again after switching.
    expect(mocks.agentTree.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("Shift+click also summarizes the version being left", async () => {
    mocks.agentTree.mockResolvedValue(tree());
    mocks.agentNavigate.mockResolvedValue({ navigated: true, restored: [], conflicts: [], summarized: true });
    view();
    fireEvent.click(await screen.findByRole("button", { name: "上一版本" }), { shiftKey: true });
    await waitFor(() => expect(mocks.agentNavigate).toHaveBeenCalledWith("s1", "leaf1", { summarize: true, restoreFiles: false }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("已切换到第 2 版，已总结原来的版本"));
  });

  it("offers to restore files and asks 覆盖 / 跳过 for files changed since", async () => {
    mocks.agentTree.mockResolvedValue(tree([["/w/a.md"], ["/w/a.md"], ["/w/a.md", "/w/b.md"]]));
    mocks.confirmWithOption.mockResolvedValue({ ok: true, checked: true });
    mocks.confirm.mockResolvedValue(true);
    mocks.agentNavigate
      .mockResolvedValueOnce({ navigated: false, restored: [], conflicts: [{ path: "/w/a.md", reason: "changed_since" }] })
      .mockResolvedValueOnce({ navigated: true, restored: ["/w/a.md", "/w/b.md"], conflicts: [] });
    view();
    fireEvent.click(await screen.findByRole("button", { name: "上一版本" }));
    await waitFor(() => expect(mocks.agentNavigate).toHaveBeenCalledTimes(2));
    expect(mocks.confirmWithOption).toHaveBeenCalledWith(expect.objectContaining({ checkbox: expect.objectContaining({ label: "同时把文件还原到第 2 版的状态（2 个文件）", checked: true }) }));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "1 个文件在之后又被修改过", confirmLabel: "覆盖", cancelLabel: "跳过" }));
    expect(mocks.agentNavigate.mock.calls[0][2]).toEqual({ summarize: false, restoreFiles: true });
    expect(mocks.agentNavigate.mock.calls[1][2]).toEqual({ summarize: false, restoreFiles: { force: true } });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("已切换到第 2 版，还原了 2 个文件"));
  });

  it("hides the switcher for turns with a single version and offers summarize-and-switch in the menu", async () => {
    mocks.agentTree.mockResolvedValue(tree());
    view();
    await screen.findByRole("group", { name: "回答版本 3/3" });
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    const item = screen.getByRole("menuitem", { name: "总结当前版本并切到第 2 版" });
    await act(async () => { fireEvent.click(item); });
    await waitFor(() => expect(mocks.agentNavigate).toHaveBeenCalledWith("s1", "leaf1", { summarize: true, restoreFiles: false }));
    await waitFor(() => expect(useBranchStore.getState().switching.s1).toBeUndefined());
    const single = { ...user, meta: { timestamp: 50 } };
    useBranchStore.setState({ trees: { s1: tree() } });
    render(<ThemeProvider><TurnView messages={[answer]} user={single} running={false} isLast={false} sessionId="s1" onToast={toast} /></ThemeProvider>);
    expect(screen.getAllByRole("group", { name: /回答版本/ })).toHaveLength(1);
  });
});
