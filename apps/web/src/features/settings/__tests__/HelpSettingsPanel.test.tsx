import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HelpSettingsPanel } from "../sections/HelpSettingsPanel";

const { diagnose, selfCheck, exportTextFile, saveDialog, copyText, logsList, logsRead, openPath } = vi.hoisted(() => ({
  diagnose: vi.fn(),
  selfCheck: vi.fn(),
  exportTextFile: vi.fn(),
  saveDialog: vi.fn(),
  copyText: vi.fn(),
  logsList: vi.fn(),
  logsRead: vi.fn(),
  openPath: vi.fn(),
}));
vi.mock("@openbuddy/client/agent-client", () => ({
  agentDiagnose: diagnose,
  agentSelfCheck: selfCheck,
  exportTextFile,
  saveFileDialog: saveDialog,
}));
vi.mock("@openbuddy/client/api/logs", () => ({ logsList, logsRead }));
vi.mock("@openbuddy/client/api/files", () => ({ openPath }));
vi.mock("@openbuddy/platform/clipboard", () => ({ copyText }));

beforeEach(() => {
  diagnose.mockReset();
  selfCheck.mockReset();
  exportTextFile.mockReset();
  saveDialog.mockReset();
  copyText.mockReset();
  logsList.mockReset();
  logsRead.mockReset();
  openPath.mockReset();
  logsList.mockResolvedValue({
    dir: "/tmp/openbuddy/logs",
    files: [{ name: "openbuddy-2026-11-20.log", size: 2048, mtimeMs: 1 }],
    totalBytes: 2048,
  });
  logsRead.mockResolvedValue({
    name: "openbuddy-2026-11-20.log",
    entries: [{ ts: "2026-11-20T10:00:00.000Z", level: "error", scope: "renderer", message: "boom" }],
    malformed: 0,
    truncated: false,
  });
});

