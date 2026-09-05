/**
 * EmailList — 线程列表纯展示层。
 *
 * 通过 callbacks 接收所有 mutation，避免列表行直接依赖 provider/IPC；这让 500+
 * 线程的虚拟化和独立性能测试成为可能，也让错误统一回到 EmailPanel 的 UX 层。
 */
import type { EmailThreadPreview, EmailManagementCapability } from "@openbuddy/capability-email";

export interface EmailListProps {
  threads: EmailThreadPreview[];
  selectedThreadIds: string[];
  focusedIndex: number;
  loading: boolean;
  nextCursor?: string;
  folder: string;
  bulkPreviewKind?: string;
  canManageSelection: (operation: EmailManagementCapability) => boolean;
  canManageOperation: (operation: EmailManagementCapability) => boolean;
  onBulkUpdate: (kind: Extract<EmailManagementCapability, "archive" | "restore" | "mark-read" | "mark-unread" | "star" | "trash" | "spam">) => void;
  onClearSelection: () => void;
  onSelectionChange: (key: string, checked: boolean) => void;
  onOpenThread: (item: EmailThreadPreview) => void;
  onQuickUpdate: (item: EmailThreadPreview, kind: Extract<EmailManagementCapability, "mark-read" | "star" | "archive">) => void;
  onCancelScheduled: (id: string) => void;
  onCancelPending: (id: string) => void;
  onLoadMore: () => void;
}

function senderInitials(address: { name?: string; address: string }): string {
  const source = address.name?.trim() || address.address.split("@")[0] || "?";
  return source.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export function EmailList({
  threads,
  selectedThreadIds,
  focusedIndex,
  loading,
  nextCursor,
  folder,
  bulkPreviewKind,
  canManageSelection,
  canManageOperation,
  onBulkUpdate,
  onClearSelection,
  onSelectionChange,
  onOpenThread,
  onQuickUpdate,
  onCancelScheduled,
  onCancelPending,
  onLoadMore,
}: EmailListProps): JSX.Element {
  const bulkActions: Array<[Extract<EmailManagementCapability, "archive" | "restore" | "mark-read" | "mark-unread" | "star" | "trash" | "spam">, string, string]> = [
    ["archive", "归档", "预览归档"], ["restore", "恢复", "预览恢复"],
    ["mark-read", "已读", "预览标记已读"], ["mark-unread", "未读", "预览标记未读"],
    ["star", "收藏", "预览收藏"], ["trash", "删除", "预览删除"], ["spam", "垃圾邮件", "预览垃圾邮件"],
  ];
  return (
    <section className="email-list" aria-label="邮件线程列表">
      {selectedThreadIds.length > 0 && (
        <div className="email-bulk-toolbar">
          <span>已选 {selectedThreadIds.length}</span>
          {bulkActions.map(([kind, confirmLabel, previewLabel]) => (
            <button key={kind} type="button" disabled={!canManageSelection(kind)} onClick={() => onBulkUpdate(kind)}>
              {bulkPreviewKind === kind ? `确认${confirmLabel}` : previewLabel}
            </button>
          ))}
          <button type="button" onClick={onClearSelection}>取消</button>
        </div>
      )}
      {loading && threads.length === 0 ? (
        <div className="email-empty" role="status" aria-live="polite">正在同步邮件列表…</div>
      ) : threads.length === 0 ? (
        <div className="email-empty email-empty--inviting" role="status">
          <strong>没有匹配的邮件</strong>
          <span>尝试调整搜索关键词、清空筛选条件，或切换到「全部」视图。<br />按 <kbd>/</kbd> 聚焦搜索框 · 按 <kbd>r</kbd> 回到收件箱 · 按 <kbd>?</kbd> 查看快捷键。</span>
        </div>
      ) : (
        <>
          {threads.map((item, index) => {
            const key = `${item.accountId}:${item.id}`;
            return (
              <div className="email-thread-row" key={key}>
                <input aria-label={`选择 ${item.subject}`} type="checkbox" checked={selectedThreadIds.includes(key)} onChange={(event) => onSelectionChange(key, event.target.checked)} />
                <button type="button" className={`email-thread ${item.unread ? "is-unread" : ""} ${index === focusedIndex ? "is-focused" : ""}`} onClick={() => onOpenThread(item)}>
                  <span className="email-thread__avatar" aria-hidden="true">{senderInitials(item.from)}</span>
                  <span className="email-thread__main"><strong>{item.subject || "（无主题）"}</strong><small>{item.from.name || item.from.address} · {item.snippet || "无摘要"}</small>{item.tags?.length ? <span className="email-thread__tags" aria-label="工作区标签">{item.tags.join(" · ")}</span> : null}</span>
                  <time>{new Date(item.date).toLocaleString()}</time>
                </button>
                <div className="email-thread__quick-actions" aria-label={`${item.subject || "线程"} 快捷动作`}>
                  <button type="button" title="标记已读 (u)" disabled={!canManageOperation("mark-read")} onClick={(event) => { event.stopPropagation(); onQuickUpdate(item, "mark-read"); }}>✓</button>
                  <button type="button" title="星标 (s)" disabled={!canManageOperation("star")} onClick={(event) => { event.stopPropagation(); onQuickUpdate(item, "star"); }}>★</button>
                  <button type="button" title="归档" disabled={!canManageOperation("archive")} onClick={(event) => { event.stopPropagation(); onQuickUpdate(item, "archive"); }}>↘</button>
                </div>
                {folder === "scheduled" && <button type="button" className="email-scheduled-cancel" onClick={() => onCancelScheduled(item.id)}>取消计划</button>}
                {folder === "pending" && <button type="button" className="email-scheduled-cancel" onClick={() => onCancelPending(item.id)}>撤回发送</button>}
              </div>
            );
          })}
          {nextCursor && <button type="button" className="email-load-more" onClick={onLoadMore} disabled={loading}>{loading ? "加载中…" : "加载更多"}</button>}
        </>
      )}
    </section>
  );
}
