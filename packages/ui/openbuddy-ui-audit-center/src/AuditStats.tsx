/**
 * AuditStats — 顶部统计条 (P1.4)
 *
 * 展示:
 *   - 总条数
 *   - 按 source 分布(renderer / main / ipc / plugin / casdoor)
 *   - 按 outcome 分布(allow / deny / success / failure / info)
 *
 * 纯展示组件:接收 `summary`,由 caller 计算后传入。
 */

import type { AuditSummary } from "./types.js";
import { AUDIT_OUTCOMES, AUDIT_SOURCES, OUTCOME_LABEL, SOURCE_LABEL } from "./types.js";

export interface AuditStatsProps {
  summary: AuditSummary;
}

export function AuditStats(props: AuditStatsProps) {
  const { summary } = props;
  return (
    <section className="audit-stats" data-testid="audit-stats" aria-label="审计日志统计">
      <div className="audit-stats__total" data-testid="audit-stats-total">
        共 <strong>{summary.total}</strong> 条
      </div>
      <div className="audit-stats__groups">
        <div className="audit-stats__group" aria-label="按来源">
          {AUDIT_SOURCES.map((s) => (
            <span
              key={s}
              className={"audit-stats__chip audit-stats__chip--source-" + s}
              data-testid={`audit-stats-source-${s}`}
            >
              {SOURCE_LABEL[s]}: <strong>{summary.bySource[s] ?? 0}</strong>
            </span>
          ))}
        </div>
        <div className="audit-stats__group" aria-label="按结果">
          {AUDIT_OUTCOMES.map((o) => (
            <span
              key={o}
              className={"audit-stats__chip audit-stats__chip--outcome-" + o}
              data-testid={`audit-stats-outcome-${o}`}
            >
              {OUTCOME_LABEL[o]}: <strong>{summary.byOutcome[o] ?? 0}</strong>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
