/**
 * ViewerToolbar —— 文件 / 产物查看器的统一右侧工具栏。
 *
 * 参考 cabinet `src/components/layout/viewer-toolbar.tsx` 的「一行式工具栏」
 * 思路,但把动作全部抽成 **可选 prop**:调用方只传自己真正支持的handler,
 * 未传的一律渲染成 `disabled` 按钮。这样:
 *  - 同一套 chrome 可以被 PDF / Office / Markdown / 代码 / 网页预览复用,
 *    不会因为某个查看器缺能力而出现「按钮点了没反应」的假交互;
 *  - 可访问性完整:每个按钮都有 `aria-label`、`title` 兜底提示,以及本仓库
 *    全局 tooltip 系统依赖的 `data-tip` 属性(见 `src/styles/chat-shell.css`)。
 *
 * 分组(用细分隔线区分):文档操作 → 视图缩放 → 布局。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DownloadIcon,
  MoreDotsIcon,
  OpenExternalIcon,
  RefreshCwIcon,
} from "@openbuddy/ui-primitives/icons";
import { cx } from "./cx";
import {
  CopyIcon,
  FitWidthIcon,
  SplitViewIcon,
  WrapTextIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "./viewer-icons";
import styles from "./ViewerToolbar.module.css";

/** 「更多」菜单项。 */
export interface ViewerToolbarMenuItem {
  id: string;
  label: string;
  /** 未传时该项渲染为 disabled(与工具栏按钮同一约定)。 */
  onSelect?: () => void;
  danger?: boolean;
  /** 右侧的快捷键提示文案(纯展示)。 */
  shortcut?: string;
  /** 与前一项之间插入分隔线。 */
  separatorBefore?: boolean;
}

export interface ViewerToolbarProps {
  /** 重新加载当前文档。 */
  onRefresh?: () => void;
  /** 刷新进行中:按钮进入 disabled + spin 态。 */
  refreshBusy?: boolean;
  /** 用系统默认应用 / 新窗口打开。 */
  onOpenExternal?: () => void;
  /** 复制内容(路径或全文,由调用方决定)。 */
  onCopy?: () => void;
  /** 下载。 */
  onDownload?: () => void;
  /** 当前自动换行开关状态。 */
  wordWrap?: boolean;
  onToggleWordWrap?: () => void;
  onZoomOut?: () => void;
  /** 当前缩放档位,1 = 100%。 */
  zoom?: number;
  onZoomIn?: () => void;
  /** 点击缩放档位数字 / 适合宽度按钮。 */
  onResetZoom?: () => void;
  minZoom?: number;
  maxZoom?: number;
  onSplit?: () => void;
  /** 分屏开关状态(渲染 `aria-pressed`)。 */
  splitActive?: boolean;
  /**
   * 「更多」按钮。未提供 `moreItems` 时直接调用本回调;提供了 `moreItems`
   * 则展开菜单(菜单项自身仍遵循「无 handler 即 disabled」约定)。
   */
  onMore?: () => void;
  moreItems?: ViewerToolbarMenuItem[];
  /** 工具栏最左侧的自定义内容(例如返回按钮)。 */
  leading?: ReactNode;
  className?: string;
}

interface ToolButtonProps {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  busy?: boolean;
  children: ReactNode;
}

function ToolButton({ label, onClick, disabled, active, busy, children }: ToolButtonProps) {
  const isDisabled = disabled || !onClick;
  return (
    <button
      type="button"
      className={styles.button}
      aria-label={label}
      title={label}
      data-tip={label}
      aria-pressed={active === undefined ? undefined : active}
      aria-busy={busy ? true : undefined}
      disabled={isDisabled}
      onClick={onClick}
    >
      <span className={cx(styles.icon, busy && styles.iconBusy)}>{children}</span>
    </button>
  );
}

