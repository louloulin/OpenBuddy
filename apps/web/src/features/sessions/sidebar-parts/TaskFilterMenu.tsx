import type { SessionSummary, SessionStatus } from "@openbuddy/protocol/dto";

// ---------- Task filter (对齐 WorkBuddy TaskFilterMenu) ----------

const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_OPTIONS: { value: SessionStatus | null; label: string }[] = [
  { value: null,        label: "全部状态" },
  { value: "working",   label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "failed",    label: "失败" },
  { value: "pending",   label: "待处理" },
  { value: "planning",  label: "规划中" },
];

const DATE_OPTIONS: { value: string | null; label: string }[] = [
  { value: null,           label: "全部时间" },
  { value: "today",        label: "今天" },
  { value: "last7days",    label: "最近 7 天" },
  { value: "last30days",   label: "最近 30 天" },
];

/** Green checkmark shown on the selected filter option. */
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path fill="#00C29A" transform="translate(2.676 3.976)"
        d="M11.3137 0.9428L4.2426 8.0139L0 3.7712L0.9428 2.8284L4.2426 6.1283L10.3709 0L11.3137 0.9428Z" />
    </svg>
  );
}

/** Date preset → start-of-range timestamp (ms). null = no date filter. */
function getDateStart(date: string | null): number | null {
  if (!date) return null;
  if (date === "today") { const s = new Date(); s.setHours(0, 0, 0, 0); return s.getTime(); }
  if (date === "last7days") return Date.now() - 7 * DAY_MS;
  if (date === "last30days") return Date.now() - 30 * DAY_MS;
  return null;
}

/** "working" family: planning/running sessions also match 进行中. */
function statusMatches(sessionStatus: SessionStatus | undefined, filter: SessionStatus): boolean {
  const s = sessionStatus ?? "completed";
  if (filter === "working") return s === "working" || s === "planning";
  return s === filter;
}

/** Apply status + date filters to a session list. */
export function filterSessions(
  sessions: SessionSummary[],
  status: SessionStatus | null,
  date: string | null,
): SessionSummary[] {
  if (!status && !date) return sessions;
  const dateStart = getDateStart(date);
  return sessions.filter((s) => {
    if (status && !statusMatches(s.status, status)) return false;
    if (dateStart !== null) {
      const t = s.updatedAt ? new Date(s.updatedAt).getTime() : 0;
      if (t < dateStart) return false;
    }
    return true;
  });
}

/** Dropdown menu with status + date filter sections and a reset button. */
export function TaskFilterMenu({
  filterStatus,
  filterDate,
  hasFilter,
  onSelectStatus,
  onSelectDate,
  onClear,
}: {
  filterStatus: SessionStatus | null;
  filterDate: string | null;
  hasFilter: boolean;
  onSelectStatus: (s: SessionStatus | null) => void;
  onSelectDate: (d: string | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="task-filter-menu">
      {/* 筛选状态 */}
      <div className="task-filter-menu__section">
        <div className="task-filter-menu__section-title">筛选状态</div>
        <div className="task-filter-menu__options">
          {STATUS_OPTIONS.map((opt) => {
            const selected = opt.value === null ? filterStatus === null : filterStatus === opt.value;
            return (
              <button
                key={opt.value ?? "__all_status"}
                className={"task-filter-menu__option" + (selected ? " task-filter-menu__option--selected" : "")}
                onClick={() => onSelectStatus(opt.value)}
              >
                <span className="task-filter-menu__option-label">{opt.label}</span>
                {selected && <span className="task-filter-menu__option-check"><CheckIcon /></span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="task-filter-menu__divider" />
      {/* 筛选时间 */}
      <div className="task-filter-menu__section">
        <div className="task-filter-menu__section-title">筛选时间</div>
        <div className="task-filter-menu__options">
          {DATE_OPTIONS.map((opt) => {
            const selected = opt.value === null ? filterDate === null : filterDate === opt.value;
            return (
              <button
                key={opt.value ?? "__all_date"}
                className={"task-filter-menu__option" + (selected ? " task-filter-menu__option--selected" : "")}
                onClick={() => onSelectDate(opt.value)}
              >
                <span className="task-filter-menu__option-label">{opt.label}</span>
                {selected && <span className="task-filter-menu__option-check"><CheckIcon /></span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="task-filter-menu__divider" />
      {/* 重置 */}
      <button
        className={"task-filter-menu__reset" + (!hasFilter ? " task-filter-menu__reset--disabled" : "")}
        onClick={() => { if (hasFilter) onClear(); }}
        disabled={!hasFilter}
      >
        <span className="task-filter-menu__reset-label">重置筛选条件</span>
      </button>
    </div>
  );
}
