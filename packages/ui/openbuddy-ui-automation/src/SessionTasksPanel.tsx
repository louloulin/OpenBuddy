/**
 * 会话任务面板 — 当前会话的待办列表(pending / in_progress / completed 三态)。
 *
 * 数据面是 `tasks:*` IPC → `TaskCatalog`(`session_tasks` 表),与 `/tasks`
 * 斜杠命令、邮件「采纳行动项」写的是同一份存储。2026-10-11 之前这组通道是
 * `async () => null` 空桩,所以这个面板在那之前根本不可能存在 —— 它是阶段 1.3
 * 「任务三态」的直接产物,也是"后端接真之后 UI 才有资格长出来"的顺序示例。
 *
 * 状态切换是**写后端再刷新**,不做本地乐观更新 —— 本仓库的教训是"本地翻转 +
 * 成功 toast"正是假成功这类缺陷的形态(pi 下一次事件就会把界面打回原样)。
 */
import { useCallback, useEffect, useState } from "react";
import {
  CheckIcon,
  ClockIcon,
  DeleteIcon,
  LoaderIcon,
  TaskListIcon,
} from "@openbuddy/ui-primitives/icons";
import type { SessionTask } from "@openbuddy/shared-types";
import {
  tasksAddForSession,
  tasksClearCompleted,
  tasksDeleteForSession,
  tasksListForSession,
  tasksUpdateForSession,
} from "@/lib/agent/pi-client";
import { useLocale } from "@openbuddy/ui-locale/client";

const STATUS_ORDER = ["pending", "in_progress", "completed"] as const;
type TaskStatus = (typeof STATUS_ORDER)[number];

const STATUS_KEY: Record<TaskStatus, string> = {
  pending: "tasks.status.pending",
  in_progress: "tasks.status.in_progress",
  completed: "tasks.status.completed",
};

const STATUS_ICON: Record<TaskStatus, React.ReactNode> = {
  pending: <ClockIcon size="sm" />,
  in_progress: <LoaderIcon size="sm" />,
  completed: <CheckIcon size="sm" />,
};

function nextStatus(status: string): TaskStatus {
  const idx = STATUS_ORDER.indexOf(status as TaskStatus);
  return STATUS_ORDER[(idx + 1) % STATUS_ORDER.length] ?? "pending";
}

export interface SessionTasksPanelProps {
  sessionId?: string;
  onToast?: (msg: string) => void;
}

function useStatusLabel() {
  const locale = useLocale();
  return (status: TaskStatus) => locale.t(STATUS_KEY[status]);
}

