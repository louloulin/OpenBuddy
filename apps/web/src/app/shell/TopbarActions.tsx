import { friendlyError } from "@openbuddy/chat-core/error-format";
/**
 * 对话页 TopBar 右侧操作菜单 — 对齐 WorkBuddy 的更多操作：
 *  - 导出为 Markdown（把当前会话渲染成 .md 文件，经系统保存对话框落盘）
 *  - 置顶 / 取消置顶当前会话
 *  - 归档当前会话
 *
 * 位置：main-topbar 右侧（标题旁边）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { MoreDotsIcon, PinFilledIcon, ArchiveIcon } from "@openbuddy/ui/icon/icons/index";
import { useSessionStore } from "@/features/chat/state/session-store";
import {
  exportTextFile,
  saveFileDialog,
  agentForkSession,
  agentHandoff,
  agentClearContext,
  agentSetSessionPinned,
  agentSetSessionArchived,
  agentExportJsonl,
  openSessionWindow,
} from "@openbuddy/client/agent-client";
import { appConfirm, appPrompt } from "@/shared/ui/AppDialog";
import { buildSessionMarkdown, sanitizeFilename } from "@openbuddy/chat-core/export-markdown";
import type { Automation } from "@openbuddy/protocol/dto";
import { TaskOverview } from "./TaskOverview";

interface TopbarActionsProps {
  sessionId: string;
  title: string;
  pinned?: boolean;
  cwd?: string;
  onToast?: (msg: string) => void;
  onForked?: (sessionId: string) => void | Promise<void>;
  /** G1-30: 清空上下文并新开（任务留着，对话从头开始）。 */
  onClearContext?: () => void | Promise<void>;
  /** 交接到新任务 (pii W1.7): navigate to the new session; the draft is pre-filled, never sent. */
  onHandoffed?: (sessionId: string, prompt: string) => void | Promise<void>;
  /** After archive/pin mutations, parent merges the patch into the sessions store. */
  onSessionsChanged?: (patch?: Record<string, unknown>) => void;
  /** 保存为自动化 (pii W4.3): hand a pre-filled draft to the automation panel. */
  onSaveAsAutomation?: (patch: Partial<Automation>) => void;
}

