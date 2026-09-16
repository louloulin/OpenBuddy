/**
 * @openbuddy/ui-shell/UpdateDialog — 应用更新对话框(纯展示)。
 *
 * 对齐 WorkBuddy / cabinet 的更新弹窗形态:标题栏显示 当前版本 → 新版本,
 * 中间是 release notes 列表,底部按 `state` 切换主按钮:
 *
 *   idle        → [稍后提醒] [下载更新]
 *   downloading → [取消] [下载中… 62%]
 *   ready       → [稍后提醒] [重启并安装]
 *   error       → [稍后提醒] [重试]
 *
 * 组件不发起任何网络 / IPC 请求 —— 下载与安装由宿主通过回调驱动。
 * Portal 到 document.body,自带 Esc 关闭 + 焦点陷阱 + 焦点归还。
 */
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./UpdateDialog.module.css";

export type UpdateDialogState = "idle" | "downloading" | "ready" | "error";

export interface UpdateNotes {
  version: string;
  /** 发布日期文案(宿主格式化,组件不解析)。 */
  date?: string;
  items: string[];
}

export interface UpdateDialogProps {
  open: boolean;
  currentVersion: string;
  nextVersion: string;
  notes?: UpdateNotes[];
  state: UpdateDialogState;
  /** 0–1 的下载进度;仅在 state="downloading" 时有意义。 */
  progress?: number;
  /** state="error" 时的错误文案。 */
  error?: string;
  onLater(): void;
  onInstall(): void;
  onRestart(): void;
  onClose(): void;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function UpdateDialog({
  open,
  currentVersion,
  nextVersion,
  notes,
  state,
  progress,
  error,
  onLater,
  onInstall,
  onRestart,
  onClose,
}: UpdateDialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Esc 关闭 + Tab 焦点陷阱;卸载时把焦点还给打开前的元素。
  useEffect(() => {
    if (!open) return;
    const previous = (
      typeof document !== "undefined" ? document.activeElement : null
    ) as HTMLElement | null;

    const focusables = (): HTMLElement[] => {
      const root = panelRef.current;
      if (!root) return [];
      return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    };

    const first = focusables()[0];
    (first ?? panelRef.current)?.focus?.();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? list.indexOf(active) : -1;
      if (e.shiftKey) {
        if (idx <= 0) {
          e.preventDefault();
          list[list.length - 1].focus();
        }
      } else if (idx === -1 || idx === list.length - 1) {
        e.preventDefault();
        list[0].focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previous?.focus?.();
    };
  }, [open, onClose]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const pct = Math.round(clamp01(progress ?? 0) * 100);

  const primary: ReactNode =
    state === "downloading" ? (
      <button type="button" className={styles.btnPrimary} disabled>
        下载中… {pct}%
      </button>
    ) : state === "ready" ? (
      <button type="button" className={styles.btnPrimary} onClick={onRestart}>
        重启并安装
      </button>
    ) : state === "error" ? (
      <button type="button" className={styles.btnPrimary} onClick={onInstall}>
        重试
      </button>
    ) : (
      <button type="button" className={styles.btnPrimary} onClick={onInstall}>
        下载更新
      </button>
    );

  // 次按钮在各状态下都只表示"暂不更新";error 状态额外的 "关闭" 由
  // 标题栏 ✕ / Esc / 遮罩承担,避免同屏出现两个同名按钮。
  const secondary: ReactNode = (
    <button type="button" className={styles.btnGhost} onClick={onLater}>
      {state === "downloading" ? "取消" : "稍后提醒"}
    </button>
  );

  const node = (
    <div className={styles.overlay} onClick={handleBackdrop} data-testid="update-dialog-overlay">
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ob-update-title"
        aria-describedby={error ? "ob-update-error" : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 id="ob-update-title" className={styles.title}>
            发现新版本
          </h2>
          <button
            type="button"
            className={styles.close}
            aria-label="关闭"
            data-tip="关闭"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className={styles.versions}>
          <span className={styles.versionMuted}>v{currentVersion}</span>
          <span className={styles.arrow} aria-hidden>
            →
          </span>
          <span className={styles.versionNew}>v{nextVersion}</span>
        </div>

        {state === "downloading" && (
          <div
            className={styles.progress}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label="下载进度"
          >
            <div className={styles.progressFill} style={{ width: `${pct}%` }} />
          </div>
        )}

        {state === "error" && (
          <p id="ob-update-error" className={styles.error} role="alert">
            {error ?? "更新失败,请稍后重试。"}
          </p>
        )}

        <div className={styles.notes}>
          {notes && notes.length > 0 ? (
            notes.map((group) => (
              <section key={group.version} className={styles.notesGroup}>
                <div className={styles.notesHead}>
                  <span className={styles.notesVersion}>v{group.version}</span>
                  {group.date ? <span className={styles.notesDate}>{group.date}</span> : null}
                </div>
                <ul className={styles.notesList}>
                  {group.items.map((item, i) => (
                    <li key={`${group.version}-${i}`} className={styles.notesItem}>
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <p className={styles.notesEmpty}>本次更新没有附带的更新说明。</p>
          )}
        </div>

        <footer className={styles.footer}>
          {secondary}
          {primary}
        </footer>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
