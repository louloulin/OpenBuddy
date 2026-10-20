/**
 * AuditCenter — 授权审计日志主面板 (P1.4)
 *
 * 布局(从上到下):
 *   1. 顶部标题 + 总条数 + 操作按钮(刷新 / 导出 / 清空)
 *   2. AuditStats 统计条
 *   3. AuditFiltersBar 过滤条
 *   4. 事件表格(分页)
 *   5. 空状态/错误状态
 *
 * 数据流:
 *   - `events` 由 caller 注入(从 `auditList()` 拉取)
 *   - 过滤 + 统计 + 分页 在组件内基于 events + filters 计算
 *   - 操作按钮触发 caller 的 `onLoad / onExport / onClear` 回调
 *
 * 设计:
 *   - 纯展示组件,无内部全局状态(只持有 filters / page local state)
 *   - 不直接调 IPC,便于单测
 *   - 所有交互点带 data-testid
 */

import { useMemo, useState } from "react";

import { AuditFiltersBar } from "./AuditFiltersBar.js";
import { AuditStats } from "./AuditStats.js";
import {
  EMPTY_FILTERS,
  filterAuditEvents,
  formatAuditAt,
  formatAuditDetail,
  isFiltersEmpty,
  summarizeAuditEvents,
  type AuditEvent,
  type AuditFilters,
} from "./types.js";

export interface AuditCenterProps {
  events: ReadonlyArray<AuditEvent>;
  loading?: boolean;
  error?: string | null;
  onLoad?: () => void | Promise<void>;
  onExport?: (format: "jsonl" | "json") => void | Promise<void>;
  onClear?: () => void | Promise<void>;
  /** 默认每页条数(默认 50)。 */
  pageSize?: number;
}

export function AuditCenter(props: AuditCenterProps) {
  const { events, loading = false, error = null, onLoad, onExport, onClear, pageSize = 50 } = props;

  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [pendingExport, setPendingExport] = useState<"jsonl" | "json" | null>(null);

  const filtered = useMemo(() => filterAuditEvents(events, filters), [events, filters]);
  const summary = useMemo(() => summarizeAuditEvents(filtered), [filtered]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageEvents = useMemo(
    () => filtered.slice(page * pageSize, (page + 1) * pageSize),
    [filtered, page, pageSize],
  );

  // filter / events 变化时,回退到第一页
  const filterKey = JSON.stringify(filters) + ":" + events.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useMemo(() => { setPage(0); }, [filterKey]);

  const handleExport = async (format: "jsonl" | "json") => {
    if (!onExport) return;
    setPendingExport(format);
    try {
      await onExport(format);
    } finally {
      setPendingExport(null);
    }
  };

  return (
    <div className="audit-center" data-testid="audit-center">
      <header className="audit-center__header">
        <h2>授权审计日志</h2>
        <p className="audit-center__subtitle">
          本地优先 · 不上传 · 来自渲染层 + 主进程 + 插件 + Casdoor 的所有审计事件。
        </p>
        <div className="audit-center__actions">
          <button
            type="button"
            onClick={() => void onLoad?.()}
            disabled={loading}
            data-testid="audit-action-refresh"
          >
            {loading ? "加载中…" : "刷新"}
          </button>
          <button
            type="button"
            onClick={() => void handleExport("jsonl")}
            disabled={loading || pendingExport !== null || !onExport}
            data-testid="audit-action-export-jsonl"
          >
            {pendingExport === "jsonl" ? "导出中…" : "导出 JSONL"}
          </button>
          <button
            type="button"
            onClick={() => void handleExport("json")}
            disabled={loading || pendingExport !== null || !onExport}
            data-testid="audit-action-export-json"
          >
            {pendingExport === "json" ? "导出中…" : "导出 JSON"}
          </button>
          <button
            type="button"
            onClick={() => void onClear?.()}
            disabled={loading || !onClear}
            data-testid="audit-action-clear"
          >
            清空日志
          </button>
        </div>
      </header>

      <AuditStats summary={summary} />

      <AuditFiltersBar filters={filters} onChange={setFilters} />

      {error && (
        <p className="audit-center__error" role="alert" data-testid="audit-error">
          {error}
        </p>
      )}

      {loading ? (
        <p className="audit-center__loading" data-testid="audit-loading">加载中…</p>
      ) : filtered.length === 0 ? (
        <p className="audit-center__empty" data-testid="audit-empty">
          {isFiltersEmpty(filters) ? "暂无审计记录" : "当前过滤条件下无匹配记录"}
        </p>
      ) : (
        <>
          <table className="audit-center__table" data-testid="audit-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>来源</th>
                <th>事件</th>
                <th>结果</th>
                <th>主体</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              {pageEvents.map((e) => (
                <tr key={e.id} data-testid={`audit-row-${e.id}`}>
                  <td>{formatAuditAt(e.at)}</td>
                  <td>
                    <span className={"audit-center__source audit-center__source--" + e.source}>
                      {e.source}
                    </span>
                  </td>
                  <td><code>{e.event}</code></td>
                  <td>
                    <span className={"audit-center__outcome audit-center__outcome--" + e.outcome}>
                      {e.outcome}
                    </span>
                  </td>
                  <td>{e.subject ?? "—"}</td>
                  <td className="audit-center__detail" title={formatAuditDetail(e.detail)}>
                    {formatAuditDetail(e.detail)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <nav className="audit-center__pagination" aria-label="分页">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              data-testid="audit-page-prev"
            >
              上一页
            </button>
            <span data-testid="audit-page-info">
              第 {page + 1} / {totalPages} 页 · 共 {filtered.length} 条
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              data-testid="audit-page-next"
            >
              下一页
            </button>
          </nav>
        </>
      )}
    </div>
  );
}

// Suppress unused-import warning for internal symbols re-exported elsewhere
void EMPTY_FILTERS;
void filterAuditEvents;
void summarizeAuditEvents;
