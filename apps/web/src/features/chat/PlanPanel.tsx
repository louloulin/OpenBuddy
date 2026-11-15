import { useCallback, useEffect, useRef, useState } from "react";
import { usePlan } from "@/features/chat/state/plan-store";
import { planProgress, type PlanItem } from "@openbuddy/client/api/plan";
import type { Plan, PlanEntry, PlanEntryPriority, PlanEntryStatus } from "@openbuddy/protocol/dto";
import {
  reorderPlan,
  addPlanEntry,
  cycleEntryStatus,
  itemsToPlan,
  planItemsToText,
  planToText,
} from "@openbuddy/chat-core/plan-utils";
import {
  CheckIcon,
  ClockIcon,
  LoaderIcon,
  TaskListIcon,
  DeleteIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  AddIcon,
} from "@openbuddy/ui/icon/icons/index";
import { ChevronGlyph, EditGlyph } from "../../shared/agent-ui/icons";

const STATUS_LABEL: Record<PlanEntryStatus, string> = {
  pending: "待处理",
  in_progress: "进行中",
  completed: "已完成",
};

const PRIORITY_LABEL: Record<PlanEntryPriority, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

const PRIORITY_CYCLE: PlanEntryPriority[] = ["high", "medium", "low"];

const formatElapsed = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);

interface PlanPanelProps {
  sessionId: string;
  /** 想一想 answered with a plan: show 按此计划执行 / 修改计划…. */
  ready?: boolean;
  /** A turn is running (the current step animates and shows its elapsed time). */
  running?: boolean;
  /** 按此计划执行: switch to 做一做 and ask Buddy to carry the plan out. */
  onExecute?: () => void;
  /** Put text into the composer (修改计划… / 编辑步骤). */
  onModify?: (text: string) => void;
  /** Hide the action bar for this answer (继续完善 / after 修改计划…). */
  onDismiss?: () => void;
}

/**
 * Task plan above the composer (20261116-pii W3.2). The steps come from the engine's
 * `agent://plan` event (the `ob_todo` results on the current branch), so the panel always shows
 * the plan of the branch on screen. Collapsible to one line; collapses itself once every step
 * is done. In 想一想 it carries the plan action bar.
 */
