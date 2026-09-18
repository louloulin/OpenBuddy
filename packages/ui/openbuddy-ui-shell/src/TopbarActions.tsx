/**
 * 对话页 TopBar 右侧操作菜单 — 对齐 WorkBuddy 的更多操作：
 *  - 导出为 Markdown（把当前会话渲染成 .md 文件，经系统保存对话框落盘）
 *  - 置顶 / 取消置顶当前会话
 *  - 归档当前会话
 *
 * Phase B 增补（全部向后兼容，老调用方零改动）：
 *  - `statusChip`      → 在菜单按钮左侧内联一枚状态胶囊（如 TopbarStatusChip）
 *  - `themeMenu`       → 追加「切换主题」行，点一次切到下一套主题
 *  - `onShowShortcuts` → 追加「键盘快捷键」行
 *  - 每一行右侧渲染 <ShortcutHint>，和弦集中在 `TOPBAR_ACTION_SHORTCUTS`
 *
 * 位置：main-topbar 右侧（标题旁边）。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { save as saveDialog } from "@/lib/platform/electron-api";
import {
  MoreDotsIcon,
  PinFilledIcon,
  ArchiveIcon,
  KeyboardIcon,
} from "@openbuddy/ui-primitives/icons";
import { useTheme } from "@openbuddy/ui-theme/client";
import { useSlotComponents } from "@openbuddy/ui-runtime/client";
import { useShortcut } from "./useShortcut";
import { useSessionStore } from "@/stores/session-store";
import {
  exportTextFile,
  piSetSessionPinned,
  piSetSessionArchived,
} from "@/lib/agent/pi-client";
import { buildSessionMarkdown, sanitizeFilename } from "@/lib/files/export-markdown";
import { ShortcutHint } from "./ShortcutHint";
import { ThemeBoundary } from "./ThemeBoundary";
import { TOPBAR_ACTION_SHORTCUTS } from "./topbar-shortcuts";

interface TopbarActionsProps {
  sessionId: string;
  title: string;
  pinned?: boolean;
  onToast?: (msg: string) => void;
  /** After archive/pin mutations, parent merges the patch into the sessions store. */
  onSessionsChanged?: (patch?: Record<string, unknown>) => void;
  /** 菜单按钮左侧的内联状态胶囊（通常传 <TopbarStatusChip />）。 */
  statusChip?: ReactNode;
  /** 是否在菜单里追加「切换主题」行（默认关闭）。 */
  themeMenu?: boolean;
  /** 传入后追加「键盘快捷键」行。 */
  onShowShortcuts?: () => void;
}

