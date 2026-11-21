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
import { useLocale } from "@/shared/i18n";
import { SectionShell } from "./shared";

// ---------- 智能体邮箱（会话通知中心）----------

const KIND_FILTERS: { key: string; labelKey: string }[] = [
  { key: "all", labelKey: "mail.filter.all" },
  { key: "permission", labelKey: "mail.filter.permission" },
  { key: "folder_trust", labelKey: "mail.filter.folder_trust" },
  { key: "task_update", labelKey: "mail.filter.task_update" },
  { key: "plan_mode", labelKey: "mail.filter.plan_mode" },
  { key: "mcp_status", labelKey: "mail.filter.mcp_status" },
  { key: "models_update", labelKey: "mail.filter.models_update" },
  { key: "summary", labelKey: "mail.filter.summary" },
  { key: "session_complete", labelKey: "mail.filter.session_complete" },
  { key: "error", labelKey: "mail.filter.error" },
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
  const { t, locale } = useLocale();
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
    if (!(await appConfirm({ title: t("mail.confirmClearTitle"), confirmLabel: t("mail.confirmClearLabel"), danger: true }))) return;
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
      title={t("mail.title")}
      desc={t("mail.desc")}
    >
      <div className="settings-actions">
        <button className="settings-btn" onClick={reload} disabled={loading}>
          <RefreshCw size={14} /> {loading ? t("mail.loading") : t("mail.refresh")}
        </button>
        <button
          className="settings-btn"
          onClick={handleMarkAllRead}
          disabled={entries.length === 0}
        >
          <CheckCheck size={14} /> {t("mail.markAllRead")}
        </button>
        <button
          className="settings-btn settings-btn--danger"
          onClick={handleClear}
          disabled={entries.length === 0}
        >
          <Trash2 size={14} /> {t("mail.clear")}
        </button>
      </div>

      <div className="settings-row">
        <div className="settings-row__label">
          <Bell size={16} />
          <span>{t("mail.systemNotify")}</span>
          <span className="settings-row__hint">{t("mail.systemNotifyHint")}</span>
        </div>
        <div className="settings-row__control">
          <label className="ob-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label={t("mail.systemNotify")}
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
          <span>{t("mail.unread")}</span>
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
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      {/* 通知列表 */}
      <div className="notification-list">
        {filtered.length === 0 && !loading && (
          <div className="notification-empty">
            <Mail size={32} color="var(--wb-text-tertiary)" />
            <p>{t("mail.empty")}</p>
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
                  {kindLabel(entry.kind as NotificationKind, t)}
                </span>
                <span className="notification-row__title">{entry.title}</span>
                {!entry.read && <span className="notification-row__unread">{t("mail.unreadBadge")}</span>}
              </div>
              {entry.body && (
                <pre className="notification-row__body-text">{entry.body}</pre>
              )}
              <div className="notification-row__meta">
                <span>{formatTime(entry.at, locale)}</span>
                {entry.sessionId && (
                  <span className="notification-row__session">
                    {t("mail.session", { id: entry.sessionId.slice(0, 8) })}
                  </span>
                )}
              </div>
            </div>
            {!entry.read && (
              <button
                className="notification-row__mark"
                onClick={() => handleMarkRead(entry.id)}
                title={t("mail.markRead")}
              >
                <CheckCheck size={12} />
              </button>
            )}
          </div>
        ))}
        {loading && <div className="notification-empty">{t("mail.loading")}</div>}
      </div>
    </SectionShell>
  );
}

function kindLabel(kind: NotificationKind | string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const map: Record<string, string> = {
    permission: "mail.kind.permission",
    folder_trust: "mail.kind.folder_trust",
    task_update: "mail.kind.task_update",
    plan_mode: "mail.kind.plan_mode",
    mcp_status: "mail.kind.mcp_status",
    models_update: "mail.kind.models_update",
    summary: "mail.kind.summary",
    session_complete: "mail.kind.session_complete",
    error: "mail.kind.error",
    info: "mail.kind.info",
  };
  const key = map[String(kind)];
  return key ? t(key) : String(kind);
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

function formatTime(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(locale, {
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
