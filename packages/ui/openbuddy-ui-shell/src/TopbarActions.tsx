/**
 * 对话页 TopBar 右侧操作菜单 — 对齐 WorkBuddy 的更多操作：
 *  - 导出为 Markdown（把当前会话渲染成 .md 文件，经系统保存对话框落盘）
 *  - 置顶 / 取消置顶当前会话
 *  - 归档当前会话
 *
 * 位置：main-topbar 右侧（标题旁边）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { save as saveDialog } from "@/lib/platform/electron-api";
import { MoreDotsIcon, PinFilledIcon, ArchiveIcon } from "@openbuddy/ui-primitives/icons";
import { useSessionStore } from "@/stores/session-store";
import {
  exportTextFile,
  piSetSessionPinned,
  piSetSessionArchived,
} from "@/lib/agent/pi-client";
import { buildSessionMarkdown, sanitizeFilename } from "@/lib/files/export-markdown";

interface TopbarActionsProps {
  sessionId: string;
  title: string;
  pinned?: boolean;
  onToast?: (msg: string) => void;
  /** After archive/pin mutations, parent merges the patch into the sessions store. */
  onSessionsChanged?: (patch?: Record<string, unknown>) => void;
}

export function TopbarActions({
  sessionId,
  title,
  pinned,
  onToast,
  onSessionsChanged,
}: TopbarActionsProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // __pending_xxx IDs are renderer-only placeholders created by beginPendingNewSession
  // before piNewSession returns the real ID. Pi main has never seen them, so any
  // session-id-keyed IPC (pin / archive) throws "Pi session not found". Disable the
  // session-mutating menu items until the real ID migrates in.
  const isPending = sessionId.startsWith("__pending_");

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleExport = useCallback(async () => {
    setOpen(false);
    setBusy(true);
    try {
      const messages = useSessionStore.getState().messages;
      if (messages.length === 0) {
        onToast?.("会话为空，没有可导出的内容");
        return;
      }
      const md = buildSessionMarkdown(messages, title);
      const suggested = sanitizeFilename(title || "对话导出") + ".md";
      const path = await saveDialog({
        defaultPath: suggested,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return; // user cancelled
      await exportTextFile(path, md);
      onToast?.(`已导出到 ${path}`);
    } catch (e) {
      onToast?.(`导出失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  }, [title, onToast]);

  const handleTogglePin = useCallback(async () => {
    setOpen(false);
    if (isPending) {
      onToast?.("会话创建中，请稍候再试");
      return;
    }
    setBusy(true);
    try {
      await piSetSessionPinned(sessionId, !pinned);
      onToast?.(pinned ? "已取消置顶" : "已置顶");
      onSessionsChanged?.({ pinned: !pinned });
    } catch (e) {
      onToast?.(`操作失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  }, [sessionId, pinned, isPending, onToast, onSessionsChanged]);

  const handleArchive = useCallback(async () => {
    setOpen(false);
    if (isPending) {
      onToast?.("会话创建中，请稍候再试");
      return;
    }
    setBusy(true);
    try {
      await piSetSessionArchived(sessionId, true);
      onToast?.("已归档（可在侧栏筛选中找回）");
      onSessionsChanged?.({ archived: true });
    } catch (e) {
      onToast?.(`归档失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  }, [sessionId, isPending, onToast, onSessionsChanged]);

  return (
    <div className="topbar-actions" ref={menuRef}>
      <button
        type="button"
        className="main-topbar__btn"
        aria-label="更多操作"
        data-tip="更多操作"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <MoreDotsIcon size="md" />
      </button>

      {open && (
        <div className="topbar-actions__menu" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="topbar-actions__item" onClick={handleExport}>
            <span className="topbar-actions__item-icon">📄</span>
            <span>导出为 Markdown</span>
          </button>
          <button type="button" className="topbar-actions__item" onClick={handleTogglePin} disabled={isPending}>
            <PinFilledIcon size="sm" />
            <span>{pinned ? "取消置顶" : "置顶会话"}</span>
          </button>
          <button type="button" className="topbar-actions__item" onClick={handleArchive} disabled={isPending}>
            <ArchiveIcon size="sm" />
            <span>归档会话</span>
          </button>
        </div>
      )}
    </div>
  );
}
