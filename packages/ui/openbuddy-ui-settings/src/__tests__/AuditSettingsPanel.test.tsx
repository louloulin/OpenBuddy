// @vitest-environment jsdom
/**
 * AuditSettingsPanel 适配层契约测试 (P1.4 集成 — 替换 R17 内嵌实现)
 *
 * 覆盖适配层的 4 个 callback:
 *   - onLoad → auditList({ limit: 200 })
 *   - onExport("jsonl") → save() → auditExport(path, "jsonl") → setToast
 *   - onExport("json")  → save() → auditExport(path, "json")  → setToast
 *   - onClear  → confirm() → auditClear() → setToast
 *
 * 不验证 AuditCenter 内部(那是 ui-audit-center 的职责);这里只验证适配层
 * 把 IPC 调用、save() 一次性审批、confirm() 危险确认正确串联起来。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// 必须在 import AuditSettingsPanel 之前 mock
const auditListMock = vi.fn();
const auditExportMock = vi.fn();
const auditClearMock = vi.fn();
const saveMock = vi.fn();
const confirmMock = vi.fn();
const setToastMock = vi.fn();

vi.mock("@/lib/audit/audit-client", () => ({
  auditList: (...args: unknown[]) => auditListMock(...args),
  auditExport: (...args: unknown[]) => auditExportMock(...args),
  auditClear: (...args: unknown[]) => auditClearMock(...args),
}));

vi.mock("@/lib/platform/electron-api", () => ({
  save: (...args: unknown[]) => saveMock(...args),
  confirm: (...args: unknown[]) => confirmMock(...args),
}));

vi.mock("@/stores/toast-store", () => ({
  setToast: (...args: unknown[]) => setToastMock(...args),
}));

import { AuditSettingsPanel } from "../AuditSettingsPanel.js";

const SAMPLE = [
  { id: "e1", at: "2026-09-24T08:00:00.000Z", event: "settings.open", outcome: "info", source: "renderer" },
  { id: "e2", at: "2026-09-24T09:00:00.000Z", event: "auth.login", outcome: "success", source: "main", subject: "user-1" },
];

beforeEach(() => {
  auditListMock.mockReset();
  auditExportMock.mockReset();
  auditClearMock.mockReset();
  saveMock.mockReset();
  confirmMock.mockReset();
  setToastMock.mockReset();
  auditListMock.mockResolvedValue({ events: SAMPLE });
  auditExportMock.mockResolvedValue({ ok: true, count: 10, bytes: 2048 });
  auditClearMock.mockResolvedValue(undefined);
  saveMock.mockResolvedValue("/user/chosen/audit.jsonl");
  confirmMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// onLoad → auditList({ limit: 200 })
// ===========================================================================

describe("AuditSettingsPanel — onLoad", () => {
  it("挂载时调用 auditList({ limit: 200 }) 拉取事件", async () => {
    render(<AuditSettingsPanel />);
    await waitFor(() => expect(auditListMock).toHaveBeenCalledTimes(1));
    expect(auditListMock).toHaveBeenCalledWith({ limit: 200 });
  });

  it("点击「刷新」按钮再次触发 auditList", async () => {
    render(<AuditSettingsPanel />);
    await waitFor(() => expect(auditListMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("audit-action-refresh"));
    await waitFor(() => expect(auditListMock).toHaveBeenCalledTimes(2));
  });

  it("auditList 失败时显示错误,events 列表清空", async () => {
    auditListMock.mockRejectedValueOnce(new Error("disk full"));
    render(<AuditSettingsPanel />);
    await waitFor(() => expect(auditListMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByTestId("audit-error")).toHaveTextContent("disk full");
    });
  });
});

// ===========================================================================
// onExport → save() → auditExport
// ===========================================================================

describe("AuditSettingsPanel — onExport(JSONL)", () => {
  it("导出 JSONL:先 save() 让用户选路径,再 auditExport(path, \"jsonl\")", async () => {
    render(<AuditSettingsPanel />);
    await waitFor(() => expect(auditListMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("audit-action-export-jsonl"));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const saveArgs = saveMock.mock.calls[0][0] as { defaultPath: string; filters: Array<{ name: string; extensions: string[] }> };
    expect(saveArgs.defaultPath).toMatch(/^openbuddy-audit-\d{4}-\d{2}-\d{2}\.jsonl$/);
    expect(saveArgs.filters[0].extensions).toEqual(["jsonl"]);
    await waitFor(() => expect(auditExportMock).toHaveBeenCalledTimes(1));
    expect(auditExportMock).toHaveBeenCalledWith({ path: "/user/chosen/audit.jsonl", format: "jsonl" });
  });

  it("导出成功 → setToast 显示「已导出 N 条审计事件(KB)」", async () => {
    render(<AuditSettingsPanel />);
    await waitFor(() => expect(auditListMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("audit-action-export-jsonl"));
    await waitFor(() => expect(setToastMock).toHaveBeenCalled());
    const toastText = String(setToastMock.mock.calls[0][0]);
    expect(toastText).toMatch(/已导出 10 条审计事件/);
    expect(toastText).toMatch(/KB/);
  });

  it("导出成功后 reload(),把 audit.export 新条目拉进来", async () => {
    render(<AuditSettingsPanel />);
    await waitFor(() => expect(auditListMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("audit-action-export-jsonl"));
    await waitFor(() => expect(setToastMock).toHaveBeenCalled());
    await waitFor(() => expect(auditListMock).toHaveBeenCalledTimes(2));
  });

  it("导出失败时显示 error 文案,不 toast", async () => {
    auditExportMock.mockResolvedValueOnce({ ok: false, error: "路径未通过审批" });
    render(<AuditSettingsPanel />);
    await waitFor(() => expect(auditListMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("audit-action-export-jsonl"));
    await waitFor(() => expect(auditExportMock).toHaveBeenCalled());
    expect(setToastMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("audit-error")).toHaveTextContent("路径未通过审批");
  });

  it("用户取消 save()(返回 null)时,什么都不做(不写用户没同意的地方)", async () => {
    saveMock.mockResolvedValueOnce(null);
    render(<AuditSettingsPanel />);
    await waitFor(() => expect(auditListMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("audit-action-export-jsonl"));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(auditExportMock).not.toHaveBeenCalled();
    expect(setToastMock).not.toHaveBeenCalled();
  });
});

describe("AuditSettingsPanel — onExport(JSON)", () => {
  it("导出 JSON:save 过滤器 extensions = ['json']", async () => {
    render(<AuditSettingsPanel />);
    await waitFor(() => expect(auditListMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("audit-action-export-json"));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    const saveArgs = saveMock.mock.calls[0][0] as { filters: Array<{ extensions: string[] }> };
    expect(saveArgs.filters[0].extensions).toEqual(["json"]);
  });

  it("导出 JSON 触发 auditExport(format: 'json')", async () => {
    render(<AuditSettingsPanel />);
    await waitFor(() => expect(auditListMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("audit-action-export-json"));
    await waitFor(() => expect(auditExportMock).toHaveBeenCalled());
    expect(auditExportMock).toHaveBeenCalledWith({ path: "/user/chosen/audit.jsonl", format: "json" });
  });
});

// ===========================================================================
// onClear → confirm() → auditClear()
// ===========================================================================

describe("AuditSettingsPanel — onClear", () => {
  it("点击「清空日志」先弹 confirm(危险确认)", async () => {
    render(<AuditSettingsPanel />);
    await waitFor(() => expect(auditListMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("audit-action-clear"));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    const confirmArgs = confirmMock.mock.calls[0];
    expect(String(confirmArgs[0])).toMatch(/清空本地审计日志/);
    expect(confirmArgs[1]).toEqual({ tone: "danger", confirmLabel: "清空" });
  });

  it("用户拒绝 confirm 时,不调用 auditClear,不 toast", async () => {
    confirmMock.mockResolvedValueOnce(false);
    render(<AuditSettingsPanel />);
    await waitFor(() => expect(auditListMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("audit-action-clear"));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(auditClearMock).not.toHaveBeenCalled();
    expect(setToastMock).not.toHaveBeenCalled();
  });

  it("用户同意 confirm 时,调用 auditClear + reload + setToast", async () => {
    render(<AuditSettingsPanel />);
    await waitFor(() => expect(auditListMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("audit-action-clear"));
    await waitFor(() => expect(auditClearMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(auditListMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(setToastMock).toHaveBeenCalledWith("已清空本地审计日志"));
  });

  it("auditClear 抛错时显示 error 文案", async () => {
    auditClearMock.mockRejectedValueOnce(new Error("delete failed"));
    render(<AuditSettingsPanel />);
    await waitFor(() => expect(auditListMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("audit-action-clear"));
    await waitFor(() => expect(screen.getByTestId("audit-error")).toHaveTextContent("delete failed"));
  });
});