export function PlanPanel({ sessionId, ready, running, onExecute, onModify, onDismiss }: PlanPanelProps) {
  const items = usePlan(sessionId);
  const { done, total, current } = planProgress(items);
  const allDone = total > 0 && done === total;
  // null = follow the plan (open while unfinished); a boolean = the user's choice.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [draft, setDraft] = useState<Plan | null>(null);
  const elapsed = useStepElapsed(sessionId, current, !!running);
  const signature = items.map((i) => i.id).join(",");
  useEffect(() => { setUserOpen(null); setDraft(null); }, [sessionId, signature]);
  useEffect(() => { if (allDone) setUserOpen(null); }, [allDone]);

  const modify = () => {
    onDismiss?.();
    onModify?.(total ? `请按下面的意见调整计划，先不要执行：\n${planItemsToText(items)}\n\n修改意见：` : "我想调整上面的计划：");
  };
  const actionBar = ready ? (
    <div className="plan-bar" role="region" aria-label="计划已就绪">
      <span className="plan-bar__text">{total ? `计划共 ${total} 步，` : "计划已就绪，"}确认后 Buddy 会切换到「做一做」开始执行。</span>
      <button type="button" className="bench-btn" onClick={modify}>修改计划…</button>
      <button type="button" className="bench-btn bench-btn--primary" onClick={() => onExecute?.()}>按此计划执行</button>
    </div>
  ) : null;
  if (!total) return actionBar;
  if (draft) {
    return (
      <PlanEditor
        initial={draft}
        onCancel={() => setDraft(null)}
        onSubmit={(plan) => {
          setDraft(null);
          onDismiss?.();
          onModify?.(`请按下面调整后的计划更新步骤（用 ob_todo 同步），先不要执行：\n${planToText(plan)}\n\n补充说明：`);
        }}
      />
    );
  }
  const open = userOpen ?? !allDone;
  const next = items.find((i) => i.status === "pending");
  const headline = allDone ? "计划已完成" : open ? "任务计划" : current ? `正在：${current.text}` : next ? `下一步：${next.text}` : "任务计划";
  return (
    <section className={"plan-card" + (open ? " plan-card--open" : "") + (allDone ? " plan-card--done" : "")} aria-label="任务计划">
      <div className="plan-card__head">
        <button type="button" className="plan-card__toggle" onClick={() => setUserOpen(!open)} aria-expanded={open} aria-label={`${open ? "收起" : "展开"}任务计划（已完成 ${done}/${total}）`}>
          <span className="plan-card__icon" aria-hidden>{allDone ? <CheckIcon size={14} /> : <TaskListIcon size={14} />}</span>
          <span className="plan-card__title">{headline}</span>
          <span className="plan-card__count">{done}/{total}</span>
          <ChevronGlyph open={open} />
        </button>
        {!running && onModify && (
          <button type="button" className="plan-card__edit" onClick={() => setDraft(itemsToPlan(items))} aria-label="编辑步骤" data-tip="编辑步骤">
            <EditGlyph />
          </button>
        )}
      </div>
      <div className="plan-panel__progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="计划进度">
        <div className="plan-panel__progress-fill" style={{ width: `${Math.round((done / total) * 100)}%` }} />
      </div>
      {open && (
        <ol className="plan-card__list">
          {items.map((item) => <PlanStep key={item.id} item={item} live={!!running} elapsed={item.id === current?.id ? elapsed : undefined} />)}
        </ol>
      )}
      {actionBar}
    </section>
  );
}

/** One step, read-only: status mark · text · note · elapsed. */
function PlanStep({ item, live, elapsed }: { item: PlanItem; live: boolean; elapsed?: number }) {
  const label = item.status === "done" ? "已完成" : item.status === "in_progress" ? "进行中" : "待处理";
  return (
    <li className={`plan-step plan-step--${item.status}`} aria-label={`第 ${item.id} 步 ${label}：${item.text}`}>
      <span className={"plan-step__mark" + (live && item.status === "in_progress" ? " plan-step__mark--live" : "")} aria-hidden>
        {item.status === "done" ? <CheckIcon size={12} strokeWidth={2.5} /> : item.status === "in_progress" ? <LoaderIcon size={12} /> : null}
      </span>
      <span className="plan-step__body">
        <span className="plan-step__text">{item.text}</span>
        {item.note && <span className="plan-step__note">{item.note}</span>}
      </span>
      {item.status === "in_progress" && <span className="plan-step__state">{elapsed !== undefined && elapsed >= 1 ? formatElapsed(elapsed) : "进行中"}</span>}
    </li>
  );
}

