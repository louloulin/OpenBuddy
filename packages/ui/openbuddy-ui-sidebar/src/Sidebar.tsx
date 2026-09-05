import { memo, useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useSessionsStore, selectHasFilter, selectArchivedCount } from "@/stores/sessions-store";
import { useProjectsStore } from "@/stores/projects-store";
import { StatusIndicator } from "@/components/StatusIndicator";
import { IS_MACOS } from "@/lib/platform/platform";
import {
  piRenameSession,
  piDeleteSession,
  piSetSessionPinned,
  piSetSessionArchived,
  piSetAllSessionsArchived,
  piRenameWorkspace,
  piDeleteWorkspace,
} from "@/lib/agent/pi-client";
import type { SessionSummary, SessionStatus } from "@openbuddy/shared-types";
import {
  WbNewTaskIcon,
  WbAssistantNavIcon,
  WbProjectNavIcon,
  WbExpertNavIcon,
  WbAutomationNavIcon,
  WbMoreNavIcon,
  SearchIcon,
  FilterIcon,
  SidebarToggleIcon,
  BellIcon,
  UserIcon,
  SettingsIcon,
  ChevronDownIcon,
  PinFilledIcon,
  DeleteIcon,
  EditToolIcon,
  MoreDotsIcon,
  ArchiveIcon,
  WbPinIcon,
  WbUnpinIcon,
  AddIcon,
  MyFilesIconV2,
  MoreMenuImaKnowledgeIcon,
  MoreMenuInspirationIcon,
  MoreMenuTencentDocsIcon,
  MoreMenuTencentLexiangIcon,
  PuzzlePieceIcon,
  MailIcon,
} from "@openbuddy/ui-primitives/icons";
import { APP_VERSION } from "@/lib/platform/app-version";
import { useRendererContributions, useRendererSlot } from "@/lib/runtime/renderer-plugin-runtime";
import { RendererSlotView } from "@openbuddy/ui-workbench";
import { ConfirmDialog, type ConfirmTone } from "@openbuddy/ui-dialogs";
import { PromptDialog } from "@openbuddy/ui-dialogs";
import { SessionRowWithSubagents } from "./SubagentIndicator";

type PendingConfirm = {
  title: string;
  description?: string;
  tone?: ConfirmTone;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (ok: boolean) => void;
};
type PendingPrompt = {
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (value: string | null) => void;
};

const NAV = [
  { label: "助理", icon: WbAssistantNavIcon },
  { label: "项目", icon: WbProjectNavIcon },
  // "专家·技能·连接器" 视图内已经包含"插件·市场"子 tab(Pi 官方市场 +
  // 本地插件浏览/安装),所以插件市场入口归在这里,主导航不再单独列项。
  { label: "专家·技能·连接器", icon: WbExpertNavIcon },
  { label: "自动化", icon: WbAutomationNavIcon },
  { label: "邮件", icon: MailIcon },
];

/** Last path segment of a working directory, used as a 空间 node label. */
function basename(p: string): string {
  if (!p) return "默认空间";
  const norm = p.replace(/[\\/]+$/, "");
  const i = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  const name = i >= 0 ? norm.slice(i + 1) : norm;
  return name || "默认空间";
}

/** Compact, locale-friendly relative time for the sidebar row tail. */
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "昨天";
  if (day < 7) return `${day}天前`;
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** Pinned entries first; within a pin tier, most-recently-active first
 *  (by `updatedAt`) so a session you just chatted in rises to the top and its
 *  relative-time tail stays honest. Insertion order breaks remaining ties. */
function sortPinnedFirst<
  T extends { pinned?: boolean; updatedAt?: string },
>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const pin = Number(!!b.pinned) - Number(!!a.pinned);
    if (pin !== 0) return pin;
    const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bt - at;
  });
}

/** Small project icon for sidebar nodes (three connected circles). */
function ProjectNodeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="6" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="17.5" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.7 8.4 10.5 15.6M16.3 8.4 13.5 15.6M8 7h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// ---------- Task filter (对齐 WorkBuddy TaskFilterMenu) ----------

const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_OPTIONS: { value: SessionStatus | null; label: string }[] = [
  { value: null,        label: "全部状态" },
  { value: "working",   label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "failed",    label: "失败" },
  { value: "pending",   label: "待处理" },
  { value: "planning",  label: "规划中" },
];

const DATE_OPTIONS: { value: string | null; label: string }[] = [
  { value: null,           label: "全部时间" },
  { value: "today",        label: "今天" },
  { value: "last7days",    label: "最近 7 天" },
  { value: "last30days",   label: "最近 30 天" },
];

/** Green checkmark shown on the selected filter option. */
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path fill="#00C29A" transform="translate(2.676 3.976)"
        d="M11.3137 0.9428L4.2426 8.0139L0 3.7712L0.9428 2.8284L4.2426 6.1283L10.3709 0L11.3137 0.9428Z" />
    </svg>
  );
}

/** Date preset → start-of-range timestamp (ms). null = no date filter. */
function getDateStart(date: string | null): number | null {
  if (!date) return null;
  if (date === "today") { const s = new Date(); s.setHours(0, 0, 0, 0); return s.getTime(); }
  if (date === "last7days") return Date.now() - 7 * DAY_MS;
  if (date === "last30days") return Date.now() - 30 * DAY_MS;
  return null;
}

/** "working" family: planning/running sessions also match 进行中. */
function statusMatches(sessionStatus: SessionStatus | undefined, filter: SessionStatus): boolean {
  const s = sessionStatus ?? "completed";
  if (filter === "working") return s === "working" || s === "planning";
  return s === filter;
}

/** Apply status + date filters to a session list. */
function filterSessions(
  sessions: SessionSummary[],
  status: SessionStatus | null,
  date: string | null,
): SessionSummary[] {
  if (!status && !date) return sessions;
  const dateStart = getDateStart(date);
  return sessions.filter((s) => {
    if (status && !statusMatches(s.status, status)) return false;
    if (dateStart !== null) {
      const t = s.updatedAt ? new Date(s.updatedAt).getTime() : 0;
      if (t < dateStart) return false;
    }
    return true;
  });
}

/** R2.2 — multi-select reducer. Pure helper exported for testing.
 *  When `multi` is true (Shift/Cmd/Ctrl held), clicking a selected id
 *  removes it; otherwise the new selection REPLACES the prior batch.
 *  When `multi` is false, the resulting set always contains exactly one id.
 */
export function applyToggleSelected(
  prev: Set<string>,
  sessionId: string,
  multi: boolean,
): Set<string> {
  const next = new Set(multi ? prev : []);
  if (multi && prev.has(sessionId)) next.delete(sessionId);
  else next.add(sessionId);
  return next;
}

