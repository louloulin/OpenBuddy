// @vitest-environment jsdom
/**
 * AuditCenter 核心契约测试 (P1.4 授权审计面板)
 *
 * 覆盖:
 *   - 渲染契约:标题 / 统计 / 过滤条 / 表格 / 分页 / 空状态
 *   - 操作按钮:刷新 / 导出 jsonl / 导出 json / 清空
 *   - 多维过滤:source / outcome / 子串搜索 / 时间范围 / 清空过滤
 *   - 分页:上一页 / 下一页 / 页码信息
 *   - loading / error 状态
 *   - 只读模式(无 callback 时按钮 disabled)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AuditCenter } from "../AuditCenter.js";
import type { AuditEvent } from "../types.js";

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "e-1",
    at: "2026-09-24T10:00:00.000Z",
    event: "settings.open",
    outcome: "info",
    source: "renderer",
    subject: "user-1",
    detail: { ip: "127.0.0.1" },
    hash: "h-1",
    ...overrides,
  };
}

const sample: AuditEvent[] = [
  makeEvent({ id: "e1", at: "2026-09-24T08:00:00.000Z", event: "settings.open", outcome: "info", source: "renderer" }),
  makeEvent({ id: "e2", at: "2026-09-24T09:00:00.000Z", event: "auth.login", outcome: "success", source: "main", subject: "user-1" }),
  makeEvent({ id: "e3", at: "2026-09-24T10:00:00.000Z", event: "permission.deny", outcome: "deny", source: "ipc", subject: "user-1" }),
  makeEvent({ id: "e4", at: "2026-09-24T11:00:00.000Z", event: "permission.allow", outcome: "allow", source: "plugin" }),
  makeEvent({ id: "e5", at: "2026-09-24T12:00:00.000Z", event: "casdoor.authorize", outcome: "deny", source: "casdoor", subject: "tenant-a" }),
];

describe("AuditCenter — 渲染契约", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("渲染标题、操作按钮、统计条、过滤条、表格", () => {
    render(<AuditCenter events={sample} onLoad={vi.fn()} />);
    expect(screen.getByTestId("audit-center")).toBeInTheDocument();
    expect(screen.getByTestId("audit-stats")).toBeInTheDocument();
    expect(screen.getByTestId("audit-filters-bar")).toBeInTheDocument();
    expect(screen.getByTestId("audit-table")).toBeInTheDocument();
    expect(screen.getByTestId("audit-action-refresh")).toBeInTheDocument();
    expect(screen.getByTestId("audit-action-export-jsonl")).toBeInTheDocument();
    expect(screen.getByTestId("audit-action-export-json")).toBeInTheDocument();
    expect(screen.getByTestId("audit-action-clear")).toBeInTheDocument();
  });

  it("统计条:总数 + 按 source / outcome 分桶计数", () => {
    render(<AuditCenter events={sample} />);
    expect(screen.getByTestId("audit-stats-total")).toHaveTextContent("共 5 条");
    expect(screen.getByTestId("audit-stats-source-renderer")).toHaveTextContent("渲染层: 1");
    expect(screen.getByTestId("audit-stats-source-main")).toHaveTextContent("主进程: 1");
    expect(screen.getByTestId("audit-stats-outcome-deny")).toHaveTextContent("拒绝: 2");
    expect(screen.getByTestId("audit-stats-outcome-info")).toHaveTextContent("信息: 1");
  });

  it("空 events → 显示「暂无审计记录」占位,不渲染表格", () => {
    render(<AuditCenter events={[]} />);
    expect(screen.getByTestId("audit-empty")).toHaveTextContent("暂无审计记录");
    expect(screen.queryByTestId("audit-table")).not.toBeInTheDocument();
  });

  it("loading=true → 显示加载文案,表格被替换", () => {
    render(<AuditCenter events={sample} loading={true} />);
    expect(screen.getByTestId("audit-loading")).toHaveTextContent("加载中…");
    expect(screen.queryByTestId("audit-table")).not.toBeInTheDocument();
  });

  it("error 提示在顶部独立显示", () => {
    render(<AuditCenter events={[]} error="读取失败" />);
    expect(screen.getByTestId("audit-error")).toHaveTextContent("读取失败");
  });

  it("每行渲染时间 / source / event / outcome / subject / detail", () => {
    render(<AuditCenter events={[sample[2]]} />);
    const row = screen.getByTestId("audit-row-e3");
    expect(row).toHaveTextContent("permission.deny");
    expect(row).toHaveTextContent("ipc");
    expect(row).toHaveTextContent("deny");
    expect(row).toHaveTextContent("user-1");
    expect(row).toHaveTextContent('{"ip":"127.0.0.1"}');
  });
});

describe("AuditCenter — 操作按钮", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("点击「刷新」触发 onLoad", async () => {
    const onLoad = vi.fn(async () => undefined);
    render(<AuditCenter events={sample} onLoad={onLoad} />);
    fireEvent.click(screen.getByTestId("audit-action-refresh"));
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
  });

  it("点击「导出 JSONL」触发 onExport(\"jsonl\")", async () => {
    const onExport = vi.fn(async () => undefined);
    render(<AuditCenter events={sample} onExport={onExport} />);
    fireEvent.click(screen.getByTestId("audit-action-export-jsonl"));
    await waitFor(() => expect(onExport).toHaveBeenCalledWith("jsonl"));
  });

  it("点击「导出 JSON」触发 onExport(\"json\")", async () => {
    const onExport = vi.fn(async () => undefined);
    render(<AuditCenter events={sample} onExport={onExport} />);
    fireEvent.click(screen.getByTestId("audit-action-export-json"));
    await waitFor(() => expect(onExport).toHaveBeenCalledWith("json"));
  });

  it("点击「清空」触发 onClear", async () => {
    const onClear = vi.fn(async () => undefined);
    render(<AuditCenter events={sample} onClear={onClear} />);
    fireEvent.click(screen.getByTestId("audit-action-clear"));
    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1));
  });

  it("loading=true 时操作按钮 disabled", () => {
    render(<AuditCenter events={sample} loading={true} onLoad={vi.fn()} onExport={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByTestId("audit-action-refresh")).toBeDisabled();
    expect(screen.getByTestId("audit-action-export-jsonl")).toBeDisabled();
    expect(screen.getByTestId("audit-action-export-json")).toBeDisabled();
  });

  it("无 onExport 时导出按钮 disabled", () => {
    render(<AuditCenter events={sample} />);
    expect(screen.getByTestId("audit-action-export-jsonl")).toBeDisabled();
    expect(screen.getByTestId("audit-action-export-json")).toBeDisabled();
  });

  it("无 onClear 时清空按钮 disabled", () => {
    render(<AuditCenter events={sample} />);
    expect(screen.getByTestId("audit-action-clear")).toBeDisabled();
  });
});

describe("AuditCenter — 过滤交互", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("点 source=main chip 后,表格只剩 source=main 的行", () => {
    render(<AuditCenter events={sample} />);
    fireEvent.click(screen.getByTestId("audit-filter-source-main"));
    // e2 是 source=main
    expect(screen.getByTestId("audit-row-e2")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-row-e1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("audit-row-e3")).not.toBeInTheDocument();
  });

  it("点 outcome=deny 后只剩 deny 行", () => {
    render(<AuditCenter events={sample} />);
    fireEvent.click(screen.getByTestId("audit-filter-outcome-deny"));
    expect(screen.getByTestId("audit-row-e3")).toBeInTheDocument();
    expect(screen.getByTestId("audit-row-e5")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-row-e2")).not.toBeInTheDocument();
  });

  it("event 子串搜索过滤", () => {
    render(<AuditCenter events={sample} />);
    fireEvent.change(screen.getByTestId("audit-filter-event-query"), { target: { value: "permission" } });
    expect(screen.getByTestId("audit-row-e3")).toBeInTheDocument();
    expect(screen.getByTestId("audit-row-e4")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-row-e2")).not.toBeInTheDocument();
  });

  it("subject 子串搜索过滤", () => {
    render(<AuditCenter events={sample} />);
    fireEvent.change(screen.getByTestId("audit-filter-subject-query"), { target: { value: "tenant" } });
    expect(screen.getByTestId("audit-row-e5")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-row-e2")).not.toBeInTheDocument();
  });

  it("过滤后表格为空 → 显示「无匹配记录」", () => {
    render(<AuditCenter events={sample} />);
    fireEvent.change(screen.getByTestId("audit-filter-event-query"), { target: { value: "nonexistent-event" } });
    expect(screen.getByTestId("audit-empty")).toHaveTextContent("当前过滤条件下无匹配记录");
  });

  it("点「清空过滤」恢复显示全部", () => {
    render(<AuditCenter events={sample} />);
    fireEvent.click(screen.getByTestId("audit-filter-source-main"));
    expect(screen.queryByTestId("audit-row-e1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("audit-filter-clear"));
    expect(screen.getByTestId("audit-row-e1")).toBeInTheDocument();
    expect(screen.getByTestId("audit-row-e5")).toBeInTheDocument();
  });

  it("清空过滤按钮在无过滤时 disabled", () => {
    render(<AuditCenter events={sample} />);
    expect(screen.getByTestId("audit-filter-clear")).toBeDisabled();
  });

  it("统计条实时反映过滤后的总数", () => {
    render(<AuditCenter events={sample} />);
    fireEvent.click(screen.getByTestId("audit-filter-outcome-deny"));
    expect(screen.getByTestId("audit-stats-total")).toHaveTextContent("共 2 条");
  });
});

describe("AuditCenter — 分页", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("pageSize=2 时只显示前 2 行,显示页码信息", () => {
    render(<AuditCenter events={sample} pageSize={2} />);
    expect(screen.getByTestId("audit-row-e1")).toBeInTheDocument();
    expect(screen.getByTestId("audit-row-e2")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-row-e3")).not.toBeInTheDocument();
    expect(screen.getByTestId("audit-page-info")).toHaveTextContent("第 1 / 3 页 · 共 5 条");
  });

  it("点「下一页」翻到第 2 页", () => {
    render(<AuditCenter events={sample} pageSize={2} />);
    fireEvent.click(screen.getByTestId("audit-page-next"));
    expect(screen.getByTestId("audit-page-info")).toHaveTextContent("第 2 / 3 页");
    expect(screen.getByTestId("audit-row-e3")).toBeInTheDocument();
    expect(screen.getByTestId("audit-row-e4")).toBeInTheDocument();
  });

  it("点「上一页」回退一页", () => {
    render(<AuditCenter events={sample} pageSize={2} />);
    fireEvent.click(screen.getByTestId("audit-page-next"));
    fireEvent.click(screen.getByTestId("audit-page-prev"));
    expect(screen.getByTestId("audit-page-info")).toHaveTextContent("第 1 / 3 页");
  });

  it("第 1 页时「上一页」disabled,最后一页时「下一页」disabled", () => {
    render(<AuditCenter events={sample} pageSize={2} />);
    expect(screen.getByTestId("audit-page-prev")).toBeDisabled();
    // 翻到最后一页
    fireEvent.click(screen.getByTestId("audit-page-next"));
    fireEvent.click(screen.getByTestId("audit-page-next"));
    expect(screen.getByTestId("audit-page-next")).toBeDisabled();
  });

  it("过滤变化时回退到第 1 页", () => {
    render(<AuditCenter events={sample} pageSize={2} />);
    fireEvent.click(screen.getByTestId("audit-page-next"));
    expect(screen.getByTestId("audit-page-info")).toHaveTextContent("第 2 / 3 页");
    fireEvent.change(screen.getByTestId("audit-filter-event-query"), { target: { value: "permission" } });
    expect(screen.getByTestId("audit-page-info")).toHaveTextContent("第 1 / 1 页 · 共 2 条");
  });
});
