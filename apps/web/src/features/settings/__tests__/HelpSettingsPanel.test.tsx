import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HelpSettingsPanel } from "../sections/HelpSettingsPanel";

const { diagnose, exportTextFile, saveDialog, copyText } = vi.hoisted(() => ({
  diagnose: vi.fn(),
  exportTextFile: vi.fn(),
  saveDialog: vi.fn(),
  copyText: vi.fn(),
}));
vi.mock("@openbuddy/client/agent-client", () => ({
  agentDiagnose: diagnose,
  exportTextFile,
  saveFileDialog: saveDialog,
}));
vi.mock("@openbuddy/platform/clipboard", () => ({ copyText }));

beforeEach(() => {
  diagnose.mockReset();
  exportTextFile.mockReset();
  saveDialog.mockReset();
  copyText.mockReset();
});

describe("帮助与反馈 · 诊断 (pii W6.5)", () => {
  it("生成报告后显示预览，附带的反馈与摘要开关一并送到宿主", async () => {
    diagnose.mockResolvedValue({ diagnostics: "# OpenBuddy 诊断报告\n- 平台：darwin", summary: "导出按钮无响应" });
    render(<HelpSettingsPanel />);
    fireEvent.change(screen.getByPlaceholderText("复现步骤、期望结果……"), { target: { value: "点击导出无反应" } });
    fireEvent.click(screen.getByRole("checkbox"));
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
    await waitFor(() => expect(screen.getByRole("button", { name: /复制/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /复制/ }));
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
});
