import { useCallback, useEffect, useState } from "react";
import {
  TaskListIcon,
  DeleteIcon,
  RefreshCwIcon,
} from "@openbuddy/ui/icon/icons/index";
import { taskKill, tasksList } from "@openbuddy/client/agent-client";
import type { RunningTask } from "@openbuddy/protocol/dto";
import { tailOutput } from "@openbuddy/chat-core/terminal-rows";
import { useTerminalStore } from "@/app/state/terminal-store";

/**
 * 运行中 (pii W4.5): every running turn, including automation background sessions and
 * sub-agents. Rows show kind, elapsed time and waiting approvals; the stop button cancels the
 * turn (a `!command` row stops via bash abort in the host). The panel hides itself when idle.
 */
const KIND_LABEL: Record<string, string> = {
  automation: "自动化",
  subagent: "子代理",
  bash: "命令",
  task: "任务",
};

export function formatElapsed(startedAt?: number, now = Date.now()): string {
  if (!startedAt) return "";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

interface TasksPanelProps {
  onToast?: (msg: string) => void;
}

export function TasksPanel({ onToast }: TasksPanelProps) {
  const [tasks, setTasks] = useState<RunningTask[]>([]);
  /** Which task shows its terminal output inline (WorkBuddy terminal module parity). */
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  // Background sessions stream into the app-level cache too, so their command
  // output is readable without opening the task.
  const terminalBySession = useTerminalStore((s) => s.bySession);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    try {
      const list = await tasksList();
      setTasks(Array.isArray(list) ? list : []);
    } catch {
      setTasks([]);
    }
  }, []);

  useEffect(() => {
    void reload();
    // The host has no push channel for this list; 4s keeps 用时 and new turns current.
    const timer = setInterval(() => {
      void reload();
      setNow(Date.now());
    }, 4000);
    return () => clearInterval(timer);
  }, [reload]);

  const handleKill = useCallback(
    async (task: RunningTask) => {
      try {
        await taskKill(task.id);
        onToast?.(`已停止「${task.description ?? task.title ?? "任务"}」`);
        await reload();
      } catch (e) {
        onToast?.(`停止失败：${String(e).replace(/^Error:\s*/, "")}`);
      }
    },
    [onToast, reload],
  );

  if (tasks.length === 0) return null;

  return (
    <section className="tasks-panel" aria-label="运行中任务">
      <div className="tasks-panel__header">
        <h3 className="tasks-panel__title">
          <TaskListIcon size="sm" /> 运行中 ({tasks.length})
        </h3>
        <button className="tasks-panel__refresh" onClick={() => void reload()} title="刷新" aria-label="刷新运行中任务">
          <RefreshCwIcon size="sm" />
        </button>
      </div>
      <ul className="tasks-panel__list">
        {tasks.map((task) => {
          const label = KIND_LABEL[task.kind ?? "task"] ?? "任务";
          const terminalRows = task.sessionId ? terminalBySession[task.sessionId] ?? [] : [];
          const expanded = expandedTaskId === task.id && terminalRows.length > 0;
          return (
            <li key={task.id} className="tasks-panel__item" data-kind={task.kind ?? "task"}>
              <div className="tasks-panel__item-body">
                <div className="tasks-panel__item-desc" title={task.description ?? task.title}>
                  {task.description ?? task.title ?? task.id}
                </div>
                <div className="tasks-panel__item-meta">
                  <span className={`tasks-panel__kind tasks-panel__kind--${task.kind ?? "task"}`}>{label}</span>
                  {task.startedAt ? <span>· {formatElapsed(task.startedAt, now)}</span> : null}
                  {task.pending ? (
                    <span className="tasks-panel__pending">· 待确认 {task.pending}</span>
                  ) : null}
                  {terminalRows.length > 0 && (
                    <button
                      type="button"
                      className="tasks-panel__output-toggle"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? "收起" : "展开"}命令输出`}
                      onClick={() => setExpandedTaskId(expanded ? null : task.id)}
                    >
                      {expanded ? "收起输出" : `命令输出 ${terminalRows.length}`}
                    </button>
                  )}
                </div>
                {expanded && (
                  <div className="tasks-panel__terminals">
                    {terminalRows.map((row) => (
                      <details key={row.id} className="tasks-panel__terminal">
                        <summary className="tasks-panel__terminal-summary">
                          <span className="tasks-panel__terminal-command" title={row.command}>{row.command}</span>
                          <span className="tasks-panel__terminal-status">{row.status === "completed" ? "完成" : row.status === "failed" ? "失败" : "执行中"}</span>
                        </summary>
                        <pre className="tasks-panel__terminal-output">{tailOutput(row.output)}</pre>
                      </details>
                    ))}
                  </div>
                )}
              </div>
              <button
                className="tasks-panel__kill"
                onClick={() => void handleKill(task)}
                title="停止"
                aria-label={`停止 ${task.description ?? task.title ?? "任务"}`}
              >
                <DeleteIcon size="sm" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
