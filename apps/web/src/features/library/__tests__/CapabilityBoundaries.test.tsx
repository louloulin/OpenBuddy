import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MyFilesPanel } from "../MyFilesPanel";
import { PolicySettingsPanel } from "../../settings/PolicySettingsPanel";
import { UsageQuotaPanel } from "../../settings/UsageQuotaPanel";
import { invoke, open } from "@openbuddy/client/ipc";
import { memoryList } from "@openbuddy/client/agent-client";
vi.mock("@openbuddy/client/ipc", () => ({ invoke: vi.fn(async () => [{ name: "local.md", path: "/workspace/local.md", kind: "file", size: 12 }]), open: vi.fn() }));
vi.mock("@openbuddy/client/agent-client", () => ({ memoryList: vi.fn(async () => []) }));
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
describe("visible capability boundaries", () => {
  it("opens local files by default and never calls the deferred memory command", async () => {
    render(<MyFilesPanel cwd="/workspace" />);
    expect(await screen.findByText("local.md")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("list_dir", { path: "/workspace" });
    expect(memoryList).not.toHaveBeenCalled();
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "browse_directory")).toBe(false);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "任务成果" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "任务成果" }));
    await waitFor(() => expect(memoryList).not.toHaveBeenCalled());
    expect(screen.getByText(/本地文件.*不提供网络上传/)).toBeInTheDocument();
  });
  it("opens an explicitly selected local file without pretending to upload", async () => {
    vi.mocked(open).mockResolvedValue("/workspace/picked.md");
    render(<MyFilesPanel cwd="/workspace" />);
    await screen.findByText("local.md");
    fireEvent.click(screen.getByRole("button", { name: "选择本地文件" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("open_path", { path: "/workspace/picked.md" }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ multiple: false, directory: false }));
    expect(screen.queryByText("上传文件")).toBeNull();
  });

  it("identifies editable policy rules as a local preview without enforcement", () => {
    render(<PolicySettingsPanel />);
    expect(screen.getByText(/本地策略预览，尚未强制执行/)).toBeInTheDocument();
    expect(screen.getByText(/不会限制实际模型调用/)).toBeInTheDocument();
    expect(screen.queryByText(/企业策略的可移植替代/)).toBeNull();
  });
  it("describes quota thresholds as reminders that do not block sending", () => {
    render(<UsageQuotaPanel />);
    expect(screen.getByText(/阈值只作提醒，不会阻止发送/)).toBeInTheDocument();
    expect(screen.getByText("Token 提醒阈值")).toBeInTheDocument();
    expect(screen.getByText("Token")).toBeInTheDocument();
  });
});
