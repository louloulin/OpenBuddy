import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, LoaderIcon, TaskListIcon } from "@openbuddy/ui/icon/icons/index";
import { planProgress, type PlanItem } from "@openbuddy/client/api/plan";
import type { ArtifactInfo } from "@openbuddy/client/api/artifacts";
import { formatDuration } from "@openbuddy/chat-core/tool-summary";
import { turnSummaries, type TurnSummary } from "@openbuddy/chat-core/turns";
import { usePlan } from "@/features/chat/state/plan-store";
import { useSessionStore } from "@/features/chat/state/session-store";
import { collectTerminalRows, tailOutput } from "@openbuddy/chat-core/terminal-rows";
import { openFromTaskOverview } from "@/features/chat/task-overview-bus";
import { selectArtifacts, useArtifactsStore } from "@/features/workbench/state/artifacts-store";
import { KIND_GLYPH, benchKind } from "@/features/workbench/bench-kind";

const MAX_ARTIFACTS = 8;
const TURN_STATUS: Record<TurnSummary["status"], string> = { running: "进行中", done: "完成", failed: "失败", stopped: "已停止" };
const TOOL_STATUS: Record<"in_progress" | "completed" | "failed", string> = { in_progress: "执行中", completed: "完成", failed: "失败" };
const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

/**
 * 任务概览 (20261115-ui U1.5, pii W3.3): a top-bar button "步骤 3/5 · 产物 4" whose popover shows
 * the task's progress (the `ob_todo` plan), its artifacts (`artifacts_list`) and every turn's
 * status and duration. Picking an artifact or a turn opens it in the conversation.
 */
export function TaskOverview({ sessionId }: { sessionId: string }) {
  const items = usePlan(sessionId);
  const artifacts = useArtifactsStore(selectArtifacts(sessionId));
  const hasTurns = useSessionStore((s) => s.sessionId === sessionId && s.messages.some((m) => m.role === "user"));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { done, total } = planProgress(items);
  useEffect(() => setOpen(false), [sessionId]);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!total && !artifacts.length && !hasTurns) return null;
  const parts = [total ? `步骤 ${done}/${total}` : "", artifacts.length ? `产物 ${artifacts.length}` : ""].filter(Boolean);
  const pick = (target: { path?: string; messageId?: string }) => { setOpen(false); openFromTaskOverview(target); };
  return (
    <div className="task-overview" ref={ref}>
      <button
        type="button"
        className={"task-overview__btn" + (open ? " task-overview__btn--active" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-label="任务概览"
        aria-expanded={open}
        data-tip="任务概览"
      >
        {total > 0 && done === total ? <CheckIcon size={14} /> : <TaskListIcon size={14} />}
        <span className="task-overview__label">{parts.length ? parts.join(" · ") : "任务概览"}</span>
      </button>
      {open && <TaskOverviewPopover items={items} artifacts={artifacts} onPick={pick} />}
    </div>
  );
}

function TaskOverviewPopover({ items, artifacts, onPick }: { items: PlanItem[]; artifacts: ArtifactInfo[]; onPick: (target: { path?: string; messageId?: string }) => void }) {
  const messages = useSessionStore((s) => s.messages);
  const streaming = useSessionStore((s) => s.streaming);
  const turns = useMemo(() => turnSummaries(messages, streaming), [messages, streaming]);
  const terminals = useMemo(() => collectTerminalRows(messages), [messages]);
  const { done, total } = planProgress(items);
  const shown = artifacts.slice(0, MAX_ARTIFACTS);
  return (
    <div className="task-overview__popover ob-pop" role="dialog" aria-label="任务概览">
      <section className="task-overview__section" aria-label="任务进度">
        <div className="task-overview__head">
          <span>任务进度</span>
          {total > 0 && <span className="task-overview__meta">{done}/{total}</span>}
        </div>
        {total > 0 ? (
          <>
            <div className="plan-panel__progress-bar"><div className="plan-panel__progress-fill" style={{ width: `${Math.round((done / total) * 100)}%` }} /></div>
            <ol className="task-overview__steps">
              {items.map((item) => (
                <li key={item.id} className={`plan-step plan-step--${item.status}`}>
                  <span className="plan-step__mark" aria-hidden>{item.status === "done" ? <CheckIcon size={12} strokeWidth={2.5} /> : item.status === "in_progress" ? <LoaderIcon size={12} /> : null}</span>
                  <span className="plan-step__body"><span className="plan-step__text">{item.text}</span></span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="task-overview__empty">还没有计划。处理多步任务时，Buddy 会在这里列出步骤和进度。</p>
        )}
      </section>
      <section className="task-overview__section" aria-label="本任务的产物">
        <div className="task-overview__head">
          <span>产物 · {artifacts.length}</span>
          {artifacts.length > 0 && <button type="button" className="task-overview__link" onClick={() => onPick({})}>查看全部</button>}
        </div>
        {artifacts.length ? (
          <ul className="task-overview__list">
            {shown.map((a) => (
              <li key={a.path}>
                <button type="button" className="task-overview__item" onClick={() => onPick({ path: a.path })} disabled={!a.exists} title={a.path}>
                  <span className={`task-overview__glyph bench-item__icon--${benchKind(a.path)}`} aria-hidden>{KIND_GLYPH[benchKind(a.path)]}</span>
                  <span className="task-overview__text">{fileName(a.path)}</span>
                  <span className="task-overview__meta">{!a.exists ? "已删除" : a.status === "created" ? "新建" : `修改 +${a.added} −${a.removed}`}</span>
                </button>
              </li>
            ))}
            {artifacts.length > shown.length && <li className="task-overview__more">还有 {artifacts.length - shown.length} 个</li>}
          </ul>
        ) : (
          <p className="task-overview__empty">还没有产物。Buddy 新建或修改的文件会出现在这里。</p>
        )}
      </section>
      {terminals.length > 0 && (
        <section className="task-overview__section" aria-label="命令输出">
          <div className="task-overview__head"><span>命令输出 · {terminals.length}</span></div>
          <div className="task-overview__terminals">
            {terminals.map((row) => (
              <details key={row.id} className="task-overview__terminal">
                <summary className="task-overview__terminal-summary">
                  <span className="task-overview__glyph" aria-hidden>›_</span>
                  <span className="task-overview__text" title={row.command}>{row.command}</span>
                  <span className="task-overview__meta">{TOOL_STATUS[row.status]}{row.durationMs !== undefined && row.durationMs >= 1000 ? ` · ${formatDuration(row.durationMs)}` : ""}</span>
                </summary>
                <pre className="task-overview__terminal-output">{tailOutput(row.output)}</pre>
              </details>
            ))}
          </div>
        </section>
      )}
      <section className="task-overview__section" aria-label="任务进程">
        <div className="task-overview__head"><span>任务进程 · {turns.length} 轮</span></div>
        <ol className="task-overview__list">
          {turns.map((t) => (
            <li key={t.id}>
              <button type="button" className="task-overview__item" onClick={() => onPick({ messageId: t.id })} title={t.prompt}>
                <span className="task-overview__index">{t.index}</span>
                <span className="task-overview__text">{t.prompt}</span>
                <span className={`task-overview__status task-overview__status--${t.status}`}>{TURN_STATUS[t.status]}{t.durationMs !== undefined && t.durationMs >= 1000 ? ` · ${formatDuration(t.durationMs)}` : ""}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