export function SessionTasksPanel({ sessionId, onToast }: SessionTasksPanelProps) {
  const locale = useLocale();
  const statusLabel = useStatusLabel();
  const [tasks, setTasks] = useState<SessionTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");

  const reload = useCallback(async () => {
    if (!sessionId) {
      setTasks([]);
      return;
    }
    setLoading(true);
    try {
      setTasks(await tasksListForSession(sessionId));
    } catch (e) {
      onToast?.(locale.t("tasks.loadFailed", { message: String(e).replace(/^Error:\s*/, "") }));
    } finally {
      setLoading(false);
    }
  }, [sessionId, onToast, locale]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleAdd = useCallback(async () => {
    const title = draft.trim();
    if (!sessionId || !title) return;
    try {
      await tasksAddForSession(sessionId, title);
      setDraft("");
      await reload();
    } catch (e) {
      onToast?.(locale.t("tasks.addFailed", { message: String(e).replace(/^Error:\s*/, "") }));
    }
  }, [sessionId, draft, reload, onToast, locale]);

  const handleCycleStatus = useCallback(
    async (task: SessionTask) => {
      if (!sessionId) return;
      try {
        await tasksUpdateForSession(sessionId, task.id, { status: nextStatus(task.status) });
        await reload();
      } catch (e) {
        onToast?.(locale.t("tasks.updateFailed", { message: String(e).replace(/^Error:\s*/, "") }));
      }
    },
    [sessionId, reload, onToast, statusLabel, locale],
  );

  const handleDelete = useCallback(
    async (task: SessionTask) => {
      if (!sessionId) return;
      try {
        await tasksDeleteForSession(sessionId, task.id);
        await reload();
      } catch (e) {
        onToast?.(locale.t("tasks.deleteFailed", { message: String(e).replace(/^Error:\s*/, "") }));
      }
    },
    [sessionId, reload, onToast, locale],
  );

  const handleClearCompleted = useCallback(async () => {
    if (!sessionId) return;
    try {
      await tasksClearCompleted(sessionId);
      await reload();
    } catch (e) {
      onToast?.(locale.t("tasks.clearFailed", { message: String(e).replace(/^Error:\s*/, "") }));
    }
  }, [sessionId, reload, onToast, locale]);

  const completed = tasks.filter((task) => task.status === "completed").length;
  const hasCompleted = completed > 0;

  if (!sessionId) {
    return (
      <div className="session-tasks session-tasks--empty">
        <TaskListIcon size="xl" color="var(--wb-text-tertiary)" />
        <p>{locale.t("tasks.noSession")}</p>
        <p className="session-tasks__hint">{locale.t("tasks.noSessionHint")}</p>
      </div>
    );
  }

  return (
    <div className="session-tasks">
      <div className="session-tasks__header">
        <h3 className="session-tasks__title">
          <TaskListIcon size="sm" /> {locale.t("tasks.title")}
        </h3>
        <div className="session-tasks__header-actions">
          <span className="session-tasks__progress-text">
            {completed}/{tasks.length}
          </span>
          {hasCompleted && (
            <button
              type="button"
              className="session-tasks__clear"
              onClick={handleClearCompleted}
              title={locale.t("tasks.clearCompleted")}
            >
              {locale.t("tasks.clearCompleted")}
            </button>
          )}
        </div>
      </div>

      {loading && tasks.length === 0 ? (
        <div className="session-tasks__hint">{locale.t("tasks.loading")}</div>
      ) : tasks.length === 0 ? (
        <p className="session-tasks__hint">{locale.t("tasks.empty")}</p>
      ) : (
        <ul className="session-tasks__list">
          {tasks.map((task) => {
            const status = (STATUS_ORDER as readonly string[]).includes(task.status)
              ? (task.status as TaskStatus)
              : "pending";
            return (
              <li
                key={task.id}
                className={`session-tasks__row session-tasks__row--${status}`}
              >
                <button
                  type="button"
                  className={`session-tasks__status session-tasks__status--${status}`}
                  onClick={() => handleCycleStatus(task)}
                  title={locale.t("tasks.statusToggle", { content: task.content, status: statusLabel(status) })}
                  aria-label={locale.t("tasks.statusToggle", { content: task.content, status: statusLabel(status) })}
                >
                  {STATUS_ICON[status]}
                  <span>{statusLabel(status)}</span>
                </button>
                <span className="session-tasks__content" title={task.content}>
                  {task.content}
                </span>
                <button
                  type="button"
                  className="session-tasks__delete"
                  onClick={() => handleDelete(task)}
                  title={locale.t("tasks.delete")}
                  aria-label={locale.t("tasks.delete", { content: task.content })}
                >
                  <DeleteIcon size="sm" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="session-tasks__add">
        <input
          className="session-tasks__add-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAdd();
          }}
          placeholder={locale.t("tasks.addPlaceholder")}
          aria-label={locale.t("tasks.addPlaceholder")}
        />
        <button
          type="button"
          className="session-tasks__add-btn"
          onClick={() => void handleAdd()}
          disabled={!draft.trim()}
          title={locale.t("tasks.add")}
        >
          {locale.t("tasks.add")}
        </button>
      </div>
    </div>
  );
}
