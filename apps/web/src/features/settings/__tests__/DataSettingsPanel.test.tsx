import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataSettingsPanel } from "../sections/DataSettingsPanel";

const { openDialog, importJsonl, exportBundle, restoreBundle, listSnapshots, restoreSnapshot, saveAs, readFile, confirm } = vi.hoisted(() => ({
  openDialog: vi.fn(),
  importJsonl: vi.fn(),
  exportBundle: vi.fn(),
  restoreBundle: vi.fn(),
  listSnapshots: vi.fn(),
  restoreSnapshot: vi.fn(),
  saveAs: vi.fn(),
  readFile: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@openbuddy/client/agent-client", () => ({ agentImportJsonl: importJsonl, openFileDialog: openDialog }));
vi.mock("@openbuddy/client/api/data", () => ({
  dataExport: exportBundle,
  dataRestore: restoreBundle,
  dataSnapshots: listSnapshots,
  dataSnapshotRestore: restoreSnapshot,
}));
vi.mock("@openbuddy/client/api/native", () => ({ saveTextAs: saveAs }));
vi.mock("@openbuddy/client/api/files", () => ({ readTextFile: readFile }));
vi.mock("../../../shared/ui/AppDialog", () => ({ appConfirm: confirm }));

beforeEach(() => {
  openDialog.mockReset();
  importJsonl.mockReset();
  exportBundle.mockReset();
  restoreBundle.mockReset();
  restoreSnapshot.mockReset();
  saveAs.mockReset();
  readFile.mockReset();
  confirm.mockReset();
  listSnapshots.mockReset();
  listSnapshots.mockResolvedValue({ snapshots: [] });
  confirm.mockResolvedValue(true);
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

describe("数据管理 · 全量导出/恢复与快照 (A2)", () => {
  const bundle = {
    kind: "openbuddy-data",
    schemaVersion: 1,
    exportedAt: "2026-11-20T00:00:00.000Z",
    files: { "projects.json": { schemaVersion: 1, projects: [] } },
    omitted: ["credentials.enc.json"],
  };

  it("导出全部数据并说明密钥不含在包内", async () => {
    exportBundle.mockResolvedValue({ bundle });
    saveAs.mockResolvedValue("/tmp/openbuddy-data.json");
    render(<DataSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /导出全部数据/ }));
    await waitFor(() => expect(saveAs).toHaveBeenCalled());
    const [defaultPath, text] = saveAs.mock.calls[0];
    expect(defaultPath).toMatch(/openbuddy-data-\d{4}-\d{2}-\d{2}\.json/);
    expect(JSON.parse(text).kind).toBe("openbuddy-data");
    await waitFor(() => expect(screen.getByText(/密钥（credentials\.enc\.json）不在导出包内/)).toBeInTheDocument());
  });

  it("从数据包恢复，确认后才写入并提示重启", async () => {
    openDialog.mockResolvedValue("/tmp/bundle.json");
    readFile.mockResolvedValue(JSON.stringify(bundle));
    restoreBundle.mockResolvedValue({ restored: ["projects.json"], skipped: [], snapshotId: "s1", restartRequired: true });
    render(<DataSettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /从数据包恢复/ }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await waitFor(() => expect(restoreBundle).toHaveBeenCalledWith(bundle));
    await waitFor(() => expect(screen.getByText(/重启应用后生效/)).toBeInTheDocument());
  });

  it("列出快照并回滚", async () => {
    const snapshot = { id: "101-startup", at: "2026-11-20T00:00:00.000Z", label: "startup", schemaVersion: 1, files: [{ name: "projects.json", bytes: 10 }] };
    listSnapshots.mockResolvedValue({ snapshots: [snapshot] });
    restoreSnapshot.mockResolvedValue({ restored: ["projects.json"], skipped: [], snapshotId: "s2", restartRequired: true });
    render(<DataSettingsPanel />);
    await waitFor(() => expect(screen.getByText(/启动快照/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /回滚/ }));
    await waitFor(() => expect(restoreSnapshot).toHaveBeenCalledWith("101-startup"));
    await waitFor(() => expect(screen.getByText(/已从快照恢复 1 个文件/)).toBeInTheDocument());
  });
});
