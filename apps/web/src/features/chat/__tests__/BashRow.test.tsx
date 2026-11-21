import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ agentBashAbort: vi.fn(async () => {}), agentResolvePermission: vi.fn(async () => {}) }));
vi.mock("@openbuddy/client/agent-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openbuddy/client/agent-client")>()),
  agentBashAbort: mocks.agentBashAbort,
  agentResolvePermission: mocks.agentResolvePermission,
}));

import { NoticeRow } from "../chat-view/rows";
import { PermissionCard } from "../../approvals/PermissionDialog";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";
import { useSessionStore, type ChatMessage } from "@/features/chat/state/session-store";

const row = (bash: NonNullable<ChatMessage["meta"]>["bash"], text = ""): ChatMessage => ({ id: "b1", role: "notice", complete: !bash?.running, parts: text ? [{ kind: "text", text }] : [], meta: { notice: "bash", bash } });

describe("`!command` row (W1.2)", () => {
  beforeEach(() => { vi.clearAllMocks(); useSessionStore.getState().setSession("s1"); });

  it("streams with a stop button, then shows how it ended and whether Buddy sees it", () => {
    const { rerender } = render(<ThemeProvider><NoticeRow message={row({ id: "r1", command: "npm test", running: true }, "running tests")} /></ThemeProvider>);
    expect(screen.getByRole("group", { name: "命令 npm test" })).toHaveTextContent("运行中");
    expect(screen.getByText("Buddy 可见")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(mocks.agentBashAbort).toHaveBeenCalledWith("s1");
    rerender(<ThemeProvider><NoticeRow message={row({ id: "r1", command: "npm test", exitCode: 1, excluded: true }, "1 failed")} /></ThemeProvider>);
    expect(screen.getByText("退出码 1")).toBeInTheDocument();
    expect(screen.getByText("未发送给 Buddy")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "停止" })).toBeNull();
  });

  it("folds long output to its tail", () => {
    const text = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    render(<ThemeProvider><NoticeRow message={row({ command: "seq 40", exitCode: 0 }, text)} /></ThemeProvider>);
    expect(screen.getByText(/前面还有 26 行/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开全部（40 行）" }));
    expect(document.querySelector(".bash-row__output")!.textContent).toBe(text);
  });

  it("asks a strong confirmation for a typed deleting command (no grant for later)", () => {
    render(<PermissionCard request={{ requestId: "q1", sessionId: "s1", toolCallId: "user-bash:r9", toolKind: "bash", title: "bash", rawInput: { command: "rm -rf build" }, destructive: { command: "rm -rf build", paths: ["build"] }, options: [{ optionId: "allow", kind: "allow", title: "仍要执行" }, { optionId: "deny", kind: "deny", title: "取消" }] }} />);
    expect(screen.getByText("这条命令会删除文件，确定要执行吗？")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "本任务允许" })).toBeNull();
    expect(screen.queryByRole("button", { name: "始终允许" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "仍要执行" }));
    expect(mocks.agentResolvePermission).toHaveBeenCalledWith("q1", { optionId: "allow", reason: undefined });
  });
});