/** Seconds the current step has been in progress while a turn runs (measured locally). */
function useStepElapsed(sessionId: string, current: PlanItem | undefined, running: boolean): number | undefined {
  const starts = useRef(new Map<string, number>());
  const [now, setNow] = useState(() => Date.now());
  const key = current ? `${sessionId}:${current.id}` : "";
  if (key && running && !starts.current.has(key)) starts.current.set(key, Date.now());
  useEffect(() => {
    if (!key || !running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [key, running]);
  const start = key ? starts.current.get(key) : undefined;
  return running && start ? Math.max(0, Math.round((now - start) / 1000)) : undefined;
}

interface PlanEditorProps {
  initial: Plan;
  onCancel: () => void;
  /** 放入输入框: the edited plan goes to Buddy as a message, never straight into the engine. */
  onSubmit: (plan: Plan) => void;
  onToast?: (msg: string) => void;
}

/**
 * 编辑步骤 (对齐 WorkBuddy plan-editor): reorder, rewrite, skip, delete and add steps on a local
 * draft of the plan; the result is put into the composer for Buddy to apply with ob_todo.
 */
export function PlanEditor({ initial, onCancel, onSubmit, onToast }: PlanEditorProps) {
  const [plan, setPlan] = useState<Plan>(initial);

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  const handleSkip = useCallback(
    (idx: number) => {
      const entries = plan.entries.map((e, i) =>
        i === idx ? { ...e, status: "completed" as PlanEntryStatus } : e
      );
      setPlan({ ...plan, entries });
      onToast?.(`已跳过 #${idx + 1}`);
    },
    [plan, onToast],
  );

  const handleDeleteEntry = useCallback(
    (idx: number) => {
      const entries = plan.entries.filter((_, i) => i !== idx);
      setPlan({ ...plan, entries });
      onToast?.(`已删除 #${idx + 1}`);
    },
    [plan, onToast],
  );

  // 计划编辑器(对齐 WorkBuddy plan-editor):上移/下移/状态循环/新增步骤。
  const handleMove = useCallback(
    (idx: number, dir: -1 | 1) => {
      setPlan(reorderPlan(plan, idx, idx + dir));
    },
    [plan],
  );
  const handleCycleStatus = useCallback(
    (idx: number) => {
      setPlan(cycleEntryStatus(plan, idx));
    },
    [plan],
  );
  const [newStep, setNewStep] = useState("");
  const handleAddStep = useCallback(() => {
    if (!newStep.trim()) return;
    setPlan(addPlanEntry(plan, newStep));
    setNewStep("");
  }, [plan, newStep]);

  const handleCyclePriority = useCallback(
    (idx: number) => {
      const entries = plan.entries.map((e, i) => {
        if (i !== idx) return e;
        const cur = PRIORITY_CYCLE.indexOf(e.priority);
        const next = PRIORITY_CYCLE[(cur + 1) % PRIORITY_CYCLE.length];
        return { ...e, priority: next };
      });
      setPlan({ ...plan, entries });
    },
    [plan],
  );

  const handleSaveEdit = useCallback(
    (idx: number) => {
      if (!editText.trim()) {
        setEditingIdx(null);
        return;
      }
      const entries = plan.entries.map((e, i) =>
        i === idx ? { ...e, content: editText.trim() } : e
      );
      setPlan({ ...plan, entries });
      setEditingIdx(null);
    },
    [plan, editText],
  );

  return (
    <section className="plan-panel plan-card plan-card--open plan-card--editing" aria-label="编辑计划步骤">
      <div className="plan-panel__header">
        <h3 className="plan-panel__title">
          <TaskListIcon size="sm" /> 编辑步骤
        </h3>
        <span className="plan-panel__progress-text">{plan.entries.length} 步</span>
      </div>

      {/* Task list */}
      <ul className="plan-panel__list">
        {plan.entries.map((entry, idx) => (
          <PlanRow
            key={idx}
            entry={entry}
            index={idx}
            total={plan.entries.length}
            editing={editingIdx === idx}
            editText={editText}
            onEditTextChange={setEditText}
            onStartEdit={() => {
              setEditingIdx(idx);
              setEditText(entry.content);
            }}
            onSaveEdit={() => handleSaveEdit(idx)}
            onCancelEdit={() => setEditingIdx(null)}
            onSkip={() => handleSkip(idx)}
            onDelete={() => handleDeleteEntry(idx)}
            onCyclePriority={() => handleCyclePriority(idx)}
            onMoveUp={() => handleMove(idx, -1)}
            onMoveDown={() => handleMove(idx, 1)}
            onCycleStatus={() => handleCycleStatus(idx)}
          />
        ))}
      </ul>

      {/* 新增步骤(对齐 WorkBuddy plan-editor) */}
      <div className="plan-panel__add">
        <input
          className="plan-panel__add-input"
          value={newStep}
          onChange={(e) => setNewStep(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddStep();
          }}
          placeholder="新增一个步骤…"
          aria-label="新增步骤"
        />
        <button
          className="plan-panel__add-btn"
          onClick={handleAddStep}
          disabled={!newStep.trim()}
          title="新增步骤"
        >
          <AddIcon size="sm" /> 添加
        </button>
      </div>
      <div className="plan-editor__foot">
        <button type="button" className="bench-btn" onClick={onCancel}>取消</button>
        <button type="button" className="bench-btn bench-btn--primary" onClick={() => onSubmit(plan)} disabled={!plan.entries.length}>放入输入框</button>
      </div>
    </section>
  );
}

interface PlanRowProps {
  entry: PlanEntry;
  index: number;
  total: number;
  elapsed?: number;
  editing: boolean;
  editText: string;
  onEditTextChange: (v: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onSkip: () => void;
  onDelete: () => void;
  onCyclePriority: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onCycleStatus: () => void;
}

function PlanRow({
  entry,
  index,
  total,
  elapsed,
  editing,
  editText,
  onEditTextChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onSkip,
  onDelete,
  onCyclePriority,
  onMoveUp,
  onMoveDown,
  onCycleStatus,
}: PlanRowProps) {
  const formatElapsed = (s: number) => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  };

  return (
    <li
      className={`plan-panel__row plan-panel__row--${entry.status} plan-panel__row--prio-${entry.priority}`}
    >
      <div className="plan-panel__row-icon">
        {entry.status === "completed" ? (
          <CheckIcon size="sm" />
        ) : entry.status === "in_progress" ? (
          <LoaderIcon size="sm" />
        ) : (
          <ClockIcon size="sm" />
        )}
      </div>
      <div className="plan-panel__row-body">
        {editing ? (
          <div className="plan-panel__row-edit">
            <input
              className="plan-panel__row-edit-input"
              value={editText}
              onChange={(e) => onEditTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSaveEdit();
                if (e.key === "Escape") onCancelEdit();
              }}
              autoFocus
            />
            <button className="plan-panel__row-edit-save" onClick={onSaveEdit}>
              保存
            </button>
          </div>
        ) : (
          <div
            className="plan-panel__row-content"
            onDoubleClick={onStartEdit}
            title="双击编辑"
          >
            {entry.content}
          </div>
        )}
        <div className="plan-panel__row-meta">
          <button
            className="plan-panel__row-priority plan-panel__row-priority--clickable"
            onClick={onCyclePriority}
            title="点击切换优先级"
          >
            {PRIORITY_LABEL[entry.priority]}
          </button>
          <span
            className="plan-panel__row-status plan-panel__row-status--clickable"
            onClick={onCycleStatus}
            title="点击切换状态"
          >
            {STATUS_LABEL[entry.status]}
          </span>
          {elapsed !== undefined && (
            <span className="plan-panel__row-elapsed">
              ⏱ {formatElapsed(elapsed)}
            </span>
          )}
          <span className="plan-panel__row-index">#{index + 1}</span>
        </div>
      </div>
      {/* Row actions */}
      <div className="plan-panel__row-actions">
        <button
          className="plan-panel__row-action"
          onClick={onMoveUp}
          disabled={index === 0}
          title="上移"
          aria-label="上移"
        >
          <ArrowUpIcon size="sm" />
        </button>
        <button
          className="plan-panel__row-action"
          onClick={onMoveDown}
          disabled={index === total - 1}
          title="下移"
          aria-label="下移"
        >
          <ChevronDownIcon size="sm" />
        </button>
        {entry.status === "pending" && (
          <button
            className="plan-panel__row-action"
            onClick={onSkip}
            title="跳过此任务"
          >
            跳过
          </button>
        )}
        <button
          className="plan-panel__row-action plan-panel__row-action--danger"
          onClick={onDelete}
          title="删除此任务"
        >
          <DeleteIcon size="sm" />
        </button>
      </div>
    </li>
  );
}
