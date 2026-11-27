import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InputAddMenu } from "../InputAddMenu";
import { artifactsList, listDir, sessionMcpGet, sessionMcpSet } from "@openbuddy/client/agent-client";

vi.mock("@openbuddy/client/agent-client", () => ({
  artifactsList: vi.fn().mockResolvedValue([]),
  expertsLoad: vi.fn().mockResolvedValue({ experts: [] }),
  listDir: vi.fn().mockResolvedValue([]),
  skillsList: vi.fn().mockResolvedValue([]),
  sessionMcpGet: vi.fn(),
  sessionMcpSet: vi.fn(),
}));

const appsListMock = vi.fn();
const appsIconMock = vi.fn();
vi.mock("@openbuddy/client/api/files", () => ({
  appsList: (...args: unknown[]) => appsListMock(...args),
  appsIcon: (...args: unknown[]) => appsIconMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  appsListMock.mockResolvedValue([]);
  appsIconMock.mockResolvedValue({ dataUri: null });
  vi.mocked(sessionMcpGet).mockResolvedValue({ servers: [{ name: "filesystem", enabled: true }] });
  vi.mocked(sessionMcpSet).mockResolvedValue({ servers: [{ name: "filesystem", enabled: false }] });
});

describe("输入卡应用快捷图标 (WorkBuddy 对齐，gap E)", () => {
  it("装了应用时 `+` 旁出现应用图标，点击填入首个场景 prompt", async () => {
    appsListMock.mockResolvedValue([
      { id: "upup", name: "upup", kind: "app", packageSource: "/repo/upup", sceneList: [{ id: "deep", name: "个股深研", prompt: "/invest 600519.SH" }] },
    ]);
    const onPickPrompt = vi.fn();
    render(<InputAddMenu onPickFiles={vi.fn()} onPickPrompt={onPickPrompt} />);
    fireEvent.click(await screen.findByRole("button", { name: "应用 upup" }));
    expect(onPickPrompt).toHaveBeenCalledWith("/invest 600519.SH");
  });

  it("没有安装应用时不显示快捷图标", async () => {
    render(<InputAddMenu onPickFiles={vi.fn()} />);
    await waitFor(() => expect(appsListMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /^应用 / })).toBeNull();
  });
});

describe("“+” 菜单 · 本任务连接器开关 (pii W2.4 P2)", () => {
  it("lists the session's MCP servers and toggles one in place", async () => {
    render(<InputAddMenu onPickFiles={vi.fn()} sessionId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    const item = screen.getByText("连接器").closest(".iam-item");
    expect(item).toBeTruthy();
    fireEvent.mouseEnter(item!);
    await waitFor(() => expect(screen.getByRole("button", { name: /filesystem/ })).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(screen.getByRole("button", { name: /filesystem/ }));
    await waitFor(() => expect(sessionMcpSet).toHaveBeenCalledWith("s1", "filesystem", false));
  });

  it("exposes menu semantics and supports keyboard navigation", async () => {
    render(<InputAddMenu onPickFiles={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "添加" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "添加到任务" });

    // ArrowDown moves focus into the menu, then between items.
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("添加文件");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("模式");

    // Escape closes the menu and returns focus to the trigger.
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("explains that the home page has no task yet", async () => {
    render(<InputAddMenu onPickFiles={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    fireEvent.mouseEnter(screen.getByText("连接器").closest(".iam-item")!);
    await waitFor(() => expect(screen.getByText("打开任务后可切换本任务连接器")).toBeInTheDocument());
    expect(sessionMcpGet).not.toHaveBeenCalled();
  });

  it("inserts a file produced in this task as a reference (G1-15)", async () => {
    vi.mocked(artifactsList).mockResolvedValue([{
      path: "/workspace/report.md", status: "created", toolCallIds: ["t1"],
      added: 10, removed: 0, firstAt: 1, lastAt: 2, exists: true, size: 120,
    }]);
    const onReferenceFile = vi.fn();
    render(<InputAddMenu onPickFiles={vi.fn()} sessionId="s1" onReferenceFile={onReferenceFile} />);
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    fireEvent.mouseEnter(screen.getByText("引用对话中的文件").closest(".iam-item")!);
    fireEvent.click(await screen.findByRole("button", { name: /report\.md/ }));
    expect(onReferenceFile).toHaveBeenCalledWith("/workspace/report.md");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("also offers top-level workspace files (G1-15)", async () => {
    vi.mocked(listDir).mockResolvedValue([{ name: "notes.md", path: "/workspace/notes.md", kind: "file", size: 12 }]);
    const onReferenceFile = vi.fn();
    render(<InputAddMenu onPickFiles={vi.fn()} sessionId="s1" workspaceCwd="/workspace" onReferenceFile={onReferenceFile} />);
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    fireEvent.mouseEnter(screen.getByText("引用对话中的文件").closest(".iam-item")!);
    fireEvent.click(await screen.findByRole("button", { name: /notes\.md/ }));
    expect(onReferenceFile).toHaveBeenCalledWith("/workspace/notes.md");
  });

  it("offers 工作方式 in the menu instead of the footer (chat page)", async () => {
    const onAgentModeChange = vi.fn();
    render(<InputAddMenu onPickFiles={vi.fn()} agentMode="craft" onAgentModeChange={onAgentModeChange} />);
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(screen.queryByText("模式")).toBeNull();
    fireEvent.mouseEnter(screen.getByText("工作方式").closest(".iam-item")!);
    fireEvent.click(await screen.findByRole("button", { name: /想一想/ }));
    expect(onAgentModeChange).toHaveBeenCalledWith("plan");
  });
});
