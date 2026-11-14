import { appConfirm } from "../../../shared/ui/AppDialog";
import { useCallback, useEffect, useState } from "react";
import { Trash2, RefreshCw, Mail, Bell, CheckCheck, Filter } from "lucide-react";
import {
  notificationClear,
  notificationList,
  notificationPrefsGet,
  notificationPrefsSet,
  notificationMarkAllRead,
  notificationMarkRead,
} from "@openbuddy/client/agent-client";
import type { NotificationEntry, NotificationKind } from "@openbuddy/protocol/dto";
import { SectionShell } from "./shared";

// ---------- 智能体邮箱（会话通知中心）----------

const KIND_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "permission", label: "权限请求" },
  { key: "folder_trust", label: "文件夹信任" },
  { key: "task_update", label: "任务更新" },
  { key: "plan_mode", label: "计划模式" },
  { key: "mcp_status", label: "MCP 状态" },
  { key: "models_update", label: "模型更新" },
  { key: "summary", label: "会话标题" },
  { key: "session_complete", label: "会话完成" },
  { key: "error", label: "错误" },
];

/** AgentMailSettingsPanel — 智能体邮箱（重新定义为会话通知中心）。
 *
 *  WorkBuddy 的 agentMail 是腾讯邮箱集成（无 agent 对应）。OpenBuddy 把它
 *  重新定义为 agent 事件的通知收件箱：权限请求、文件夹信任、任务更新、
 *  plan 模式切换、MCP 状态、模型更新、会话完成等所有事件都会记到这里。
 *  用户可浏览/筛选/标记已读/清空。
 *
 *  数据存在 应用数据目录/pi/openbuddy-notifications.json（最多 200 条 FIFO）。
 *  写入由 App.tsx 的事件订阅回调触发（notificationAppend）。 */
export function AgentMailSettingsPanel() {
  const [entries, setEntries] = useState<NotificationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await notificationList());
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleMarkRead = useCallback(
    async (id: number) => {
      await notificationMarkRead(id);
      reload();
    },
    [reload],
  );

  const handleMarkAllRead = useCallback(async () => {
    await notificationMarkAllRead();
    reload();
  }, [reload]);

  const handleClear = useCallback(async () => {
    if (!(await appConfirm({ title: "确定清空所有通知？", confirmLabel: "清空", danger: true }))) return;
    await notificationClear();
    reload();
  }, [reload]);

  const filtered = entries.filter(
    (e) => filter === "all" || String(e.kind) === filter,
  );
  const unreadCount = entries.filter((e) => !e.read).length;
  const [systemNotify, setSystemNotify] = useState<boolean | undefined>(undefined);
  useEffect(() => { notificationPrefsGet().then((p) => setSystemNotify(p.system), () => setSystemNotify(true)); }, []);

  return (
    <SectionShell
      title="智能体邮箱（通知中心）"
      desc="OpenBuddy 收到的所有 agent 事件通知：权限请求、文件夹信任、任务更新、计划模式、MCP 状态、会话完成等。数据存在 应用数据目录/pi/openbuddy-notifications.json。"
    >
      <div className="settings-actions">
        <button className="settings-btn" onClick={reload} disabled={loading}>
          <RefreshCw size={14} /> {loading ? "加载中…" : "刷新"}
        </button>
        <button
          className="settings-btn"
          onClick={handleMarkAllRead}
          disabled={entries.length === 0}
        >
          <CheckCheck size={14} /> 全部已读
        </button>
        <button
          className="settings-btn settings-btn--danger"
          onClick={handleClear}
          disabled={entries.length === 0}
        >
          <Trash2 size={14} /> 清空
        </button>
      </div>

      <div className="settings-row">
        <div className="settings-row__label">
          <Bell size={16} />
          <span>系统通知</span>
          <span className="settings-row__hint">窗口不在前台时，任务完成、失败或需要你确认时弹出系统通知，点击直接打开对应任务</span>
        </div>
        <div className="settings-row__control">
          <label className="ob-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="系统通知"
              checked={systemNotify ?? true}
              disabled={systemNotify === undefined}
              onChange={(e) => {
                const next = e.target.checked;
                setSystemNotify(next);
                void notificationPrefsSet(next).catch(() => setSystemNotify(!next));
              }}
            />
            <span className="ob-switch__track" aria-hidden="true"><span className="ob-switch__thumb" /></span>
          </label>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row__label">
          <Mail size={16} />
          <span>未读通知</span>
        </div>
        <div className="settings-row__control">
          <code>{unreadCount}</code> / {entries.length}
        </div>
      </div>

      {/* 分类筛选 */}
      <div className="notification-filters">
        <Filter size={12} />
        {KIND_FILTERS.map((f) => (
          <button
            key={f.key}
            className={`notification-filter ${
              filter === f.key ? "notification-filter--active" : ""
            }`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 通知列表 */}
      <div className="notification-list">
        {filtered.length === 0 && !loading && (
          <div className="notification-empty">
            <Mail size={32} color="var(--wb-text-tertiary)" />
            <p>暂无通知。当 agent 产生事件时（权限请求、任务完成等）会记录到这里。</p>
          </div>
        )}
        {filtered.map((entry) => (
          <div
            key={entry.id}
            className={`notification-row notification-row--${entry.severity} ${
              entry.read ? "notification-row--read" : ""
            }`}
          >
            <div
              className={`notification-row__dot notification-row__dot--${severityToDot(entry.severity)}`}
            />
            <div className="notification-row__body">
              <div className="notification-row__head">
                <span className="notification-row__kind">
                  {kindLabel(entry.kind as NotificationKind)}
                </span>
                <span className="notification-row__title">{entry.title}</span>
                {!entry.read && <span className="notification-row__unread">未读</span>}
              </div>
              {entry.body && (
                <pre className="notification-row__body-text">{entry.body}</pre>
              )}
              <div className="notification-row__meta">
                <span>{formatTime(entry.at)}</span>
                {entry.sessionId && (
                  <span className="notification-row__session">
                    会话 #{entry.sessionId.slice(0, 8)}
                  </span>
                )}
              </div>
            </div>
            {!entry.read && (
              <button
                className="notification-row__mark"
                onClick={() => handleMarkRead(entry.id)}
                title="标记已读"
              >
                <CheckCheck size={12} />
              </button>
            )}
          </div>
        ))}
        {loading && <div className="notification-empty">加载中…</div>}
      </div>
    </SectionShell>
  );
}

function kindLabel(kind: NotificationKind | string): string {
  const map: Record<string, string> = {
    permission: "权限请求",
    folder_trust: "文件夹信任",
    task_update: "任务更新",
    plan_mode: "计划模式",
    mcp_status: "MCP 状态",
    models_update: "模型更新",
    summary: "会话标题",
    session_complete: "会话完成",
    error: "错误",
    info: "信息",
  };
  return map[String(kind)] ?? String(kind);
}

function severityToDot(severity: string): string {
  switch (severity) {
    case "error":
      return "error";
    case "warn":
      return "warn";
    default:
      return "info";
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}
