/**
 * TaskItem.tsx — sidebar task row with 探索/规划/执行 phase tabs.
 *
 * Phase 5 (UI 差距补齐) sub-item E: 对标 WorkBuddy 的三段式任务侧栏。每个任务
 * 显示标题 + 阶段标签（探索/规划/执行）+ 状态。点击阶段标签切换分类。
 *
 * 纯展示组件：输入为 `task`（纯数据），输出为可交互的任务行。颜色复用
 * `--wb-*` 令牌，零新 CSS 概念。
 */
export type TaskPhase = "explore" | "plan" | "execute";
export type TaskStatus = "pending" | "active" | "done" | "blocked";

export interface TaskItemData {
  id: string;
  title: string;
  phase: TaskPhase;
  status?: TaskStatus;
  subagentId?: string;
}

export interface TaskItemProps {
  task: TaskItemData;
  onSelect?: (id: string) => void;
  onSetPhase?: (id: string, phase: TaskPhase) => void;
  className?: string;
}

export const TASK_PHASES: ReadonlyArray<{ id: TaskPhase; label: string }> = [
  { id: "explore", label: "探索" },
  { id: "plan", label: "规划" },
  { id: "execute", label: "执行" },
];

export function taskPhaseLabel(phase: TaskPhase): string {
  return TASK_PHASES.find((p) => p.id === phase)?.label ?? phase;
}

export function TaskItem({ task, onSelect, onSetPhase, className }: TaskItemProps) {
  return (
    <div
      className={"task-item" + (className ? ` ${className}` : "")}
      data-testid={`task-item-${task.id}`}
      data-phase={task.phase}
    >
      <button
        type="button"
        className="task-item__title"
        onClick={() => onSelect?.(task.id)}
        title={task.title}
        data-testid={`task-item-title-${task.id}`}
      >
        <span className={`task-item__status task-item__status--${task.status ?? "pending"}`} aria-hidden="true" />
        <span className="task-item__title-text">{task.title}</span>
      </button>
      <div className="task-item__phases" role="tablist" aria-label="任务阶段">
        {TASK_PHASES.map((phase) => {
          const active = phase.id === task.phase;
          return (
            <button
              key={phase.id}
              type="button"
              role="tab"
              aria-selected={active || undefined}
              className={"task-item__phase" + (active ? " task-item__phase--active" : "")}
              onClick={() => onSetPhase?.(task.id, phase.id)}
              data-testid={`task-item-phase-${task.id}-${phase.id}`}
            >
              {phase.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
