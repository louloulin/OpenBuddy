import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataSettingsPanel } from "../sections/DataSettingsPanel";

const { openDialog, importJsonl } = vi.hoisted(() => ({ openDialog: vi.fn(), importJsonl: vi.fn() }));
vi.mock("@openbuddy/client/agent-client", () => ({ agentImportJsonl: importJsonl, openFileDialog: openDialog }));

beforeEach(() => {
  openDialog.mockReset();
  importJsonl.mockReset();
});

describe("数据管理 · 会话导入 (pii W6.5)", () => {
  it("选择 JSONL 后导入为新会话", async () => {
    openDialog.mockResolvedValue("/tmp/export.jsonl");
    importJsonl.mockResolvedValue("01a1e703-97cd-77c8-81de-2ffd93db8efe");
    render(<DataSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /导入会话 JSONL/ }));
    await waitFor(() => expect(importJsonl).toHaveBeenCalledWith("/tmp/export.jsonl"));
    await waitFor(() => expect(screen.getByText(/已导入为新会话 01a1e703/)).toBeInTheDocument());
  });

  it("取消选择时不调用导入", async () => {
    openDialog.mockResolvedValue(null);
    render(<DataSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /导入会话 JSONL/ }));
    await waitFor(() => expect(openDialog).toHaveBeenCalled());
    expect(importJsonl).not.toHaveBeenCalled();
  });

  it("导入失败时显示原因", async () => {
    openDialog.mockResolvedValue("/tmp/bad.jsonl");
    importJsonl.mockRejectedValue(new Error("session_file_not_found"));
    render(<DataSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /导入会话 JSONL/ }));
    await waitFor(() => expect(screen.getByText(/导入失败：session_file_not_found/)).toBeInTheDocument());
  });
});