export function TopbarActions({
  sessionId,
  title,
  pinned,
  onToast,
  onSessionsChanged,
  statusChip,
  themeMenu = false,
  onShowShortcuts,
}: TopbarActionsProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // R71 — 「📝 新草稿」入口。读 editor.draft slot,空槽(本环境未挂 ui-editor 或插件卸了)时不渲染入口。
  const [draftOpen, setDraftOpen] = useState(false);
  const draftImpls = useSlotComponents("editor.draft");
  const DraftImpl = draftImpls[0] as
    | React.ComponentType<{
        open: boolean;
        onClose?: () => void;
        onApply?: (md: string) => void;
        onCopy?: (md: string) => void;
        initialMarkdown?: string;
        title?: string;
      }>
    | undefined;
  const menuRef = useRef<HTMLDivElement>(null);

  // R72 — 「📝 新草稿」键盘快捷键 Mod+Shift+D。
  // 只有当 DraftImpl 真的注册了才绑定(空槽时绑定也没意义 —— 菜单都没渲染)。
  // useShortcut 的签名是 (options, callback) —— preventDefault 属于 options
  // 的一部分,不是第三个参数(R71 引入时写成了三参调用,一直是 tsc 报错)。
  useShortcut(
    { mod: true, shift: true, key: "d", preventDefault: true },
    () => {
      if (!DraftImpl) return;
      // 与点菜单按钮一致:开草稿模态。空槽 / 草稿已开时 no-op。
      setDraftOpen((v) => !v);
    }
  );

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

  const handleShowShortcuts = useCallback(() => {
    setOpen(false);
    onShowShortcuts?.();
  }, [onShowShortcuts]);

  return (
    <>
      {statusChip}
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
            {DraftImpl ? (
              <button
                type="button"
                className="topbar-actions__item"
                onClick={() => {
                  setOpen(false);
                  setDraftOpen(true);
                }}
                data-testid="topbar-draft-button"
              >
                <span className="topbar-actions__item-icon">📝</span>
                <span className="topbar-actions__item-label">新草稿</span>
                <ShortcutHint chord={TOPBAR_ACTION_SHORTCUTS.draft} />
              </button>
            ) : null}
            <button type="button" className="topbar-actions__item" onClick={handleExport}>
              <span className="topbar-actions__item-icon">📄</span>
              <span className="topbar-actions__item-label">导出为 Markdown</span>
              <ShortcutHint chord={TOPBAR_ACTION_SHORTCUTS.exportMarkdown} />
            </button>
            <button type="button" className="topbar-actions__item" onClick={handleTogglePin} disabled={isPending}>
              <span className="topbar-actions__item-icon"><PinFilledIcon size="sm" /></span>
              <span className="topbar-actions__item-label">{pinned ? "取消置顶" : "置顶会话"}</span>
              <ShortcutHint chord={TOPBAR_ACTION_SHORTCUTS.togglePin} />
            </button>
            <button type="button" className="topbar-actions__item" onClick={handleArchive} disabled={isPending}>
              <span className="topbar-actions__item-icon"><ArchiveIcon size="sm" /></span>
              <span className="topbar-actions__item-label">归档会话</span>
              <ShortcutHint chord={TOPBAR_ACTION_SHORTCUTS.archive} />
            </button>

            {themeMenu && (
              <>
                <div className="topbar-actions__divider" role="presentation" />
                <ThemeBoundary
                  fallback={
                    <div className="topbar-actions__item topbar-actions__item--disabled" aria-disabled>
                      <span className="topbar-actions__item-icon">🎨</span>
                      <span className="topbar-actions__item-label">主题不可用</span>
                    </div>
                  }
                >
                  <ThemeCycleRow />
                </ThemeBoundary>
              </>
            )}

            {onShowShortcuts && (
              <>
                {!themeMenu && <div className="topbar-actions__divider" role="presentation" />}
                <button
                  type="button"
                  className="topbar-actions__item"
                  onClick={handleShowShortcuts}
                  data-testid="topbar-actions-shortcuts"
                >
                  <span className="topbar-actions__item-icon"><KeyboardIcon size="sm" /></span>
                  <span className="topbar-actions__item-label">键盘快捷键</span>
                  <ShortcutHint chord={TOPBAR_ACTION_SHORTCUTS.shortcutsHelp} />
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {DraftImpl ? (
        <DraftImpl
          open={draftOpen}
          onClose={() => setDraftOpen(false)}
          onApply={(md) => {
            setDraftOpen(false);
            onToast?.(md ? `草稿已应用（${md.length} 字符）` : "草稿为空");
          }}
          onCopy={(md) => {
            void navigator.clipboard?.writeText(md).then(
              () => onToast?.("草稿 markdown 已复制到剪贴板"),
              () => onToast?.("剪贴板不可用"),
            );
          }}
        />
      ) : null}
    </>
  );
}

/**
 * 「切换主题」行 —— 独立组件，保证 `useTheme()` 只在 `themeMenu` 打开时才被调用
 * （未挂 ThemeProvider 的宿主走 ThemeBoundary 降级，而不是让 hooks 规则崩掉）。
 * 点击一次循环到 `list()` 里的下一套主题；右侧显示当前主题名。
 */
function ThemeCycleRow() {
  const service = useTheme();
  const [name, setName] = useState(() => service.currentName());

  useEffect(() => {
    setName(service.currentName());
    return service.subscribe(() => setName(service.currentName()));
  }, [service]);

  const cycle = useCallback(() => {
    const all = service.list();
    if (all.length === 0) return;
    const idx = all.findIndex((t) => t.name === service.currentName());
    const next = all[(idx + 1) % all.length];
    if (next) service.setThemeByName(next.name);
  }, [service]);

  return (
    <button
      type="button"
      className="topbar-actions__item"
      onClick={cycle}
      data-testid="topbar-actions-theme"
      title="切换到下一套主题"
    >
      <span className="topbar-actions__item-icon">🎨</span>
      <span className="topbar-actions__item-label">切换主题</span>
      <span className="topbar-actions__item-meta">{name}</span>
    </button>
  );
}