export function ViewerToolbar({
  onRefresh,
  refreshBusy,
  onOpenExternal,
  onCopy,
  onDownload,
  wordWrap,
  onToggleWordWrap,
  onZoomOut,
  zoom = 1,
  onZoomIn,
  onResetZoom,
  minZoom = 0.25,
  maxZoom = 4,
  onSplit,
  splitActive,
  onMore,
  moreItems,
  leading,
  className,
}: ViewerToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // 菜单打开时:点击外部 / Esc 关闭。
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const hasMoreMenu = Boolean(moreItems && moreItems.length > 0);
  const zoomPercent = `${Math.round(zoom * 100)}%`;

  const handleMore = useCallback(() => {
    if (hasMoreMenu) {
      setMenuOpen((open) => !open);
      return;
    }
    onMore?.();
  }, [hasMoreMenu, onMore]);

  return (
    <div
      ref={rootRef}
      className={cx("viewer-toolbar", styles.root, className)}
      role="toolbar"
      aria-label="查看器工具"
    >
      {leading ? <div className={styles.leading}>{leading}</div> : null}

      <div className={styles.group}>
        <ToolButton label="重新加载" onClick={onRefresh} busy={refreshBusy}>
          <RefreshCwIcon size="sm" />
        </ToolButton>
        <ToolButton label="用默认应用打开" onClick={onOpenExternal}>
          <OpenExternalIcon size="sm" />
        </ToolButton>
        <ToolButton label="复制内容" onClick={onCopy}>
          <CopyIcon className={styles.svgIcon} />
        </ToolButton>
        <ToolButton label="下载" onClick={onDownload}>
          <DownloadIcon size="sm" />
        </ToolButton>
      </div>

      <span className={styles.separator} aria-hidden="true" />

      <div className={styles.group}>
        <ToolButton
          label="自动换行"
          onClick={onToggleWordWrap}
          active={wordWrap === undefined ? undefined : Boolean(wordWrap)}
        >
          <WrapTextIcon className={styles.svgIcon} />
        </ToolButton>
        <ToolButton
          label="缩小"
          onClick={onZoomOut}
          disabled={zoom <= minZoom}
        >
          <ZoomOutIcon className={styles.svgIcon} />
        </ToolButton>
        <button
          type="button"
          className={cx(styles.button, styles.zoomLevel)}
          aria-label={`缩放级别 ${zoomPercent}`}
          title={`当前缩放 ${zoomPercent}(点击恢复 100%)`}
          data-tip={`当前缩放 ${zoomPercent}`}
          disabled={!onResetZoom}
          onClick={onResetZoom}
        >
          {zoomPercent}
        </button>
        <ToolButton label="放大" onClick={onZoomIn} disabled={zoom >= maxZoom}>
          <ZoomInIcon className={styles.svgIcon} />
        </ToolButton>
        <ToolButton label="适合宽度" onClick={onResetZoom}>
          <FitWidthIcon className={styles.svgIcon} />
        </ToolButton>
      </div>

      <span className={styles.separator} aria-hidden="true" />

      <div className={styles.group}>
        <ToolButton
          label="分屏查看"
          onClick={onSplit}
          active={splitActive === undefined ? undefined : Boolean(splitActive)}
        >
          <SplitViewIcon className={styles.svgIcon} />
        </ToolButton>
        <ToolButton
          label="更多操作"
          onClick={(onMore || hasMoreMenu) ? handleMore : undefined}
          active={hasMoreMenu ? menuOpen : undefined}
        >
          <MoreDotsIcon size="sm" />
        </ToolButton>
        {menuOpen && hasMoreMenu ? (
          <div className={styles.menu} role="menu" aria-label="更多操作">
            {moreItems?.map((item) => (
              <div key={item.id} className={styles.menuRow}>
                {item.separatorBefore ? <div className={styles.menuSep} /> : null}
                <button
                  type="button"
                  role="menuitem"
                  className={cx(styles.menuItem, item.danger && styles.menuItemDanger)}
                  disabled={!item.onSelect}
                  onClick={() => {
                    item.onSelect?.();
                    closeMenu();
                  }}
                >
                  <span className={styles.menuLabel}>{item.label}</span>
                  {item.shortcut ? (
                    <kbd className={styles.menuShortcut}>{item.shortcut}</kbd>
                  ) : null}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
