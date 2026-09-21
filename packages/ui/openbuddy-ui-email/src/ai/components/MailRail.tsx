/**
 * MailRail — 简化版邮件侧栏。
 *
 * 相对旧版 11 文件夹 + 3 智能视图,合并为 3 段(Superhuman 风格):
 *   - Today (AI 自动)
 *   - Later (AI 自动)
 *   - Done (AI 自动)
 *
 * "More" 组里保留 Inbox / Sent / Drafts / Scheduled / Snoozed / Starred / Important / Archive / Trash,
 * 默认折叠。这把"我每天都要做的"和"偶尔用"分层。
 */
import { useState } from "react";

export type RailView = "today" | "later" | "done";
export type RailFolder = "inbox" | "sent" | "drafts" | "scheduled" | "snoozed" | "starred" | "important" | "archive" | "trash" | "spam";

export interface RailAccount {
  id: string;
  address: string;
  name?: string;
  status: "connected" | "reauthorization-required" | "disconnected";
  unread?: number;
}

export interface RailCounts {
  today: number;
  later: number;
  done: number;
  inbox: number;
  drafts: number;
  scheduled: number;
  snoozed: number;
  starred?: number;
}

export interface MailRailProps {
  accounts: RailAccount[];
  accountId: string;
  view: RailView;
  folder: RailFolder;
  counts: RailCounts;
  onAccountChange: (accountId: string) => void;
  onViewChange: (view: RailView) => void;
  onFolderChange: (folder: RailFolder) => void;
  onOpenSettings?: () => void;
}

const RAIL_VIEWS: Array<{ value: RailView; label: string; icon: string }> = [
  { value: "today", label: "Today · 今天要看的", icon: "⚡" },
  { value: "later", label: "Later · 本周再处理", icon: "🌙" },
  { value: "done", label: "Done · 已处理", icon: "✅" },
];

const PRIMARY_FOLDERS: Array<{ value: RailFolder; label: string; icon: string }> = [
  { value: "inbox", label: "Inbox", icon: "📥" },
  { value: "drafts", label: "Drafts", icon: "📝" },
  { value: "scheduled", label: "Scheduled", icon: "📅" },
  { value: "snoozed", label: "Snoozed", icon: "💤" },
];

const MORE_FOLDERS: Array<{ value: RailFolder; label: string; icon: string }> = [
  { value: "sent", label: "Sent", icon: "📤" },
  { value: "starred", label: "Starred", icon: "⭐" },
  { value: "important", label: "Important", icon: "❗" },
  { value: "archive", label: "Archive", icon: "📦" },
  { value: "trash", label: "Trash", icon: "🗑️" },
  { value: "spam", label: "Spam", icon: "🚫" },
];

export function MailRail({
  accounts,
  accountId,
  view,
  folder,
  counts,
  onAccountChange,
  onViewChange,
  onFolderChange,
  onOpenSettings,
}: MailRailProps): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false);
  const activeAccount = accounts.find((a) => a.id === accountId);
  return (
    <aside className="mail-rail" aria-label="邮箱导航">
      <div className="mail-rail__account">
        <select
          aria-label="邮箱账户"
          value={accountId}
          onChange={(event) => onAccountChange(event.target.value)}
        >
          <option value="all">全部账户</option>
          {accounts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name ? `${item.name} · ` : ""}
              {item.address}
            </option>
          ))}
        </select>
        <span
          className={`mail-rail__account-status mail-rail__account-status--${activeAccount?.status ?? "muted"}`}
        >
          {accountStatusLabel(activeAccount?.status)}
        </span>
      </div>

      <div className="mail-rail__section">
        <h4>AI 视图</h4>
        {RAIL_VIEWS.map(({ value, label, icon }) => (
          <button
            type="button"
            key={value}
            className={`mail-rail__item ${view === value ? "is-active" : ""}`}
            aria-pressed={view === value}
            onClick={() => onViewChange(value)}
          >
            <span className="mail-rail__item-icon">{icon}</span>
            <span className="mail-rail__item-label">{label}</span>
            <span className="mail-rail__item-count">{counts[value]}</span>
          </button>
        ))}
      </div>

      <div className="mail-rail__section">
        <h4>文件夹</h4>
        {PRIMARY_FOLDERS.map(({ value, label, icon }) => (
          <button
            type="button"
            key={value}
            className={`mail-rail__item ${folder === value && view === null ? "is-active" : ""}`}
            aria-current={folder === value ? "page" : undefined}
            onClick={() => {
              onViewChange("today");
              onFolderChange(value);
            }}
          >
            <span className="mail-rail__item-icon">{icon}</span>
            <span className="mail-rail__item-label">{label}</span>
            {countFor(value, counts) > 0 ? (
              <span className="mail-rail__item-count">{countFor(value, counts)}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="mail-rail__section">
        <button
          type="button"
          className="mail-rail__more-toggle"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
        >
          {moreOpen ? "▾" : "▸"} More
        </button>
        {moreOpen ? (
          <div className="mail-rail__more">
            {MORE_FOLDERS.map(({ value, label, icon }) => (
              <button
                type="button"
                key={value}
                className={`mail-rail__item ${folder === value ? "is-active" : ""}`}
                onClick={() => {
                  onViewChange("today");
                  onFolderChange(value);
                }}
              >
                <span className="mail-rail__item-icon">{icon}</span>
                <span className="mail-rail__item-label">{label}</span>
              </button>
            ))}
            {onOpenSettings ? (
              <button type="button" className="mail-rail__item" onClick={onOpenSettings}>
                <span className="mail-rail__item-icon">⚙</span>
                <span className="mail-rail__item-label">Provider / Rules</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function accountStatusLabel(status: RailAccount["status"] | undefined): string {
  switch (status) {
    case "connected":
      return "已连接";
    case "reauthorization-required":
      return "需要重新授权";
    case "disconnected":
      return "未连接";
    default:
      return "统一收件箱";
  }
}

function countFor(folder: RailFolder, counts: RailCounts): number {
  switch (folder) {
    case "inbox":
      return counts.inbox;
    case "drafts":
      return counts.drafts;
    case "scheduled":
      return counts.scheduled;
    case "snoozed":
      return counts.snoozed;
    case "starred":
      return counts.starred ?? 0;
    default:
      return 0;
  }
}
