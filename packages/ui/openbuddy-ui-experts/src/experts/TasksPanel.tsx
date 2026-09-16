import { useMemo, useState } from "react";
import { useSessionsStore } from "@/stores/sessions-store";
import type { SessionSummary } from "@openbuddy/shared-types";
import { relativeTime } from "@/lib/files/file-utils";
import { TaskListIcon } from "@openbuddy/ui-primitives/icons";
import styles from "./TasksPanel.module.css";

/** 任务面板 — WorkBuddy v5.4.7 「专家·技能·连接器」页左侧栏的 1:1 复刻。
 *
 *  数据来源:`useSessionsStore.independent` —— Sidebar 的「任务 (N)」分组
 *  就是这条数据;这次直接复用,避免在两个地方维护「最近任务」造成漂移。
 *
 *  渲染策略:
 *   - 标题「任务 (N)」右侧带一个紧凑数字徽章
 *   - 默认折叠到 8 条;「查看更多 (剩余 N)」一键展开全部
 *   - 每行:任务标题 + 「X天前」相对时间
 *   - 点击任务调用 `onSelectSession` —— 与 Sidebar 走相同的 `handleSelectSession`
 *     通道(占位时也会向上抛一个 `onToast` 提示,以免看似响应了点击)。
 *   - 空态:不是报错,而是引导用户从 HomePage 发起第一次会话。
 *
 *  为什么做成独立组件:左侧栏会跟着专家·技能·连接器页一起 render,但它属于
 *  「任务」域(数据来自 sessions store),不属于「专家」域 —— 这样下次新增
 *  「资料库 / 灵感」也需要任务栏时,只要把这个组件往那一搬,无需重新接线。 */
export interface TasksPanelProps {
  /** 点击任务时调用 —— 通常是 shell 的 `handleSelectSession`。 */
  onSelectSession?: (sessionId: string, cwd?: string) => void;
  /** 任务列表为空时的降级提示。 */
  onToast?: (message: string) => void;
  /** 折叠态下展示的条目数(默认 8)。 */
  collapsedLimit?: number;
  /** 测试 / 外部覆盖 —— 不传就走 `useSessionsStore.independent`。 */
  sessions?: SessionSummary[];
  /** 测试 / 外部覆盖标题(默认「任务」)。 */
  title?: string;
}

const DEFAULT_COLLAPSED_LIMIT = 8;

export function TasksPanel({
  onSelectSession,
  onToast,
  collapsedLimit = DEFAULT_COLLAPSED_LIMIT,
  sessions: sessionsOverride,
  title = "Tasks",
}: TasksPanelProps) {
  const independent = useSessionsStore((s) => s.independent);
  const sessions = sessionsOverride ?? independent;
  const [expanded, setExpanded] = useState(false);

  const visible = useMemo(() => {
    const list = sessions
      .filter((s) => !s.archived)
      .slice() // copy so we don't mutate the store array
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return list;
  }, [sessions]);

  const collapsed = !expanded && visible.length > collapsedLimit;
  const shown = collapsed ? visible.slice(0, collapsedLimit) : visible;
  const hidden = visible.length - shown.length;

  const handleClick = (s: SessionSummary) => {
    if (onSelectSession) {
      onSelectSession(s.sessionId, s.cwd);
    } else {
      onToast?.(`正在打开会话「${s.title || "未命名任务"}」`);
    }
  };

  if (visible.length === 0) {
    return (
      <aside className={styles.panel} data-testid="tasks-panel" aria-label="任务侧栏">
        <header className={styles.head}>
          <h3 className={styles.title}>
            <TaskListIcon size="sm" className={styles.titleIcon} />
            <span>{title}</span>
          </h3>
          <span className={styles.count} data-testid="tasks-count">0</span>
        </header>
        <div className={styles.empty} data-testid="tasks-empty">
          <p className={styles.emptyHint}>还没有任务</p>
          <p className={styles.emptySub}>从首页发起一次对话,任务会出现在这里。</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className={styles.panel} data-testid="tasks-panel" aria-label="任务侧栏">
      <header className={styles.head}>
        <h3 className={styles.title}>
          <TaskListIcon size="sm" className={styles.titleIcon} />
          <span>{title}</span>
        </h3>
        <span className={styles.count} data-testid="tasks-count">{visible.length}</span>
      </header>

      <ul className={styles.list} role="list" data-testid="tasks-list">
        {shown.map((s) => {
          const ts = s.updatedAt ? Date.parse(s.updatedAt) : 0;
          const time = ts > 0 ? relativeTime(ts) : "—";
          return (
            <li key={s.sessionId}>
              <button
                type="button"
                className={styles.item}
                onClick={() => handleClick(s)}
                data-testid={`tasks-item-${s.sessionId}`}
                title={s.title || "未命名任务"}
              >
                <span className={styles.itemTitle}>{s.title || "未命名任务"}</span>
                <span className={styles.itemTime}>{time}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {hidden > 0 && (
        <button
          type="button"
          className={styles.more}
          onClick={() => setExpanded(true)}
          data-testid="tasks-show-more"
        >
          查看更多 ({hidden})
        </button>
      )}

      {expanded && visible.length > collapsedLimit && (
        <button
          type="button"
          className={styles.more}
          onClick={() => setExpanded(false)}
          data-testid="tasks-show-less"
        >
          收起
        </button>
      )}
    </aside>
  );
}
