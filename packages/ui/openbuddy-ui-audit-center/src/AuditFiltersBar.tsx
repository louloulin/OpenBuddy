/**
 * AuditFiltersBar — 多维过滤条 (P1.4)
 *
 * 暴露:
 *   - source 多选 chips(全部 / 单个 toggle)
 *   - outcome 多选 chips
 *   - event / subject 子串搜索
 *   - 时间范围(from / to,ISO datetime-local)
 *   - 「清空过滤」按钮
 *
 * 纯展示组件:由 caller 持有 filters state,本组件通过 props 回调修改。
 */

import type { AuditFilters, AuditOutcome, AuditSource } from "./types.js";
import {
  AUDIT_OUTCOMES,
  AUDIT_SOURCES,
  OUTCOME_LABEL,
  SOURCE_LABEL,
  isFiltersEmpty,
  toggleOutcome,
  toggleSource,
} from "./types.js";

export interface AuditFiltersBarProps {
  filters: AuditFilters;
  onChange: (next: AuditFilters) => void;
}

export function AuditFiltersBar(props: AuditFiltersBarProps) {
  const { filters, onChange } = props;

  return (
    <section className="audit-filters-bar" data-testid="audit-filters-bar" aria-label="审计日志过滤">
      <div className="audit-filters-bar__row">
        <fieldset className="audit-filters-bar__group" aria-label="来源">
          <legend>来源</legend>
          {AUDIT_SOURCES.map((s: AuditSource) => {
            const active = filters.sources.includes(s);
            return (
              <button
                key={s}
                type="button"
                role="switch"
                aria-checked={active}
                className={"audit-filters-bar__chip" + (active ? " is-active" : "")}
                onClick={() => onChange(toggleSource(filters, s))}
                data-testid={`audit-filter-source-${s}`}
              >
                {SOURCE_LABEL[s]}
              </button>
            );
          })}
        </fieldset>

        <fieldset className="audit-filters-bar__group" aria-label="结果">
          <legend>结果</legend>
          {AUDIT_OUTCOMES.map((o: AuditOutcome) => {
            const active = filters.outcomes.includes(o);
            return (
              <button
                key={o}
                type="button"
                role="switch"
                aria-checked={active}
                className={"audit-filters-bar__chip audit-filters-bar__chip--" + o + (active ? " is-active" : "")}
                onClick={() => onChange(toggleOutcome(filters, o))}
                data-testid={`audit-filter-outcome-${o}`}
              >
                {OUTCOME_LABEL[o]}
              </button>
            );
          })}
        </fieldset>
      </div>

      <div className="audit-filters-bar__row">
        <label className="audit-filters-bar__field">
          <span>事件名</span>
          <input
            type="search"
            placeholder="例如:settings.open"
            value={filters.eventQuery}
            onChange={(e) => onChange({ ...filters, eventQuery: e.target.value })}
            data-testid="audit-filter-event-query"
          />
        </label>
        <label className="audit-filters-bar__field">
          <span>主体</span>
          <input
            type="search"
            placeholder="subject 子串匹配"
            value={filters.subjectQuery}
            onChange={(e) => onChange({ ...filters, subjectQuery: e.target.value })}
            data-testid="audit-filter-subject-query"
          />
        </label>
        <label className="audit-filters-bar__field">
          <span>开始</span>
          <input
            type="datetime-local"
            value={filters.fromIso ?? ""}
            onChange={(e) => onChange({ ...filters, fromIso: e.target.value || undefined })}
            data-testid="audit-filter-from"
          />
        </label>
        <label className="audit-filters-bar__field">
          <span>结束</span>
          <input
            type="datetime-local"
            value={filters.toIso ?? ""}
            onChange={(e) => onChange({ ...filters, toIso: e.target.value || undefined })}
            data-testid="audit-filter-to"
          />
        </label>
        <button
          type="button"
          onClick={() => onChange({
            sources: [],
            outcomes: [],
            eventQuery: "",
            subjectQuery: "",
            fromIso: undefined,
            toIso: undefined,
          })}
          disabled={isFiltersEmpty(filters)}
          data-testid="audit-filter-clear"
        >
          清空过滤
        </button>
      </div>
    </section>
  );
}

// Avoid unused-export warning on internal helper re-exports
void AUDIT_OUTCOMES;
void AUDIT_SOURCES;
