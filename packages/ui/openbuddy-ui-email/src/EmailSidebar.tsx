import type { EmailAccount } from "@openbuddy/capability-email";

export type EmailFolder = "inbox" | "sent" | "drafts" | "scheduled" | "pending" | "archive" | "trash" | "spam" | "starred" | "important" | "snoozed";
export type EmailView = "all" | "signal" | "noise";

export interface EmailSidebarProps {
  accounts: EmailAccount[];
  accountId: string;
  activeAccount?: EmailAccount;
  folder: EmailFolder;
  view: EmailView;
  onAccountChange: (accountId: string) => void;
  onFolderChange: (folder: EmailFolder) => void;
  onViewChange: (view: EmailView) => void;
}

const FOLDERS: Array<[EmailFolder, string]> = [
  ["inbox", "收件箱"], ["sent", "已发送"], ["drafts", "草稿"], ["scheduled", "计划发送"],
  ["pending", "待发送"], ["snoozed", "稍后处理"], ["starred", "星标"], ["important", "重要"],
  ["archive", "归档"], ["trash", "垃圾箱"], ["spam", "垃圾邮件"],
];

export function EmailSidebar({ accounts, accountId, activeAccount, folder, view, onAccountChange, onFolderChange, onViewChange }: EmailSidebarProps): JSX.Element {
  return (
    <aside className="email-sidebar" aria-label="邮箱导航">
      <div className="email-sidebar__account">
        <label htmlFor="email-sidebar-account">工作邮箱</label>
        <select id="email-sidebar-account" aria-label="邮箱账户" value={accountId} onChange={(event) => onAccountChange(event.target.value)}>
          <option value="all">全部账户（统一收件箱）</option>
          {accounts.map((item) => <option key={item.id} value={item.id}>{item.name ? `${item.name} · ` : ""}{item.address}</option>)}
        </select>
        {activeAccount ? <span className={`email-sidebar__status ${activeAccount.status === "connected" ? "is-ready" : "is-warning"}`}>
          <i aria-hidden="true" />{activeAccount.status === "connected" ? "已连接" : activeAccount.status === "reauthorization-required" ? "需要重新授权" : "连接异常"}
        </span> : <span className="email-sidebar__status is-muted"><i aria-hidden="true" />统一收件箱</span>}
      </div>
      <div className="email-sidebar__section" aria-label="智能视图">
        <span className="email-sidebar__label">智能视图</span>
        {([["all", "全部"], ["signal", "Signal"], ["noise", "Noise"]] as const).map(([value, label]) => <button type="button" key={value} className={view === value ? "is-active" : ""} aria-pressed={view === value} onClick={() => onViewChange(value)}>{label}</button>)}
      </div>
      <div className="email-sidebar__section" aria-label="文件夹">
        <span className="email-sidebar__label">文件夹</span>
        {FOLDERS.map(([value, label]) => <button type="button" key={value} className={folder === value ? "is-active" : ""} aria-current={folder === value ? "page" : undefined} onClick={() => onFolderChange(value)}>{label}</button>)}
      </div>
    </aside>
  );
}
