import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ArtifactInfo } from "@openbuddy/client/agent-client";
import { agentResolvePermission, turnRevert } from "@openbuddy/client/agent-client";
import { invoke } from "@openbuddy/client/ipc";
import { Workbench } from "../Workbench";
import { ArtifactCards, type ArtifactsApi } from "../../chat/ArtifactCards";
import { PermissionCard } from "../../approvals/PermissionDialog";
import { revertToolCalls } from "../revert";
import { parseUserText, withModeInstruction } from "@openbuddy/chat-core/user-text";
import { useExtensionUiStore } from "@/features/approvals/state/extension-ui-store";
import { previewUrl } from "@openbuddy/client/agent-client";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";
import type { ReactElement } from "react";
const themed = (ui: ReactElement) => <ThemeProvider>{ui}</ThemeProvider>;

vi.mock("@openbuddy/client/ipc", () => ({
  invoke: vi.fn(async (command: string) => (command === "read_text_file" ? "# Report\n\nhello" : command === "read_dir" ? [] : null)),
  save: vi.fn(),
  listen: vi.fn(async () => () => {}),
  hasPreloadBridge: () => true,
}));
vi.mock("@openbuddy/client/agent-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openbuddy/client/agent-client")>();
  return {
    ...actual,
    agentResolvePermission: vi.fn(async () => {}),
    turnRevert: vi.fn(async () => ({ restored: ["/w/a.md"], conflicts: [] })),
    checkpointList: vi.fn(async () => []),
    checkpointRead: vi.fn(),
    checkpointRestore: vi.fn(),
  };
});
vi.mock("../../../shared/ui/AppDialog", () => ({ appConfirm: vi.fn(async () => true), appConfirmWithOption: vi.fn(async () => ({ ok: true, checked: true })) }));

const art = (path: string, status: ArtifactInfo["status"] = "created", extra: Partial<ArtifactInfo> = {}): ArtifactInfo => ({
  path, status, toolCallIds: [`t:${path}`], added: 3, removed: status === "created" ? 0 : 1, firstAt: Date.now(), lastAt: Date.now(), exists: true, size: 2048, ...extra,
});

beforeEach(() => vi.clearAllMocks());

