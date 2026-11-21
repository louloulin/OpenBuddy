import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  agentBash: vi.fn(async () => ({ id: "r1", exitCode: 0, cancelled: false, truncated: false, output: "", excludeFromContext: false })),
  filesSearch: vi.fn(async () => ({ cwd: "/work", partial: false, hits: [
    { path: "docs/report.md", name: "report.md", size: 10, mtimeMs: 1 },
    { path: "src/report-utils.ts", name: "report-utils.ts", size: 10, mtimeMs: 1 },
    { path: "img/chart.png", name: "chart.png", size: 10, mtimeMs: 1 },
  ] })),
  artifactsList: vi.fn(async () => [
    { path: "/work/out/report-final.md", status: "created", toolCallIds: ["t1"], added: 3, removed: 0, firstAt: 1, lastAt: 2, exists: true },
    { path: "/work/gone.md", status: "created", toolCallIds: ["t2"], added: 1, removed: 0, firstAt: 1, lastAt: 1, exists: false },
  ]),
}));
vi.mock("@openbuddy/client/agent-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openbuddy/client/agent-client")>()),
  agentBash: mocks.agentBash,
  filesSearch: mocks.filesSearch,
  artifactsList: mocks.artifactsList,
  commandsList: vi.fn(async () => []),
}));

import { Composer } from "../Composer";
import { parseBang } from "../useBangCommand";

const type = (input: HTMLElement, value: string) =>
  fireEvent.change(input, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
const base = { streaming: false, onCancel: vi.fn() };

describe("`!command` in the composer (W1.2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses ! and !!", () => {
    expect(parseBang("!ls -la")).toEqual({ command: "ls -la", excluded: false });
    expect(parseBang("  !!git status ")).toEqual({ command: "git status", excluded: true });
    expect(parseBang("hello !there")).toBeNull();
  });

  it("shows bash mode and runs the command in the task instead of sending a prompt", async () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} usageSessionId="s1" cwd="/work" />);
    const input = screen.getByRole("textbox");
    type(input, "!echo hello");
    expect(screen.getByText("命令模式")).toBeInTheDocument();
    expect(screen.getByText(/输出会随下一条消息发给 Buddy/)).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.agentBash).toHaveBeenCalledWith("s1", "echo hello", { excludeFromContext: false, risk: "low" }));
    expect(onSend).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByText("命令模式")).toBeNull();
  });

  it("`!!` keeps the output from Buddy; risky commands are flagged and handed to the engine as such", async () => {
    render(<Composer {...base} onSend={vi.fn()} usageSessionId="s1" cwd="/work" />);
    const input = screen.getByRole("textbox");
    type(input, "!!rm -rf /");
    expect(screen.getByText(/!! 运行：输出只给你看/)).toBeInTheDocument();
    expect(screen.getByText(/高危 · 递归强制删除危险路径/)).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.agentBash).toHaveBeenCalledWith("s1", "rm -rf /", { excludeFromContext: true, risk: "high" }));
  });

  it("outside a task (or while a reply runs) the command is kept and not run", () => {
    const onToast = vi.fn();
    const { rerender } = render(<Composer {...base} onSend={vi.fn()} onToast={onToast} />);
    const input = screen.getByRole("textbox");
    type(input, "!ls");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.agentBash).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe("!ls");
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("命令要在任务里运行"));
    const onEnqueue = vi.fn();
    rerender(<Composer {...base} streaming onSend={vi.fn()} onToast={onToast} usageSessionId="s1" onEnqueue={onEnqueue} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onEnqueue).not.toHaveBeenCalled();
    expect(mocks.agentBash).not.toHaveBeenCalled();
    expect(onToast).toHaveBeenLastCalledWith("回复进行中，完成后再运行命令。");
  });
});

describe("`@` file mention (W1.3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists this task's artifacts first, then workspace files, and inserts the picked path", async () => {
    render(<Composer {...base} onSend={vi.fn()} usageSessionId="s1" cwd="/work" />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    type(input, "check @rep");
    const list = await screen.findByRole("listbox", { name: "引用文件" });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4));
    expect(mocks.filesSearch).toHaveBeenCalledWith("/work", "rep");
    expect(mocks.artifactsList).toHaveBeenCalledWith("s1");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("report-final.md"),
      expect.stringContaining("report.md"),
      expect.stringContaining("report-utils.ts"),
      expect.stringContaining("chart.png"),
    ]);
    expect(list).toHaveTextContent("本任务产物");
    expect(list).toHaveTextContent("工作空间文件");
    expect(screen.getAllByRole("option")[3]).toHaveTextContent("图片");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("check @docs/report.md ");
    expect(screen.queryByRole("listbox", { name: "引用文件" })).toBeNull();
  });

  it("Esc closes the list without sending; no list on the home page", async () => {
    const onSend = vi.fn();
    const { unmount } = render(<Composer {...base} onSend={onSend} usageSessionId="s1" cwd="/work" />);
    const input = screen.getByRole("textbox");
    type(input, "@");
    await screen.findByRole("listbox", { name: "引用文件" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "引用文件" })).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
    unmount();
    const before = mocks.filesSearch.mock.calls.length;
    render(<Composer {...base} onSend={onSend} cwd="/work" />);
    type(screen.getByRole("textbox"), "@rep");
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByRole("listbox", { name: "引用文件" })).toBeNull();
    expect(mocks.filesSearch.mock.calls.length).toBe(before);
  });
});
