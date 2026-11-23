/**
 * 对话内的后台任务胶囊 —— 对齐 WorkBuddy `backgroundTask.capsuleLabel`。
 *
 * `tasks_list` 由宿主返回当前所有运行中的回合（自动化、子代理、命令、普通任务）。
 * 当前会话自己的回合不算"后台"，所以按 sessionId 过滤；任务从列表消失时记一次
 * "已完成"，短暂展示后自动清理。没有后台任务时完全不渲染，不占 Composer 空间。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { taskKill, tasksList } from "@openbuddy/client/agent-client";
import type { RunningTask } from "@openbuddy/protocol/dto";

const KIND_LABEL: Record<string, string> = {
  automation: "自动化",
  subagent: "子代理",
  bash: "命令",
  task: "任务",
};
const COMPLETED_TTL_MS = 30_000;

export function BackgroundTaskCapsule({
  currentSessionId,
  onOpenSession,
  onToast,
}: {
  currentSessionId?: string;
  onOpenSession?: (sessionId: string) => void;
  onToast?: (message: string) => void;
}) {
  const [tasks, setTasks] = useState<RunningTask[]>([]);
  const [completed, setCompleted] = useState<Array<{ id: string; title: string; at: number }>>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const known = useRef(new Map<string, RunningTask>());

  const reload = useCallback(async () => {
    try {
      const list = await tasksList();
      const next = (Array.isArray(list) ? list : []).filter((task) => task.sessionId !== currentSessionId);
      const now = Date.now();
      setTasks(next);
      setCompleted((prev) => {
        const alive = new Set(next.map((task) => task.id));
        const finished = [...known.current.values()]
          .filter((task) => !alive.has(task.id) && task.sessionId !== currentSessionId)
          .map((task) => ({ id: task.id, title: task.description ?? task.title ?? task.id, at: now }));
        known.current = new Map(next.map((task) => [task.id, task]));
        return [...finished, ...prev].filter((item) => now - item.at < COMPLETED_TTL_MS).slice(0, 5);
      });
    } catch {
      setTasks([]);
    }
  }, [currentSessionId]);

  useEffect(() => {
    known.current = new Map();
    void reload();
    const timer = setInterval(() => void reload(), 5000);
    return () => clearInterval(timer);
  }, [reload]);

  const kill = async (task: RunningTask) => {
    setBusyId(task.id);
    try {
      await taskKill(task.id);
      onToast?.(`已停止「${task.description ?? task.title ?? task.id}」`);
      await reload();
    } catch (error) {
      onToast?.(`停止失败：${String(error).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusyId(null);
    }
  };

  if (!tasks.length && !completed.length) return null;

  return (
    <section className="background-tasks" aria-label="后台任务">
      <div className="background-tasks__head">
        {tasks.length > 0 && <span className="background-tasks__count">{tasks.length} 个后台任务运行中</span>}
        {completed.length > 0 && <span className="background-tasks__done">{completed.length} 个已完成</span>}
      </div>
      <ul className="background-tasks__list">
        {tasks.map((task) => (
          <li key={task.id} className="background-tasks__item">
            <span className="background-tasks__kind">{KIND_LABEL[task.kind ?? "task"] ?? "任务"}</span>
            <button
              type="button"
              className="background-tasks__title"
              disabled={!onOpenSession || !task.sessionId}
              onClick={() => task.sessionId && onOpenSession?.(task.sessionId)}
              title={task.description ?? task.title ?? task.id}
            >
              {task.description ?? task.title ?? task.id}
            </button>
            <button
              type="button"
              className="background-tasks__stop"
              disabled={busyId === task.id}
              onClick={() => void kill(task)}
              aria-label={`停止 ${task.title ?? task.id}`}
            >
              {busyId === task.id ? "停止中" : "停止"}
            </button>
          </li>
        ))}
        {completed.map((task) => (
          <li key={task.id} className="background-tasks__item background-tasks__item--done">
            <span className="background-tasks__kind">已完成</span>
            <span className="background-tasks__title" title={task.title}>{task.title}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