export function TopbarActions({
  sessionId,
  title,
  pinned,
  cwd,
  onToast,
  onSessionsChanged,
  onForked,
  onClearContext,
  onHandoffed,
  onSaveAsAutomation,
}: TopbarActionsProps) {
  const streaming = useSessionStore(state => state.streaming);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
      const path = await saveFileDialog({
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

  /** 会话 JSONL 导出 (pii W6.5): the file can be imported on another machine as a new task. */
  const handleExportJsonl = useCallback(async () => {
    setOpen(false);
    setBusy(true);
    try {
      const suggested = sanitizeFilename(title || "会话导出") + ".jsonl";
      const path = await saveFileDialog({
        defaultPath: suggested,
        filters: [{ name: "JSONL", extensions: ["jsonl"] }],
      });
      if (!path) return;
      await agentExportJsonl(sessionId, path);
      onToast?.(`已导出到 ${path}`);
    } catch (e) {
      onToast?.(`导出失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  }, [sessionId, title, onToast]);

  const handleTogglePin = useCallback(async () => {
    setOpen(false);
    setBusy(true);
    try {
      await agentSetSessionPinned(sessionId, !pinned);
      onToast?.(pinned ? "已取消置顶" : "已置顶");
      onSessionsChanged?.({ pinned: !pinned });
    } catch (e) {
      onToast?.(`操作失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  }, [sessionId, pinned, onToast, onSessionsChanged]);

  const handleArchive = useCallback(async () => {
    setOpen(false);
    setBusy(true);
    try {
      await agentSetSessionArchived(sessionId, true);
      onToast?.("已归档（可在侧栏筛选中找回）");
      onSessionsChanged?.({ archived: true });
    } catch (e) {
      onToast?.(`归档失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  }, [sessionId, onToast, onSessionsChanged]);

  /** Pre-fill the automation form from this session: title, last user message, workspace. */
  const handleSaveAsAutomation = useCallback(() => {
    if (!onSaveAsAutomation) return;
    setOpen(false);
    const lastUser = [...useSessionStore.getState().messages].reverse().find((m) => m.role === "user");
    const prompt = lastUser
      ? lastUser.parts.filter((part) => part.kind === "text").map((part) => part.text).join("\n").trim()
      : "";
    onSaveAsAutomation({ name: title || "自动化任务", prompt, ...(cwd ? { cwds: cwd } : {}) });
  }, [onSaveAsAutomation, title, cwd]);

  const handleFork = async () => {
    if (streaming || busy || !onForked) return;
    setBusy(true); setOpen(false);
    try { const childId = await agentForkSession(sessionId); await onForked(childId); onToast?.("已复制会话"); }
    catch (error) { onToast?.(`复制会话失败：${friendlyError(error)}`); }
    finally { setBusy(false); }
  };

  /** G1-30 清空上下文并新开: the task stays, the conversation starts over. */
  const handleClearContext = async () => {
    if (streaming || busy) return;
    setOpen(false);
    const ok = await appConfirm({
      title: "清空上下文并重新开始？",
      message: "这个任务的对话会清空，任务本身保留。旧的对话仍能在历史版本里找到。",
      confirmLabel: "清空并重新开始",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await agentClearContext(sessionId);
      await onClearContext?.();
      onToast?.("已清空上下文");
    } catch (error) { onToast?.(`清空失败：${friendlyError(error)}`); }
    finally { setBusy(false); }
  };

  /** 交接到新任务 (W1.7): ask for the goal, then open a new session with a self-contained draft. */
  const handleHandoff = async () => {
    if (streaming || busy || !onHandoffed) return;
    setOpen(false);
    const goal = await appPrompt({
      title: "交接到新任务",
      message: "带上当前任务的背景，开一个新会话继续。新会话只会预填草稿，不会自动发送。",
      placeholder: "例如：把这套方案实现到团队版里",
      confirmLabel: "生成交接草稿",
    });
    if (!goal) return;
    setBusy(true);
    try {
      const result = await agentHandoff(sessionId, goal);
      await onHandoffed(result.sessionId, result.prompt);
      onToast?.(`已交接「${result.from.title ?? "原任务"}」，草稿已填好`);
    } catch (error) { onToast?.(`交接失败：${friendlyError(error)}`); }
    finally { setBusy(false); }
  };


  return (
    <>
    {/* 任务概览 (pii W3.3): plan progress · artifacts · turns. */}
    <TaskOverview sessionId={sessionId} />
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
          {onForked && <button type="button" className="topbar-actions__item" disabled={streaming || busy} onClick={() => { void handleFork(); }}>复制会话</button>}
          <button type="button" className="topbar-actions__item" disabled={streaming || busy} onClick={() => { void handleClearContext(); }}>清空上下文并新开</button>
          <button type="button" className="topbar-actions__item" onClick={() => { setOpen(false); void openSessionWindow(sessionId).catch(error => onToast?.(`打开窗口失败：${friendlyError(error)}`)); }}>在新窗口打开</button>
          {onHandoffed && <button type="button" className="topbar-actions__item" disabled={streaming || busy} onClick={() => { void handleHandoff(); }}>交接到新任务…</button>}
          {onSaveAsAutomation && (
            <button type="button" className="topbar-actions__item" onClick={handleSaveAsAutomation}>
              <span>保存为自动化</span>
            </button>
          )}
          <button type="button" className="topbar-actions__item" onClick={handleExport}>
            <span className="topbar-actions__item-icon">📄</span>
            <span>导出为 Markdown</span>
          </button>
          <button type="button" className="topbar-actions__item" onClick={handleExportJsonl}>
            <span>导出为 JSONL（可导入）</span>
          </button>
          <button type="button" className="topbar-actions__item" onClick={handleTogglePin}>
            <PinFilledIcon size="sm" />
            <span>{pinned ? "取消置顶" : "置顶会话"}</span>
          </button>
          <button type="button" className="topbar-actions__item" onClick={handleArchive}>
            <ArchiveIcon size="sm" />
            <span>归档会话</span>
          </button>
        </div>
      )}
    </div>
    </>
  );
}