/** Dropdown menu with status + date filter sections and a reset button. */
function TaskFilterMenu({
  filterStatus,
  filterDate,
  hasFilter,
  onSelectStatus,
  onSelectDate,
  onClear,
}: {
  filterStatus: SessionStatus | null;
  filterDate: string | null;
  hasFilter: boolean;
  onSelectStatus: (s: SessionStatus | null) => void;
  onSelectDate: (d: string | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="task-filter-menu">
      {/* 筛选状态 */}
      <div className="task-filter-menu__section">
        <div className="task-filter-menu__section-title">筛选状态</div>
        <div className="task-filter-menu__options">
          {STATUS_OPTIONS.map((opt) => {
            const selected = opt.value === null ? filterStatus === null : filterStatus === opt.value;
            return (
              <button
                key={opt.value ?? "__all_status"}
                className={"task-filter-menu__option" + (selected ? " task-filter-menu__option--selected" : "")}
                onClick={() => onSelectStatus(opt.value)}
              >
                <span className="task-filter-menu__option-label">{opt.label}</span>
                {selected && <span className="task-filter-menu__option-check"><CheckIcon /></span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="task-filter-menu__divider" />
      {/* 筛选时间 */}
      <div className="task-filter-menu__section">
        <div className="task-filter-menu__section-title">筛选时间</div>
        <div className="task-filter-menu__options">
          {DATE_OPTIONS.map((opt) => {
            const selected = opt.value === null ? filterDate === null : filterDate === opt.value;
            return (
              <button
                key={opt.value ?? "__all_date"}
                className={"task-filter-menu__option" + (selected ? " task-filter-menu__option--selected" : "")}
                onClick={() => onSelectDate(opt.value)}
              >
                <span className="task-filter-menu__option-label">{opt.label}</span>
                {selected && <span className="task-filter-menu__option-check"><CheckIcon /></span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="task-filter-menu__divider" />
      {/* 重置 */}
      <button
        className={"task-filter-menu__reset" + (!hasFilter ? " task-filter-menu__reset--disabled" : "")}
        onClick={() => { if (hasFilter) onClear(); }}
        disabled={!hasFilter}
      >
        <span className="task-filter-menu__reset-label">重置筛选条件</span>
      </button>
    </div>
  );
}

interface ContextMenuProps {
  x: number;
  y: number;
  sessionId: string;
  sessionTitle: string;
  isPinned: boolean;
  onClose: () => void;
  onRename: (sessionId: string, newTitle: string) => void;
  onDelete: (sessionId: string) => void;
  onPin: (sessionId: string, pinned: boolean) => void;
  onArchive: (sessionId: string) => void;
}

function SessionContextMenu({ x, y, sessionId, sessionTitle, isPinned, onClose, onRename, onDelete, onPin, onArchive }: ContextMenuProps) {
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(sessionTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  useEffect(() => {
    const handleClick = () => onClose();
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [onClose]);

  const handleRename = () => {
    if (newTitle.trim() && newTitle !== sessionTitle) {
      onRename(sessionId, newTitle.trim());
    }
    setRenaming(false);
    onClose();
  };

  return (
    <div
      className="context-menu"
      style={{ position: "fixed", left: x, top: y, zIndex: 1000 }}
      onClick={(e) => e.stopPropagation()}
    >
      {renaming ? (
        <div className="context-menu__rename">
          <input
            ref={inputRef}
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="context-menu__rename-input"
          />
        </div>
      ) : (
        <>
          <button className="context-menu__item" onClick={() => setRenaming(true)}>
            <EditToolIcon size="sm" />
            <span>重命名</span>
          </button>
          <button className="context-menu__item" onClick={() => { onPin(sessionId, !isPinned); onClose(); }}>
            <PinFilledIcon size="sm" />
            <span>{isPinned ? "取消置顶" : "置顶"}</span>
          </button>
          <button className="context-menu__item" onClick={() => { onArchive(sessionId); onClose(); }}>
            <ArchiveIcon size="sm" />
            <span>归档</span>
          </button>
          <button className="context-menu__item context-menu__item--danger" onClick={() => { onDelete(sessionId); onClose(); }}>
            <DeleteIcon size="sm" />
            <span>删除</span>
          </button>
        </>
      )}
    </div>
  );
}

/**
 * "更多" 侧栏按钮的弹出菜单 — 对齐 WorkBuddy：
 * - hover 打开，向右浮出（不向下盖住会话列表）
 * - 菜单项：我的文件 / 腾讯文档 / ima知识库 / 乐享知识库 / 灵感
 *
 * 本地工作区可用入口走 onNavigate；未接入的企业服务明确提示不可用。
 */
function MoreDropdown({
  onNavigate,
  onToast,
  activeNav,
}: {
  onNavigate: (label: string) => void;
  onToast?: (message: string) => void;
  activeNav: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    // Small grace so the cursor can move from trigger → popover without flicker.
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  const openMenu = () => {
    clearCloseTimer();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  useEffect(() => () => clearCloseTimer(), []);

  const isActive =
    activeNav === "更多" ||
    activeNav === "资料库" ||
    activeNav === "灵感" ||
    activeNav === "我的文件" ||
    activeNav === "腾讯文档" ||
    activeNav === "ima知识库" ||
    activeNav === "乐享知识库";

  // 弹层里的二级分组:把过去 10 项扁平列表按"用途"归类,避免用户在一个长
  // 列表里搜索。合并规则:
  //   - 我的文件 + 腾讯文档 + 云存储 → 资料库(本地与云端文件入口)
  //   - 知识库 + 乐享知识库 → 资料库(知识管理)
  //   - 网页预览 + 灵感 → 工具(浏览与发现)
  //   - 用量统计 + 通知渠道 → 配额与监控(运维信号)
  //   - 策略设置 → 设置(单条,放进同分组以备扩展)
  type MoreItem = {
    id: string;
    label: string;
    icon: React.ReactNode;
    action: () => void;
  };
  type MoreGroup = { id: string; label: string; items: MoreItem[] };
  const MORE_GROUPS: MoreGroup[] = [
    {
      id: "library",
      label: "资料库",
      items: [
        {
          id: "my_files",
          label: "我的文件",
          icon: <MyFilesIconV2 size="md" />,
          action: () => {
            setOpen(false);
            onNavigate("我的文件");
          },
        },
        {
          id: "tencent_docs",
          label: "腾讯文档",
          icon: <MoreMenuTencentDocsIcon size="md" />,
          action: () => {
            setOpen(false);
            onToast?.("腾讯文档当前不可用：请使用本地文件或已配置的连接器");
          },
        },
        {
          id: "cloud_storage",
          label: "云存储",
          icon: <MoreMenuInspirationIcon size="md" />,
          action: () => {
            setOpen(false);
            onNavigate("云存储");
          },
        },
        {
          id: "knowledge_base",
          label: "知识库",
          icon: <MoreMenuImaKnowledgeIcon size="md" />,
          action: () => {
            setOpen(false);
            onNavigate("知识库");
          },
        },
        {
          id: "lexiang_kb",
          label: "乐享知识库",
          icon: <MoreMenuTencentLexiangIcon size="md" />,
          action: () => {
            setOpen(false);
            onToast?.("乐享知识库当前不可用：请使用本地知识库");
          },
        },
      ],
    },
    {
      id: "tools",
      label: "工具",
      items: [
        {
          id: "browser_preview",
          label: "网页预览",
          icon: <MoreMenuInspirationIcon size="md" />,
          action: () => {
            setOpen(false);
            onNavigate("网页预览");
          },
        },
        {
          id: "inspiration",
          label: "灵感",
          icon: <MoreMenuInspirationIcon size="md" />,
          action: () => {
            setOpen(false);
            onNavigate("灵感");
          },
        },
      ],
    },
    {
      id: "usage",
      label: "配额与监控",
      items: [
        {
          id: "usage_quota",
          label: "用量统计",
          icon: <MoreMenuInspirationIcon size="md" />,
          action: () => {
            setOpen(false);
            onNavigate("用量统计");
          },
        },
        {
          id: "notify_channels",
          label: "通知渠道",
          icon: <MoreMenuInspirationIcon size="md" />,
          action: () => {
            setOpen(false);
            onNavigate("通知渠道");
          },
        },
      ],
    },
    {
      id: "settings",
      label: "设置",
      items: [
        {
          id: "policy_settings",
          label: "策略设置",
          icon: <MoreMenuInspirationIcon size="md" />,
          action: () => {
            setOpen(false);
            onNavigate("策略设置");
          },
        },
      ],
    },
  ];

  return (
    <div
      className={"sidebar__more-wrap" + (open ? " sidebar__more-wrap--open" : "")}
      ref={containerRef}
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className={
          "sidebar__nav-item" +
          (isActive || open ? " sidebar__nav-item--active" : "")
        }
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onFocus={openMenu}
      >
        <WbMoreNavIcon size="md" />
        <span>更多</span>
      </button>
      {open && (
        <div className="sidebar__more-popover" role="menu">
          {MORE_GROUPS.map((group) => (
            <div key={group.id} className="sidebar__more-group">
              <div className="sidebar__more-group-label">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={
                    "sidebar__more-item" +
                    (activeNav === item.label ? " sidebar__more-item--active" : "")
                  }
                  role="menuitem"
                  onClick={item.action}
                >
                  <span className="sidebar__more-item-icon">{item.icon}</span>
                  <span className="sidebar__more-item-label">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One session row in the sidebar. Extracted + memo'd so that, when the parent
 * Sidebar re-renders (e.g. on `expanded` flip or a draft write to a sibling
 * session), only the row whose `session` reference actually changed pays the
 * reconciliation cost. The previous inline `renderConv` rebuilt every row's
 * subtree on each parent render.
 */
type SessionRowProps = {
  session: SessionSummary;
  isCurrent: boolean;
  onSelect: (sessionId: string, cwd?: string) => void;
  onMenuFromButton: (
    e: React.MouseEvent,
    sessionId: string,
    sessionTitle: string,
    isPinned: boolean,
  ) => void;
  onArchive: (sessionId: string) => void;
  onPin: (sessionId: string, pinned: boolean) => void;
  /** R2.5 — restore (unarchive) handler. Only wired up for rows in the
   *  已归档 group so we don't accidentally surface an Unarchive button on
   *  an active row. */
  onUnarchive?: (sessionId: string) => void;
  /** R2.2 — multi-select state for this row. */
  isSelected?: boolean;
  /** Toggles selection on Shift/Cmd/Ctrl click. */
  onToggleSelected?: (sessionId: string, multi: boolean) => void;
};

export const SessionRow = memo(function SessionRow({
  session,
  isCurrent,
  onSelect,
  onMenuFromButton,
  onArchive,
  onPin,
  onUnarchive,
  isSelected,
  onToggleSelected,
}: SessionRowProps) {
  const s = session;
  const title = s.title || "未命名会话";
  const pinned = !!s.pinned;
  const archived = !!s.archived;
  // R2.2 — multi-select support. Hold Shift/Cmd/Ctrl while clicking a row to
  // toggle selection without opening the session. Long-click (300ms) also
  // works for mouse-only users; the toolbar then takes over.
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const multi = e.shiftKey || e.metaKey || e.ctrlKey;
    if (onToggleSelected) {
      onToggleSelected(s.sessionId, multi);
      // For multi-select clicks we don't navigate — user is curating a list.
      if (multi) return;
    }
    onSelect(s.sessionId, s.cwd);
  };
  return (
    <button
      className={
        "sidebar__conv" +
        (isCurrent ? " sidebar__conv--active" : "") +
        (pinned ? " sidebar__conv--pinned" : "") +
        (archived ? " sidebar__conv--archived" : "") +
        (isSelected ? " sidebar__conv--selected" : "")
      }
      onClick={handleClick}
      aria-pressed={isSelected ? true : undefined}
      // Suppress the browser's native context menu — actions live on the
      // inline hover icons (more / archive / pin). Right-clicking the row
      // would otherwise reopen the same `…` popover a second time and
      // confuse users into thinking there are two menus per session.
      onContextMenu={(e) => e.preventDefault()}
      title={title}
    >
      <span className="sidebar__conv-title">{title}</span>
      {pinned && <PinFilledIcon size="sm" className="sidebar__conv-pin" />}
      {archived && <span className="sidebar__conv-archived-tag" aria-label="已归档">已归档</span>}
      {s.updatedAt && <span className="sidebar__conv-time">{relativeTime(s.updatedAt)}</span>}
      <span className="sidebar__conv-actions" onClick={(e) => e.stopPropagation()}>
        <span
          role="button"
          className="sidebar__conv-action"
          aria-label="更多"
          data-tip="更多"
          onClick={(e) => onMenuFromButton(e, s.sessionId, title, pinned)}
        >
          <MoreDotsIcon size="sm" />
        </span>
        {archived ? (
          onUnarchive ? (
            <span
              role="button"
              className="sidebar__conv-action sidebar__conv-action--restore"
              aria-label="恢复"
              data-tip="恢复"
              onClick={() => onUnarchive(s.sessionId)}
            >
              {/* Up-arrow: same primitive as the existing WbPinIcon is wrong
                  (it reads as 置顶). Reuse the lucide Unarchive-style stroke
                  by reusing the Archive outline rotated; instead we just
                  keep the Archive glyph and flip the meaning via aria/tooltip. */}
              <ArchiveIcon size="sm" />
            </span>
          ) : null
        ) : (
          <span
            role="button"
            className="sidebar__conv-action"
            aria-label="归档"
            data-tip="归档"
            onClick={() => onArchive(s.sessionId)}
          >
            <ArchiveIcon size="sm" />
          </span>
        )}
        <span
          role="button"
          className="sidebar__conv-action"
          aria-label={pinned ? "取消置顶" : "置顶"}
          data-tip={pinned ? "取消置顶" : "置顶"}
          onClick={() => onPin(s.sessionId, !pinned)}
        >
          {pinned ? <WbUnpinIcon size="sm" /> : <WbPinIcon size="sm" />}
        </span>
      </span>
    </button>
  );
});

/**
 * WorkBuddy 风格侧栏:品牌行 / 导航 / 双分组(任务 + 空间) / 底部用户区。
 *
 * 任务分组列「独立会话」(cwd 为空);空间分组列本地工作目录节点,每个节点可
 * 展开懒加载其下的会话。详见 sessions-store 的双分组模型。
 */
export function Sidebar({
  onNewSession,
  onSelect,
  onNavigate,
  onOpenSettings,
  onOpenAccount,
  accountLabel,
  onToggleCollapse,
  onToggleWorkspace,
  onOpenSearch,
  onPlaceholder,
  onToast,
  onOpenProject,
  onStartProjectConversation,
  activeNav,
}: {
  onNewSession: () => void;
  onSelect: (sessionId: string, cwd?: string) => void;
  onNavigate: (label: string) => void;
  onOpenSettings: () => void;
  onOpenAccount?: () => void;
  accountLabel?: string;
  /** Collapse the sidebar; an expand affordance is rendered over the main area. */
  onToggleCollapse: () => void;
  /** Expand/collapse a 空间 (workspace) node; lazy-loads its sessions. */
  onToggleWorkspace: (cwd: string, next: boolean) => void;
  /** Open the session search overlay. */
  onOpenSearch: () => void;
  onPlaceholder: (label: string) => void;
  /** Surface transient feedback (e.g. rename/delete failures). */
  onToast?: (message: string) => void;
  /** Open a project detail view from the sidebar. */
  onOpenProject?: (projectId: string) => void;
  /** Start a new conversation within a project. */
  onStartProjectConversation?: (projectId: string) => void;
  activeNav: string;
}) {
  const independent = useSessionsStore((s) => s.independent);
  const workspaces = useSessionsStore((s) => s.workspaces);
  const homeCwd = useSessionsStore((s) => s.homeCwd);
  const workspaceSessions = useSessionsStore((s) => s.workspaceSessions);
  const tasksOpen = useSessionsStore((s) => s.tasksOpen);
  const spacesOpen = useSessionsStore((s) => s.spacesOpen);
  const expanded = useSessionsStore((s) => s.expanded);
  const currentSessionId = useSessionsStore((s) => s.currentSessionId);
  const upsertSession = useSessionsStore((s) => s.upsert);
  const removeSession = useSessionsStore((s) => s.remove);
  const setTasksOpen = useSessionsStore((s) => s.setTasksOpen);
  const setSpacesOpen = useSessionsStore((s) => s.setSpacesOpen);
  const setWorkspaces = useSessionsStore((s) => s.setWorkspaces);

  // Task filter state
  const filterStatus = useSessionsStore((s) => s.filterStatus);
  const filterDate = useSessionsStore((s) => s.filterDate);
  const setFilterStatus = useSessionsStore((s) => s.setFilterStatus);
  const setFilterDate = useSessionsStore((s) => s.setFilterDate);
  const clearFilters = useSessionsStore((s) => s.clearFilters);
  const hasFilter = useSessionsStore(selectHasFilter);
  // R2.5 — archived group state. We auto-toggle showArchived on the first
  // paint when every active session is archived (or near every), so a
  // single accidental bulk archive is recoverable without the user having
  // to hand-edit ~/.pi/openbuddy-state.json.
  const showArchived = useSessionsStore((s) => s.showArchived);
  const setShowArchived = useSessionsStore((s) => s.setShowArchived);
  const archivedCount = useSessionsStore(selectArchivedCount);
  // P1-06: wrap activeCount in useMemo. The reduction over every workspace
  // session list runs on every Sidebar render; with W workspaces this is
  // O(W) regardless of whether the counts changed. Memoizing to
  // [independent.length, workspaceSessions] keeps the reduction tied to
  // actual changes (lists grow/shrink by identity in the store).
  const activeCount = useMemo(
    () =>
      independent.length +
      Object.values(workspaceSessions).reduce((acc, list) => acc + list.length, 0),
    [independent, workspaceSessions],
  );
  useEffect(() => {
    if (!showArchived && archivedCount > 0 && activeCount > 0 && archivedCount >= activeCount) {
      setShowArchived(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivedCount, activeCount]);
  const pluginSidebarContributions = useRendererContributions("sidebar");
  const pluginFooterSlots = useRendererSlot("sidebar.footer.action");
  const pluginBrandMark = useRendererSlot("sidebar.brand.mark");
  const pluginBrandName = useRendererSlot("sidebar.brand.name");
  const pluginWorkspaceSlots = useRendererSlot("sidebar.workspaces");

  // Projects from the local store — shown as expandable nodes in 空间.
  const projects = useProjectsStore((s) => s.projects);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});

  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // Close filter dropdown on outside click / Escape
  useEffect(() => {
    if (!filterOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFilterOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [filterOpen]);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    sessionId: string;
    sessionTitle: string;
    isPinned: boolean;
  } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);
  const requestConfirm = useCallback((options: Omit<PendingConfirm, "resolve">) => new Promise<boolean>((resolve) => {
    setPendingConfirm({ ...options, resolve: (ok) => { setPendingConfirm(null); resolve(ok); } });
  }), []);
  const closeConfirm = useCallback(() => setPendingConfirm((current) => {
    current?.resolve(false);
    return null;
  }), []);
  const requestPrompt = useCallback((options: Omit<PendingPrompt, "resolve">) => new Promise<string | null>((resolve) => {
    setPendingPrompt({ ...options, resolve: (value) => { setPendingPrompt(null); resolve(value); } });
  }), []);
  const closePrompt = useCallback(() => setPendingPrompt((current) => {
    current?.resolve(null);
    return null;
  }), []);

  // Flat view across both groups — used to look up a session's cwd for the
  // rename/delete/pin round-trips (the entries may live in either group).
  //
  // Defensive dedup: in practice a session belongs to exactly one cwd, so
  // it should only live in `independent` OR one `workspaceSessions[cwd]`
  // bucket. If a backend race or a stale `piListSessions` reply ever puts
  // the same `sessionId` in two buckets, React's reconciler throws a
  // duplicate-key warning ("Encountered two children with the same key").
  // First-seen wins — that's the same order the row list iterates in, so
  // the visible row corresponds to whichever bucket was written first.
  const allSessions = useMemo<SessionSummary[]>(
    () => {
      const seen = new Set<string>();
      const out: SessionSummary[] = [];
      for (const s of [...independent, ...Object.values(workspaceSessions).flat()]) {
        if (seen.has(s.sessionId)) continue;
        seen.add(s.sessionId);
        out.push(s);
      }
      return out;
    },
    [independent, workspaceSessions],
  );

  // R2.2 — search + multi-select state.
  // `query` mirrors the existing sessions-store field so typing in this
  // input AND the full SearchOverlay stay in sync. Multi-select is local
  // to the sidebar — clearing it on session switch keeps selection from
  // leaking across contexts.
  const query = useSessionsStore((s) => s.query);
  const setQuery = useSessionsStore((s) => s.setQuery);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => { setSelectedIds(new Set()); }, [currentSessionId]);
  const selectedCount = selectedIds.size;
  const toggleSelected = useCallback((sessionId: string, multi: boolean) => {
    setSelectedIds((prev) => applyToggleSelected(prev, sessionId, multi));
  }, []);

  const handleContextMenu = useCallback((_e: React.MouseEvent, _sessionId: string, _sessionTitle: string, _isPinned: boolean) => {
    // No-op: right-click on a session row is intentionally ignored. The
    // actions live on the inline hover icons (more / archive / pin). The
    // inline `…` icon opens the full popover (rename/delete/pin/archive).
    // Keeping this as a no-op stub preserves the SessionRowProps contract
    // for any older build still wired to it.
  }, []);

  // Rename via pi's `x.ai/session/rename`. pi broadcasts
  // SessionSummaryGenerated on success (pi://summary → store upsert); we also
  // update optimistically to avoid flicker.
  const handleRename = useCallback(async (sessionId: string, newTitle: string) => {
    const session = allSessions.find(s => s.sessionId === sessionId);
    if (!session) return;
    try {
      await piRenameSession(sessionId, newTitle, session.cwd);
      upsertSession({ ...session, title: newTitle });
    } catch (e) {
      onToast?.(`重命名失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  }, [allSessions, upsertSession, onToast]);

  // Delete via pi's `x.ai/session/delete` — removes the on-disk session
  // directory. Only drop the sidebar entry once the backend confirms.
  // R2.2 — wraps the call in a confirm dialog (matches the workspace delete
  // pattern at handleDeleteWorkspace). Bulk variant deletes every selected
  // session in sequence with a single confirm showing the count.
  const handleDelete = useCallback(async (sessionId: string) => {
    const session = allSessions.find(s => s.sessionId === sessionId);
    const title = session?.title || "未命名会话";
    const ok = await requestConfirm({
      title: "删除会话",
      description: `确定删除会话「${title}」？此操作会移除本地会话文件，无法撤销。`,
      confirmLabel: "删除",
      cancelLabel: "取消",
      tone: "danger",
    });
    if (!ok) return;
    const cwd = session?.cwd;
    try {
      await piDeleteSession(sessionId, cwd);
      removeSession(sessionId);
    } catch (e) {
      onToast?.(`删除失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  }, [allSessions, removeSession, onToast, requestConfirm]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ok = await requestConfirm({
      title: `批量删除 ${selectedIds.size} 个会话`,
      description: `将永久移除 ${selectedIds.size} 个本地会话文件，无法撤销。`,
      confirmLabel: `删除 ${selectedIds.size} 个`,
      cancelLabel: "取消",
      tone: "danger",
    });
    if (!ok) return;
    const ids = Array.from(selectedIds);
    let failures = 0;
    for (const sessionId of ids) {
      const session = allSessions.find(s => s.sessionId === sessionId);
      const cwd = session?.cwd;
      try {
        await piDeleteSession(sessionId, cwd);
        removeSession(sessionId);
      } catch (e) {
        failures++;
        onToast?.(`删除失败：${session?.title ?? sessionId}：${String(e).replace(/^Error:\s*/, "")}`);
      }
    }
    setSelectedIds(new Set());
    if (failures === 0) {
      onToast?.(`已删除 ${ids.length} 个会话。`);
    }
  }, [selectedIds, allSessions, removeSession, onToast, requestConfirm]);

  // Pin/unpin — SQLite session metadata; the legacy JSON file is only a mirror.
  const handlePin = useCallback(async (sessionId: string, pinned: boolean) => {
    const session = allSessions.find(s => s.sessionId === sessionId);
    if (!session) return;
    try {
      await piSetSessionPinned(sessionId, pinned);
      upsertSession({ ...session, pinned });
    } catch (e) {
      onToast?.(`置顶失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  }, [allSessions, upsertSession, onToast]);

  // Archive — SQLite session metadata; archived sessions are surfaced in
  // the 已归档 group with a 恢复 action, so we keep the row and just flip
  // `archived: true`. The `!session` guard mirrors handlePin's: pending-
  // session placeholders never belong in allSessions, but assertReal-
  // SessionId() in pi-client catches any future leak with a clearer
  // message.
  const handleArchive = useCallback(async (sessionId: string) => {
    const session = allSessions.find(s => s.sessionId === sessionId);
    if (!session) return;
    try {
      await piSetSessionArchived(sessionId, true);
      upsertSession({ ...session, archived: true });
    } catch (e) {
      onToast?.(`归档失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  }, [allSessions, upsertSession, onToast]);

  // R2.5 — restore (unarchive). list_sessions now keeps archived rows
  // with `archived: true`, so we just flip the flag and let the row jump
  // back to its natural 任务/空间 position on the next render.
  const handleUnarchive = useCallback(async (sessionId: string) => {
    const session = allSessions.find(s => s.sessionId === sessionId);
    if (!session) return;
    try {
      await piSetSessionArchived(sessionId, false);
      upsertSession({ ...session, archived: false });
    } catch (e) {
      onToast?.(`恢复失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  }, [allSessions, upsertSession, onToast]);

  // R2.5 — bulk restore. Updates all archived sessions in one IPC call so
  // recovering a 70+ archived stash is one click instead of 70.
  const handleRestoreAll = useCallback(async () => {
    if (archivedCount === 0) return;
    try {
      const result = await piSetAllSessionsArchived(false);
      // Optimistic local update: flip every archived session in store + caches.
      for (const session of allSessions) {
        if (session.archived) upsertSession({ ...session, archived: false });
      }
      setShowArchived(false);
      onToast?.(`已恢复 ${result.updated} 个会话`);
    } catch (e) {
      onToast?.(`批量恢复失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  }, [archivedCount, allSessions, upsertSession, setShowArchived, onToast]);

  const handleRenameWorkspace = useCallback(async (workspaceId: string, currentTitle: string) => {
    const nextTitle = (await requestPrompt({
      title: "重命名工作空间",
      placeholder: "工作空间名称",
      defaultValue: currentTitle,
      confirmLabel: "重命名",
    }))?.trim();
    if (!nextTitle || nextTitle === currentTitle) return;
    try {
      const result = await piRenameWorkspace(workspaceId, nextTitle);
      setWorkspaces(useSessionsStore.getState().workspaces.map((workspace) =>
        workspace.workspaceId === workspaceId ? { ...workspace, ...result.workspace, title: nextTitle } : workspace,
      ));
    } catch (error) {
      onToast?.(`工作空间重命名失败：${String(error).replace(/^Error:\s*/u, "")}`);
    }
  }, [onToast, requestPrompt, setWorkspaces]);

  const handleDeleteWorkspace = useCallback(async (workspaceId: string, title: string) => {
    const ok = await requestConfirm({
      title: `删除工作空间“${title}”`,
      description: "目录和会话文件不会被删除。",
      tone: "danger",
      confirmLabel: "删除",
    });
    if (!ok) return;
    try {
      await piDeleteWorkspace(workspaceId);
      setWorkspaces(useSessionsStore.getState().workspaces.filter((workspace) => workspace.workspaceId !== workspaceId));
    } catch (error) {
      onToast?.(`工作空间删除失败：${String(error).replace(/^Error:\s*/u, "")}`);
    }
  }, [onToast, requestConfirm, setWorkspaces]);

  // Open the row's context menu anchored to its 更多 hover button.
  const openMenuFromButton = useCallback((e: React.MouseEvent, sessionId: string, sessionTitle: string, isPinned: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({ x: rect.left, y: rect.bottom + 4, sessionId, sessionTitle, isPinned });
  }, []);

  // One session row, shared by the 任务/空间/已归档 groups. The 归档/恢复
  // action is wired based on `s.archived` so the same row component works
  // for both states. No leading icon (WorkBuddy parity); hover reveals
  // 更多 + 归档 or 恢复 + 置顶 actions in place of the relative-time tail.
  // MVP-3 — wrap in SessionRowWithSubagents so the live subagent list
  // appears under the parent row. Zero coupling: SessionRowWithSubagents
  // forwards every SessionRow prop verbatim.
  const renderConv = (s: SessionSummary) => (
    <SessionRowWithSubagents
      key={s.sessionId}
      session={s}
      isCurrent={s.sessionId === currentSessionId}
      onSelect={onSelect}
      onMenuFromButton={openMenuFromButton}
      onArchive={handleArchive}
      onPin={handlePin}
      onUnarchive={s.archived ? handleUnarchive : undefined}
      isSelected={selectedIds.has(s.sessionId)}
      onToggleSelected={toggleSelected}
    />
  );

  // 空间 nodes = every workspace except the inbox (homeCwd), whose sessions
  // already appear in the 任务 group.
  const spaceNodes = workspaces.filter((w) => w.cwd !== homeCwd);

  // Apply status + date filters to the 任务 (independent) list.
  //
  // R2.6 — defensive dedup against duplicate sessionIds in `independent`.
  // A backend race (session upserted via pi://summary while a stale copy is
  // still in the store) can land the same sessionId twice in `independent`,
  // both with `archived: false`. React then throws a duplicate-key warning
  // when `renderConv` maps the list. First-seen wins — same policy as
  // `allSessions` / `archivedSessions` above.
  const filteredIndependent = useMemo(
    () => {
      const seen = new Set<string>();
      const out: SessionSummary[] = [];
      for (const s of filterSessions(independent, filterStatus, filterDate)) {
        if (s.archived) continue;
        if (seen.has(s.sessionId)) continue;
        seen.add(s.sessionId);
        out.push(s);
      }
      return out;
    },
    [independent, filterStatus, filterDate],
  );
  const sortedIndependent = useMemo(
    () => sortPinnedFirst(filteredIndependent),
    [filteredIndependent],
  );
  const sortedWorkspaceCaches = useMemo(() => {
    const out: Record<string, SessionSummary[]> = {};
    for (const cwd of Object.keys(workspaceSessions)) {
      // R2.5 — archive is a separate section; keep it out of the active
      // workspace group to avoid rendering the same row twice.
      // R2.6 — defensive dedup against duplicate sessionIds inside the
      // bucket (same race scenario as filteredIndependent).
      const seen = new Set<string>();
      const active: SessionSummary[] = [];
      for (const s of sortPinnedFirst(workspaceSessions[cwd])) {
        if (s.archived) continue;
        if (seen.has(s.sessionId)) continue;
        seen.add(s.sessionId);
        active.push(s);
      }
      out[cwd] = active;
    }
    return out;
    // `expanded` is included so toggling a workspace re-sorts its (now-loaded)
    // children, but the stable `workspaceSessions` ref avoids needless work
    // when sibling workspaces toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSessions, tasksOpen]);

  // R2.5 — archived sessions across both groups. The 已归档 section reads
  // this list verbatim; sortPinnedFirst keeps pin order consistent with
  // the active groups.
  //
  // Defensive dedup: a session is archived once, but a backend race can
  // surface the same `sessionId` in BOTH `independent` AND one
  // `workspaceSessions[cwd]` bucket with `archived === true`. React then
  // throws a duplicate-key warning on this render. First-seen wins.
  const archivedSessions = useMemo(() => {
    const seen = new Set<string>();
    const list: SessionSummary[] = [];
    const pushIfNew = (s: SessionSummary) => {
      if (seen.has(s.sessionId)) return;
      seen.add(s.sessionId);
      list.push(s);
    };
    for (const session of independent) if (session.archived === true) pushIfNew(session);
    for (const list_ of Object.values(workspaceSessions)) {
      for (const session of list_) if (session.archived === true) pushIfNew(session);
    }
    return sortPinnedFirst(list);
  }, [independent, workspaceSessions]);

  return (
    <>
    <aside className="sidebar">
      {/* macOS Overlay 标题栏:红绿灯悬浮在 logo 行左上,整行作为拖拽区
          (Windows 的窗口拖拽由自绘 TitleBar 负责,故仅在 mac 加属性)。 */}
      <div className="sidebar__logo-row">
        {/* 外层仅作 flex 容器,不要标 data-openbuddy-drag —— 收起/搜索/筛选
            按钮位于行内,父元素一旦被 Electron 注入 -webkit-app-region: drag,
            点击会被窗口拖拽吞掉,onClick 不再触发。空隙由 logo-col 与 spacer
            自身覆盖,拖拽体验不变。 */}
        <div className="sidebar__logo-col" {...(IS_MACOS ? { "data-openbuddy-drag": true } : {})}>
          {pluginBrandMark.map((entry) => (
            <RendererSlotView key={String(entry.options.id ?? entry.options.name)} entry={entry} className="sidebar__logo-mark" />
          ))}
          {pluginBrandName.length > 0
            ? pluginBrandName.map((entry) => (
              <RendererSlotView key={String(entry.options.id ?? entry.options.name)} entry={entry} className="sidebar__logo" />
            ))
            : <span className="sidebar__logo">OpenBuddy</span>}
          <span className="sidebar__version">v{APP_VERSION}</span>
        </div>
        <div className="sidebar__logo-spacer" {...(IS_MACOS ? { "data-openbuddy-drag": true } : {})} />
        <button
          className="sidebar__icon-btn"
          aria-label="收起侧边栏"
          data-tip="收起侧边栏"
          onClick={onToggleCollapse}
        >
          <SidebarToggleIcon size="md" />
        </button>
        <button className="sidebar__icon-btn" aria-label="搜索" onClick={onOpenSearch}>
          <SearchIcon size="md" />
        </button>
        <div className="task-filter-wrap" ref={filterRef}>
          <button
            className={"sidebar__icon-btn task-filter-trigger" + (hasFilter ? " task-filter-trigger--active" : "")}
            aria-label="筛选"
            aria-haspopup="menu"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((v) => !v)}
          >
            <FilterIcon size="md" />
            {hasFilter && <span className="task-filter-trigger__dot" />}
          </button>
          {filterOpen && (
            <div className="task-filter-popover" role="menu">
              <TaskFilterMenu
                filterStatus={filterStatus}
                filterDate={filterDate}
                hasFilter={hasFilter}
                onSelectStatus={setFilterStatus}
                onSelectDate={setFilterDate}
                onClear={clearFilters}
              />
            </div>
          )}
        </div>
      </div>

      {/* R2.2 — search input + multi-select toolbar. The input mirrors
          sessions-store.query so the same query filters both this list and
          the SearchOverlay. The toolbar appears when ≥1 session is selected. */}
      <div className="sidebar__search-row">
        <input
          className="sidebar__search-input"
          type="search"
          role="searchbox"
          aria-label="搜索会话"
          placeholder="搜索会话标题或 ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {selectedCount > 0 && (
        <div className="sidebar__bulk-toolbar" role="toolbar" aria-label="批量操作">
          <span className="sidebar__bulk-count">已选 {selectedCount}</span>
          <button
            type="button"
            className="sidebar__bulk-btn"
            onClick={() => setSelectedIds(new Set())}
          >
            取消
          </button>
          <button
            type="button"
            className="sidebar__bulk-btn sidebar__bulk-btn--danger"
            onClick={() => void handleBulkDelete()}
          >
            删除 {selectedCount}
          </button>
        </div>
      )}

      <nav className="sidebar__nav">
        <button
          className={
            "sidebar__nav-item" +
            (activeNav === "新建任务" ? " sidebar__nav-item--active" : "")
          }
          onClick={onNewSession}
        >
          <WbNewTaskIcon size="md" />
          <span>新建任务</span>
        </button>
        {NAV.map(({ label, icon: Icon }) => {
          return (
            <button
              key={label}
              className={
                "sidebar__nav-item" +
                (activeNav === label || (typeof activeNav === "string" && activeNav.startsWith(`${label}·`))
                  ? " sidebar__nav-item--active"
                  : "")
              }
              onClick={() => onNavigate(label === "助理" ? "助理·本地助理" : label)}
            >
              <Icon size="md" />
              <span>{label}</span>
            </button>
          );
        })}
        {pluginSidebarContributions.map((contribution) => {
          const payload = contribution.payload;
          const label = payload.label ?? payload.title ?? contribution.id;
          // 兼容 hidden: true 的贡献:不渲染该项 (e.g. "OpenBuddy Agent"
          // 占位以保留插件 id 但不出现在主侧栏)。
          if (payload.hidden === true) return null;
          if (!label) return null;
          return (
            <button
              key={contribution.id}
              className="sidebar__nav-item sidebar__nav-item--plugin"
              title={payload.description ?? label}
              onClick={() => {
                if (typeof payload.onActivate === "function") payload.onActivate();
                else if (payload.route) onNavigate(payload.route);
                else if (payload.placeholder) onPlaceholder(payload.placeholder);
                else onNavigate(label);
              }}
            >
              <PuzzlePieceIcon size="md" />
              <span>{label}</span>
            </button>
          );
        })}
        <MoreDropdown onNavigate={onNavigate} onToast={onToast} activeNav={activeNav} />
      </nav>

      <div className="sidebar__content">
        {/* 任务分组: 收件箱(初始目录)下的会话 */}
        <button className="sidebar__section-label" onClick={() => setTasksOpen(!tasksOpen)}>
          <span>任务 ({hasFilter ? `${filteredIndependent.length}/${independent.length}` : independent.length})</span>
          <ChevronDownIcon
            size="sm"
            className={"sidebar__chevron" + (tasksOpen ? "" : " sidebar__chevron--collapsed")}
          />
        </button>
        {tasksOpen && (
          <div className="sidebar__group">
            {filteredIndependent.length === 0 && independent.length > 0 && (
              <div className="sidebar__empty sidebar__empty--filter">无匹配筛选条件的任务</div>
            )}
            {filteredIndependent.length === 0 && independent.length === 0 && (
              <div className="sidebar__empty">暂无任务</div>
            )}
            {sortedIndependent.map(renderConv)}
          </div>
        )}

        {/* 空间分组: 项目节点 + 本地工作目录节点 */}
        <button className="sidebar__section-label" onClick={() => setSpacesOpen(!spacesOpen)}>
          <span>空间 ({projects.length + spaceNodes.length})</span>
          <ChevronDownIcon
            size="sm"
            className={"sidebar__chevron" + (spacesOpen ? "" : " sidebar__chevron--collapsed")}
          />
        </button>
        {spacesOpen && (
          <div className="sidebar__group">
            {pluginWorkspaceSlots.map((entry) => (
              <RendererSlotView key={String(entry.options.id ?? entry.options.name)} entry={entry} className="sidebar__workspace-plugin" />
            ))}
            {/* 项目节点 */}
            {projects.length === 0 && spaceNodes.length === 0 && (
              <div className="sidebar__empty">暂无空间</div>
            )}
            {projects.map((proj) => {
              const open = !!expandedProjects[proj.id];
              return (
                <div key={proj.id} className="sidebar__node-wrap">
                  <button
                    className="sidebar__node sidebar__node--project"
                    onClick={() => onOpenProject?.(proj.id)}
                    title={proj.name}
                  >
                    <ProjectNodeIcon />
                    <span className="sidebar__node-name">{proj.name}</span>
                    <span
                      role="button"
                      className="sidebar__node-action"
                      aria-label="新建对话"
                      data-tip="新建对话"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        onStartProjectConversation?.(proj.id);
                      }}
                    >
                      <AddIcon size="sm" />
                    </span>
                    <ChevronDownIcon
                      size="sm"
                      className={"sidebar__chevron" + (open ? "" : " sidebar__chevron--collapsed")}
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        setExpandedProjects((prev) => ({ ...prev, [proj.id]: !prev[proj.id] }));
                      }}
                    />
                  </button>
                  {open && (
                    <div className="sidebar__children">
                      {proj.conversations.length === 0 && (
                        <div className="sidebar__empty">暂无对话</div>
                      )}
                      {proj.conversations.map((conv) => (
                        <button
                          // Composite key: a session can be registered both in
                          // `sessionsStore.independent` (rendered in the 任务
                          // group at line 1330) AND in `useProjectsStore`
                          // (rendered here). Using a plain `conv.sessionId`
                          // produces a React duplicate-key warning when both
                          // groups are rendered as siblings under `<aside>`.
                          // The `proj::` prefix scopes the key to this
                          // project-node subtree so React's reconciler treats
                          // them as distinct elements.
                          key={`proj::${proj.id}::${conv.sessionId}`}
                          className={
                            "sidebar__conv" +
                            (conv.sessionId === currentSessionId ? " sidebar__conv--active" : "")
                          }
                          onClick={() => onSelect(conv.sessionId, proj.cwd)}
                          title={conv.title}
                        >
                          <span className="sidebar__conv-title">{conv.title}</span>
                          <span className="sidebar__conv-time">{relativeTime(conv.createdAt)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {/* 工作目录节点 */}
            {spaceNodes.map((ws) => {
              const open = !!expanded[ws.cwd];
              const children = workspaceSessions[ws.cwd];
              return (
                <div key={ws.workspaceId ?? ws.cwd} className="sidebar__node-wrap">
                  <button
                    className={
                      "sidebar__node" +
                      (open ? " sidebar__node--active" : "")
                    }
                    onClick={() => onToggleWorkspace(ws.cwd, !open)}
                    title={ws.path ?? ws.cwd}
                    aria-expanded={open}
                  >
                    <WbExpertNavIcon size="sm" />
                    <span className="sidebar__node-name">{ws.title || basename(ws.cwd)}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      className="sidebar__node-action"
                      aria-label={`重命名工作空间 ${ws.title || basename(ws.cwd)}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (ws.workspaceId) void handleRenameWorkspace(ws.workspaceId, ws.title || basename(ws.cwd));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          if (ws.workspaceId) void handleRenameWorkspace(ws.workspaceId, ws.title || basename(ws.cwd));
                        }
                      }}
                    >
                      <EditToolIcon size="sm" />
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      className="sidebar__node-action sidebar__node-action--danger"
                      aria-label={`删除工作空间 ${ws.title || basename(ws.cwd)}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (ws.workspaceId) void handleDeleteWorkspace(ws.workspaceId, ws.title || basename(ws.cwd));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          if (ws.workspaceId) void handleDeleteWorkspace(ws.workspaceId, ws.title || basename(ws.cwd));
                        }
                      }}
                    >
                      <DeleteIcon size="sm" />
                    </span>
                    <ChevronDownIcon
                      size="sm"
                      className={"sidebar__chevron" + (open ? "" : " sidebar__chevron--collapsed")}
                    />
                  </button>
                  {open && (
                    <div className="sidebar__children">
                      {children === undefined && <div className="sidebar__empty">加载中…</div>}
                      {children && children.length === 0 && <div className="sidebar__empty">暂无会话</div>}
                      {children && sortedWorkspaceCaches[ws.cwd]?.map(renderConv)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* R2.5 — 已归档 group: surface archived sessions here with a one-click
            恢复 action so a stray bulk archive is recoverable. Hidden when
            the store says showArchived=false AND nothing is archived yet;
            auto-shown by the recovery effect when every session is archived. */}
        {archivedCount > 0 && (
          <div className="sidebar__archive-section">
            <div className="sidebar__section-header">
              <button
                type="button"
                className="sidebar__section-label"
                onClick={() => setShowArchived(!showArchived)}
                aria-expanded={showArchived}
              >
                <span>已归档 ({archivedCount})</span>
                <ChevronDownIcon
                  size="sm"
                  className={"sidebar__chevron" + (showArchived ? "" : " sidebar__chevron--collapsed")}
                />
              </button>
              {/* R2.5 — bulk restore. With a 70+ archive stash, one click
                  beats 70 individual 恢复 actions; the count badge acts as a
                  visible confirmation before clicking. */}
              {archivedCount > 1 && (
                <button
                  type="button"
                  className="sidebar__archive-restore-all"
                  onClick={handleRestoreAll}
                  aria-label={`恢复全部 ${archivedCount} 个会话`}
                  data-tip={`恢复全部 (${archivedCount})`}
                >
                  恢复全部
                </button>
              )}
            </div>
            {showArchived && (
              <div className="sidebar__group sidebar__group--archived">
                {archivedSessions.length === 0 ? (
                  <div className="sidebar__empty">暂无已归档会话</div>
                ) : (
                  archivedSessions.map(renderConv)
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sidebar__footer">
        {/* R4.2 — global status indicator. Mounted in the sidebar footer
            so it's visible on every page (chat, home, settings, ...) and
            screen-reader users always have a live region for connection
            state. */}
        <StatusIndicator connection="unknown" />
        <button className="sidebar__user" onClick={() => (onOpenAccount ?? onOpenSettings)()} aria-label="用户中心">
          <UserIcon size="md" />
          <span>{accountLabel ?? "企业登录"}</span>
        </button>
        <div className="sidebar__logo-spacer" />
        <button className="sidebar__icon-btn" aria-label="通知" onClick={() => onOpenSettings()}>
          <BellIcon size="md" />
        </button>
        <button className="sidebar__icon-btn" aria-label="设置" onClick={onOpenSettings}>
          <SettingsIcon size="md" />
        </button>
        {pluginFooterSlots.map((entry) => (
          <RendererSlotView key={String(entry.options.id ?? entry.options.key ?? entry.options.name)} entry={entry} className="sidebar__icon-btn" />
        ))}
      </div>

      {contextMenu && (
        <SessionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          sessionId={contextMenu.sessionId}
          sessionTitle={contextMenu.sessionTitle}
          isPinned={contextMenu.isPinned}
          onClose={() => setContextMenu(null)}
          onRename={handleRename}
          onDelete={handleDelete}
          onPin={handlePin}
          onArchive={handleArchive}
        />
      )}
    </aside>
    <ConfirmDialog
      open={pendingConfirm !== null}
      title={pendingConfirm?.title ?? ""}
      description={pendingConfirm?.description}
      tone={pendingConfirm?.tone}
      confirmLabel={pendingConfirm?.confirmLabel}
      cancelLabel={pendingConfirm?.cancelLabel}
      onConfirm={() => {
        const current = pendingConfirm;
        setPendingConfirm(null);
        current?.resolve(true);
      }}
      onCancel={closeConfirm}
    />
    <PromptDialog
      open={pendingPrompt !== null}
      title={pendingPrompt?.title ?? ""}
      description={pendingPrompt?.description}
      placeholder={pendingPrompt?.placeholder}
      defaultValue={pendingPrompt?.defaultValue ?? ""}
      confirmLabel={pendingPrompt?.confirmLabel}
      cancelLabel={pendingPrompt?.cancelLabel}
      onConfirm={(value) => {
        const current = pendingPrompt;
        setPendingPrompt(null);
        current?.resolve(value);
      }}
      onCancel={closePrompt}
    />
  </>
);
}