describe("工作台", () => {
  const base = {
    sessionId: "s1", cwd: "/w", version: 1, toolCall: null, onClose: vi.fn(), onRefresh: vi.fn(),
    onAddToChat: vi.fn(), onAskEdit: vi.fn(), onToast: vi.fn(),
  };

  it("lists only artifacts and opens one in its own tab without losing the list", async () => {
    render(themed(<Workbench {...base} artifacts={[art("/w/docs/report.md"), art("/w/src/a.ts", "modified")]} focus={{ kind: "list" }} />));
    expect(screen.getByText("report.md")).toBeInTheDocument();
    expect(screen.getByText("新建")).toBeInTheDocument();
    expect(screen.getByText("修改")).toBeInTheDocument();
    fireEvent.click(screen.getByText("report.md"));
    expect(await screen.findByRole("tab", { name: "report.md" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("read_text_file", expect.objectContaining({ path: "/w/docs/report.md" })));
    // The list tab is still there.
    fireEvent.click(screen.getByRole("tab", { name: /产物/ }));
    expect(screen.getByText("a.ts")).toBeInTheDocument();
  });

  it("shows an honest empty state", () => {
    render(<Workbench {...base} artifacts={[]} focus={{ kind: "list" }} />);
    expect(screen.getByText("还没有产物")).toBeInTheDocument();
    expect(screen.getByText(/只读取过的文件不算产物/)).toBeInTheDocument();
  });

  it("focus targets switch tabs (变更 / file)", async () => {
    const { rerender } = render(themed(<Workbench {...base} artifacts={[art("/w/a.md")]} focus={{ kind: "changes", path: "/w/a.md" }} />));
    expect(screen.getByRole("tab", { name: /变更/ })).toHaveAttribute("aria-selected", "true");
    rerender(themed(<Workbench {...base} artifacts={[art("/w/a.md")]} focus={{ kind: "file", path: "/w/a.md" }} />));
    expect(await screen.findByRole("tab", { name: "a.md" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("回合内产物卡片", () => {
  it("shows up to 3 cards, the rest as a count, and routes clicks", () => {
    const api: ArtifactsApi = { all: [], open: vi.fn(), openChanges: vi.fn(), openList: vi.fn(), revert: vi.fn() };
    const items = [art("/w/1.md"), art("/w/2.ts", "modified"), art("/w/3.csv"), art("/w/4.json")];
    render(<ArtifactCards items={items} total={9} api={api} />);
    expect(screen.queryByText("4.json")).not.toBeInTheDocument();
    expect(screen.getByText(/还有 1 个 · 查看所有产物（9）/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("1.md"));
    expect(api.open).toHaveBeenCalledWith("/w/1.md");
    fireEvent.click(screen.getByText("查看变更"));
    expect(api.openChanges).toHaveBeenCalledWith("/w/2.ts");
  });
});

describe("审批卡", () => {
  const request = (extra = {}) => ({
    requestId: "r1", sessionId: "s1", toolCallId: "t1", toolKind: "bash" as const, title: "bash", rawInput: { command: "rm -rf out" },
    options: [{ optionId: "allow", kind: "allow_once", name: "允许本次" }, { optionId: "allow_session", kind: "allow_always", name: "本任务允许" }, { optionId: "deny", kind: "reject_once", name: "拒绝" }],
    ...extra,
  });

  it("denies with a reason the agent receives", async () => {
    render(<PermissionCard request={request() as never} />);
    fireEvent.click(screen.getByText("拒绝并说明…"));
    fireEvent.change(screen.getByPlaceholderText(/为什么拒绝/), { target: { value: "先备份" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/为什么拒绝/), { key: "Enter" });
    await waitFor(() => expect(agentResolvePermission).toHaveBeenCalledWith("r1", { optionId: "deny", reason: "先备份" }));
  });

  it("asks harder for deletions and offers 始终允许 only when the engine does", () => {
    const { unmount } = render(<PermissionCard request={request({ destructive: { command: "rm -rf out", paths: ["out"] } }) as never} />);
    expect(screen.getByText("Buddy 想删除文件，需要你确认")).toBeInTheDocument();
    expect(screen.getByText("允许删除")).toBeInTheDocument();
    expect(screen.queryByText("始终允许")).not.toBeInTheDocument();
    unmount();
    render(<PermissionCard request={request({ rawInput: { path: "a.md" }, toolKind: "write", options: [...request().options, { optionId: "allow_always", kind: "allow_always", name: "始终允许" }] }) as never} />);
    fireEvent.click(screen.getByText("始终允许"));
    expect(agentResolvePermission).toHaveBeenCalledWith("r1", { optionId: "allow_always", reason: undefined });
  });

  it("Esc denies", async () => {
    render(<PermissionCard request={request() as never} />);
    fireEvent.keyDown(screen.getByText("允许本次"), { key: "Escape" });
    await waitFor(() => expect(agentResolvePermission).toHaveBeenCalledWith("r1", { optionId: "deny", reason: undefined }));
  });
});

describe("还原 / 模式 / 扩展状态", () => {
  it("reverts and reports what happened", async () => {
    const onToast = vi.fn();
    const onChanged = vi.fn();
    await revertToolCalls("s1", ["t1"], { onToast, onChanged });
    expect(turnRevert).toHaveBeenCalledWith("s1", ["t1"]);
    expect(onToast).toHaveBeenCalledWith("已还原 1 个文件");
    expect(onChanged).toHaveBeenCalled();
  });

  it("hides the mode instruction from the bubble but remembers the mode", () => {
    const sent = withModeInstruction("整理一下 README", "plan");
    expect(sent).toContain("<openbuddy-plan-mode>");
    expect(parseUserText(sent)).toMatchObject({ text: "整理一下 README", mode: "plan" });
    expect(withModeInstruction("x", "craft")).toBe("x");
    expect(parseUserText("<!--EXPERT_PERSONA_BEGIN-->p<!--EXPERT_PERSONA_END-->" + withModeInstruction("问题", "ask"))).toMatchObject({ text: "问题", mode: "ask" });
  });

  it("keeps the working message on setWorkingVisible(true) and clears it on null", () => {
    act(() => useExtensionUiStore.getState().apply({ sessionId: "e", kind: "working", message: "索引中" }));
    act(() => useExtensionUiStore.getState().apply({ sessionId: "e", kind: "working", visible: true }));
    expect(useExtensionUiStore.getState().sessions.e.working).toBe("索引中");
    act(() => useExtensionUiStore.getState().apply({ sessionId: "e", kind: "working", message: null }));
    expect(useExtensionUiStore.getState().sessions.e.working).toBeUndefined();
  });

  it("builds isolated preview URLs per path segment", () => {
    expect(previewUrl("/home/u/报告 1.html")).toBe("ob-preview://local/home/u/%E6%8A%A5%E5%91%8A%201.html");
    expect(previewUrl("C:\\Users\\a.pdf")).toBe("ob-preview://local/C%3A/Users/a.pdf");
  });
});
