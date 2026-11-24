import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Sidebar } from "../Sidebar";
import { useSessionsStore } from "@/features/sessions/state/sessions-store";
import { agentDeleteSession, agentSetSessionArchived } from "@openbuddy/client/agent-client";
import { appConfirm } from "@/shared/ui/AppDialog";

vi.mock("@openbuddy/client/agent-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openbuddy/client/agent-client")>();
  return {
    ...actual,
    agentSetSessionArchived: vi.fn().mockResolvedValue(undefined),
    agentDeleteSession: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock("@/shared/ui/AppDialog", () => ({ appConfirm: vi.fn() }));

const base = {
  onNewSession: vi.fn(),
  onSelect: vi.fn(),
  onNavigate: vi.fn(),
  onOpenSettings: vi.fn(),
  onToggleCollapse: vi.fn(),
  onToggleWorkspace: vi.fn(),
  onOpenSearch: vi.fn(),
  onPlaceholder: vi.fn(),
  activeNav: "新建任务",
};
const sessions = () => [
  { sessionId: "s1", title: "会话一", cwd: "" },
  { sessionId: "s2", title: "会话二", cwd: "" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(appConfirm).mockResolvedValue(true);
  useSessionsStore.getState().setIndependent(sessions() as never);
});

describe("Sidebar 批量选择 (G1-30)", () => {
  it("selects rows instead of navigating, then archives all", async () => {
    const onSelect = vi.fn();
    const onToast = vi.fn();
    render(<Sidebar {...base} onSelect={onSelect} onToast={onToast} />);
    fireEvent.click(screen.getByRole("button", { name: "批量选择任务" }));
    fireEvent.click(screen.getByText("会话一"));
    fireEvent.click(screen.getByText("会话二"));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText("已选 2 项")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择 会话一" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "归档" }));
    await waitFor(() => expect(agentSetSessionArchived).toHaveBeenCalledTimes(2));
    expect(vi.mocked(agentSetSessionArchived).mock.calls.map((c) => c[0])).toEqual(["s1", "s2"]);
    await waitFor(() => expect(screen.queryByText("已选 2 项")).toBeNull());
    expect(onToast).toHaveBeenCalledWith("已归档 2 个任务");
  });

  it("deletes after one confirmation and cancels cleanly", async () => {
    const onToast = vi.fn();
    render(<Sidebar {...base} onToast={onToast} />);
    fireEvent.click(screen.getByRole("button", { name: "批量选择任务" }));
    fireEvent.click(screen.getByText("会话一"));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(appConfirm).toHaveBeenCalledOnce());
    await waitFor(() => expect(agentDeleteSession).toHaveBeenCalledWith("s1", ""));
    expect(onToast).toHaveBeenCalledWith("已删除 1 个任务");

    // Cancelling the confirmation leaves the selection untouched.
    vi.mocked(appConfirm).mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "批量选择任务" }));
    fireEvent.click(screen.getByText("会话二"));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(appConfirm).toHaveBeenCalledTimes(2));
    expect(agentDeleteSession).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByText(/已选 \d+ 项/)).toBeNull();
  });
});
