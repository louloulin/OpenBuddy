import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, ScrollText } from "lucide-react";
import { securityAuditList, type AuditEvent } from "@openbuddy/client/api/approvals";
import { useLocale } from "@/shared/i18n";

/**
 * 安全审计日志 (G2-5)：工具调用、权限决策、策略变更的流水。
 *
 * 数据来自主进程写的 JSONL（OpenBuddy 数据目录下的 `security/audit.jsonl`），这里只读不写；
 * 导出会把当前视图原样存成 JSON，方便用户自己归档。
 */
type Filter = "all" | "deny" | "policy" | "resolve";

const ACTION_LABEL: Record<string, string> = {
  "tool-allow": "security.audit.action.allow",
  "tool-deny": "security.audit.action.deny",
  "tool-ask": "security.audit.action.ask",
  "tool-resolve": "security.audit.action.resolve",
  "policy-deny": "security.audit.action.policy",
  "policy-change": "security.audit.action.change",
  "skill-review": "security.audit.action.skill",
};

export function SecurityAuditTab() {
  const { t } = useLocale();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEvents(await securityAuditList(200));
      setError(null);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    if (filter === "all") return events;
    if (filter === "deny") return events.filter((event) => event.action === "tool-deny");
    if (filter === "policy") return events.filter((event) => event.action === "policy-deny" || event.action === "policy-change");
    return events.filter((event) => event.action === "tool-resolve" || event.action === "tool-allow");
  }, [events, filter]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(shown, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "openbuddy-security-audit.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="sec-card">
      <div className="sec-card__head">
        <div className="sec-card__title">
          <ScrollText size={15} />
          <span>{t("security.audit.title")}</span>
        </div>
        <div className="sec-card__hint">{t("security.audit.hint")}</div>
      </div>
      {error && <div className="sec-error">{error}</div>}
      <div className="sec-add">
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label={t("security.audit.filter")}>
          <option value="all">{t("security.audit.filter.all")}</option>
          <option value="deny">{t("security.audit.filter.deny")}</option>
          <option value="policy">{t("security.audit.filter.policy")}</option>
          <option value="resolve">{t("security.audit.filter.resolve")}</option>
        </select>
        <button type="button" className="sec-btn" onClick={() => void load()}>
          {t("security.audit.refresh")}
        </button>
        <button type="button" className="sec-btn sec-btn--ink" disabled={shown.length === 0} onClick={exportJson}>
          <Download size={14} /> {t("security.audit.export")}
        </button>
      </div>
      {loading ? (
        <div className="sec-muted">{t("security.loading")}</div>
      ) : shown.length === 0 ? (
        <div className="sec-muted">{t("security.audit.empty")}</div>
      ) : (
        <div className="sec-audit">
          {shown.map((event, index) => (
            <div className="sec-audit__row" key={`${event.ts}-${index}`}>
              <span className="sec-audit__time">{event.ts.replace("T", " ").slice(0, 19)}</span>
              <span className={"sec-badge sec-badge--" + (event.action.includes("deny") ? "high" : event.action.includes("policy") ? "medium" : "low")}>
                {t(ACTION_LABEL[event.action] ?? "security.audit.action.other")}
              </span>
              <span className="sec-audit__tool">{event.tool ?? "—"}</span>
              <span className="sec-audit__target">{event.target ?? event.reason ?? ""}</span>
            </div>
          ))}
        </div>
      )}
      <p className="sec-footnote">{t("security.audit.note")}</p>
    </div>
  );
}
