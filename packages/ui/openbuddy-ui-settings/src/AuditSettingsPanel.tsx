/**
 * AuditSettingsPanel — 数据管理 → 本地审计追踪 (P1.4 集成)
 *
 * 历史:R17 / Phase D 内嵌实现,267 行(含自定义过滤/统计/分页/导出 UI)。
 * 重构后:用 `@openbuddy/ui-audit-center` 替换自定义 UI,保留
 * R41 save() 一次性审批 + confirm() 危险确认的副作用行为。
 *
 * 适配层职责:
 *   1. 把 `auditList/auditClear/auditExport` 转成 `AuditCenter` 的回调契约
 *   2. 保留 `save()` 原生对话框(导出路径必须用户选定,R41 不允许任意写盘)
 *   3. 保留 `confirm()` 二次确认(清空不可撤销)
 *   4. 保留 toast 反馈(导出成功 / 清空成功)
 *
 * 单元测试:`__tests__/AuditSettingsPanel.test.tsx`(覆盖适配层 4 个 callback)
 */
import { useCallback, useEffect, useState } from "react";

import {
  AuditCenter,
  type AuditEvent as CenterEvent,
} from "@openbuddy/ui-audit-center";
import { auditClear, auditExport, auditList } from "@/lib/audit/audit-client";
import { confirm, save } from "@/lib/platform/electron-api";

import { setToast } from "@/stores/toast-store";

/**
 * Adapter:src/lib/audit/audit-client 的 AuditEvent 与 ui-audit-center 的
 * AuditEvent shape 完全一致(hash 字段都存在),但类型来自不同包,
 * 这里只做显式 cast 以保留双侧独立演化空间。
 */
type SettingsAuditEvent = import("@/lib/audit/audit-client").AuditEvent;

function toCenterEvent(e: SettingsAuditEvent): CenterEvent {
  // shape 完全一致(同 AuditOutcome / AuditSource / hash / detail 字段)
  return e as unknown as CenterEvent;
}

export function AuditSettingsPanel() {
  const [events, setEvents] = useState<CenterEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await auditList({ limit: 200 });
      setEvents(result.events.map(toCenterEvent));
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  /**
   * R41 — 导出:先让用户在原生保存对话框选目标,再走 `audit:export`。
   * 取消选择什么都不做(不写用户没同意的地方)。
   */
  const handleExport = useCallback(async (format: "jsonl" | "json") => {
    const stamp = new Date().toISOString().slice(0, 10);
    const extension = format === "json" ? "json" : "jsonl";
    const target = await save({
      title: "导出本地审计日志",
      defaultPath: `openbuddy-audit-${stamp}.${extension}`,
      filters: [{ name: format === "json" ? "JSON" : "JSON Lines", extensions: [extension] }],
    });
    if (!target) return;
    const result = await auditExport({ path: target, format });
    if (result.ok) {
      await reload();
      setToast(`已导出 ${result.count ?? 0} 条审计事件(${((result.bytes ?? 0) / 1024).toFixed(1)} KB)`);
      return;
    }
    setError(result.error ?? "导出失败");
  }, [reload]);

  /**
   * R40 — 清空:必须 confirm(漏 await 会让「不可撤销」的确认形同虚设)。
   */
  const handleClear = useCallback(async () => {
    const ok = await confirm(
      "清空本地审计日志?此操作不可撤销,清空前请确保不再需要这些事件用于排障。",
      { tone: "danger", confirmLabel: "清空" },
    );
    if (!ok) return;
    try {
      await auditClear();
      await reload();
      setToast("已清空本地审计日志");
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    }
  }, [reload]);

  return (
    <AuditCenter
      events={events}
      loading={loading}
      error={error}
      pageSize={50}
      onLoad={reload}
      onExport={handleExport}
      onClear={handleClear}
    />
  );
}