describe("帮助与反馈 · 诊断 (pii W6.5)", () => {
  it("生成报告后显示预览，附带的反馈与摘要开关一并送到宿主", async () => {
    diagnose.mockResolvedValue({ diagnostics: "# OpenBuddy 诊断报告\n- 平台：darwin", summary: "导出按钮无响应" });
    render(<HelpSettingsPanel />);
    fireEvent.change(screen.getByPlaceholderText("复现步骤、期望结果……"), { target: { value: "点击导出无反应" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /问题摘要/ }));
    fireEvent.click(screen.getByRole("button", { name: /生成诊断报告/ }));
    await waitFor(() => expect(diagnose).toHaveBeenCalled());
    expect(diagnose.mock.calls[0][0]).toMatchObject({
      feedback: "点击导出无反应",
      includeSummary: true,
    });
    await waitFor(() => expect(screen.getByText(/OpenBuddy 诊断报告/)).toBeInTheDocument());
    expect(screen.getByText(/导出按钮无响应/)).toBeInTheDocument();
  });

  it("复制与保存都在本地进行，不上传", async () => {
    diagnose.mockResolvedValue({ diagnostics: "# OpenBuddy 诊断报告" });
    saveDialog.mockResolvedValue("/tmp/diag.txt");
    copyText.mockResolvedValue(undefined);
    exportTextFile.mockResolvedValue(undefined);
    render(<HelpSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /生成诊断报告/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^复制$/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /^复制$/ }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(expect.stringContaining("诊断报告")));
    expect(screen.getByText("已复制到剪贴板")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /保存为 \.txt/ }));
    await waitFor(() => expect(exportTextFile).toHaveBeenCalledWith("/tmp/diag.txt", expect.stringContaining("诊断报告")));
  });

  it("宿主报错时显示错误", async () => {
    diagnose.mockRejectedValue(new Error("boom"));
    render(<HelpSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /生成诊断报告/ }));
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
  });

  it("文档链接指向真实用户手册/FAQ/隐私/更新说明 (B5)", () => {
    render(<HelpSettingsPanel />);
    const href = (name: string) => screen.getByRole("link", { name }).getAttribute("href") ?? "";
    expect(href("用户手册")).toMatch(/docs\/user-guide\.md$/);
    expect(href("常见问题")).toMatch(/docs\/faq\.md$/);
    expect(href("故障排查")).toMatch(/docs\/troubleshooting\.md$/);
    expect(href("隐私说明")).toMatch(/docs\/privacy\.md$/);
    expect(href("更新说明")).toMatch(/docs\/release-notes\.md$/);
    expect(screen.queryByText(/即将上线/)).toBeNull();
  });

  it("运行日志只读展示最近的记录，可按级别筛选 (O1)", async () => {
    render(<HelpSettingsPanel />);
    await waitFor(() => expect(logsList).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
    expect(logsRead.mock.calls[0][0]).toBe("openbuddy-2026-11-20.log");
    expect(screen.getByRole("option", { name: /openbuddy-2026-11-20\.log/ })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "日志级别" }), { target: { value: "error" } });
    await waitFor(() => expect(logsRead).toHaveBeenCalledWith("openbuddy-2026-11-20.log", expect.objectContaining({ level: "error" })));

    fireEvent.click(screen.getByRole("button", { name: /打开目录/ }));
    expect(openPath).toHaveBeenCalledWith("/tmp/openbuddy/logs");
  });

  it("没有日志文件时给出空态而不是报错 (O1)", async () => {
    logsList.mockResolvedValue({ dir: "/tmp/openbuddy/logs", files: [], totalBytes: 0 });
    render(<HelpSettingsPanel />);
    await waitFor(() => expect(screen.getByText(/还没有日志文件/)).toBeInTheDocument());
    expect(logsRead).not.toHaveBeenCalled();
  });

  it("跨文件合并检索并导出为本地 .txt (O1)", async () => {
    saveDialog.mockResolvedValue("/tmp/openbuddy-logs.txt");
    exportTextFile.mockResolvedValue(undefined);
    render(<HelpSettingsPanel />);
    await screen.findByText("boom");

    fireEvent.change(screen.getByRole("combobox", { name: "选择日志文件" }), { target: { value: "all" } });
    await waitFor(() => expect(logsRead).toHaveBeenCalledWith("all", expect.objectContaining({ limit: 300 })));

    fireEvent.click(screen.getByRole("button", { name: /导出 \.txt/ }));
    await waitFor(() => expect(exportTextFile).toHaveBeenCalledWith("/tmp/openbuddy-logs.txt", expect.stringContaining("boom")));
    expect(screen.getByText(/日志已导出到/)).toBeInTheDocument();
  });
});

describe("帮助与反馈 · 启动自检 (§1.18)", () => {
  it("运行自检：默认带模型连通测试并保存，逐项显示状态与建议", async () => {
    selfCheck.mockResolvedValue({
      results: [
        { id: "system.disk", title: "磁盘空间", status: "pass", summary: "数据目录所在磁盘剩余 120.0 GB", costMs: 1 },
        { id: "model.reachable", title: "模型连通", status: "fail", summary: "MiniMax-M2.5 请求失败：401", advice: "检查网络、API Key 与服务商地址", costMs: 300 },
      ],
      counts: { pass: 1, warning: 0, fail: 1, info: 0 },
      durationMs: 1200,
      checkedAt: "2026-11-28T00:00:00.000Z",
      report: "# OpenBuddy 启动自检",
      file: "self-check-x.txt",
    });
    render(<HelpSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /运行自检/ }));
    await waitFor(() => expect(screen.getByText("1 通过 / 0 警告 / 1 失败 · 耗时 1.2 s · 已保存 self-check-x.txt")).toBeTruthy());
    expect(selfCheck).toHaveBeenCalledWith({ probeModel: true, save: true });
    const rows = screen.getByRole("list", { name: "自检结果" }).querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(rows[1].querySelector("[data-status]")?.textContent).toBe("失败");
    expect(rows[1].textContent).toContain("建议：检查网络、API Key 与服务商地址");
    fireEvent.click(screen.getByRole("button", { name: /复制结果/ }));
    expect(copyText).toHaveBeenCalledWith("# OpenBuddy 启动自检");
  });
});
