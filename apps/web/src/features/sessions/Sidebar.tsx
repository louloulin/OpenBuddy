import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { keyLabel } from "@/shared/lib/shortcuts";
import { useUnseenStore } from "@/app/state/unseen-store";
import { appConfirm } from "../../shared/ui/AppDialog";
import { useSessionsStore, selectHasFilter } from "@/features/sessions/state/sessions-store";
import { usePermissionStore } from "@/features/approvals/state/permission-store";
import { useQuestionStore } from "@/features/approvals/state/question-store";
import { useProjectsStore, type ProjectMeta } from "@/features/projects/state/projects-store";
import { IS_MACOS } from "@openbuddy/platform/platform";
import logoMarkUrl from "@/assets/openbuddy-logo.png";

type SessionsSnapshot = ReturnType<typeof useSessionsStore.getState>;
import {
  agentRenameSession,
  agentDeleteSession,
  agentSetSessionPinned,
  agentSetSessionArchived,
} from "@openbuddy/client/agent-client";
import type { SessionSummary } from "@openbuddy/protocol/dto";
import {
  WbNewTaskIcon,
  WbExpertNavIcon,
  SearchIcon,
  FilterIcon,
  SidebarToggleIcon,
  BellIcon,
  UserIcon,
  SettingsIcon,
  ChevronDownIcon,
  PinFilledIcon,
  MoreDotsIcon,
  ArchiveIcon,
  WbPinIcon,
  WbUnpinIcon,
  AddIcon,
} from "@openbuddy/ui/icon/icons/index";
import { APP_VERSION } from "@/app/app-version";
import { AppSwitcher } from "../apps";
import { basename, relativeTime, sortPinnedFirst, ProjectNodeIcon } from "./sidebar-parts/helpers";
import { filterSessions, TaskFilterMenu } from "./sidebar-parts/TaskFilterMenu";
import { SessionContextMenu } from "./sidebar-parts/SessionContextMenu";
import { MoreDropdown } from "./sidebar-parts/MoreDropdown";
import { useLocale } from "../../shared/i18n";
import { ListChecks } from "lucide-react";
import { TasksPanel } from "./TasksPanel";

/** 「最近」列表一屏显示的条数；超出折叠为「查看更多」（WorkBuddy 对齐）。 */
const RECENT_COLLAPSED = 8;

/** A sidebar / 更多 entry. The app builds the lists from its FeatureRegistry (pii W0.2): the former
 *  fixed NAV (项目, 技能与 MCP) is now the registry's 项目 and 专家·技能·连接器 entries. */
export interface SidebarNavItem {
  id: string;
  label: string;
  icon: typeof WbExpertNavIcon;
}

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
  onToggleCollapse,
  onToggleWorkspace,
  onOpenSearch,
  onPlaceholder,
  onToast,
  onOpenProject,
  onStartProjectConversation,
  activeNav,
  nav = [],
  moreItems = [],
}: {
  /** Primary entries the host can serve (from the app's FeatureRegistry). */
  nav?: SidebarNavItem[];
  /** 更多 menu entries the host can serve. */
  moreItems?: SidebarNavItem[];
  onNewSession: () => void;
  onSelect: (sessionId: string, cwd?: string) => void;
  onNavigate: (label: string) => void;
  onOpenSettings: () => void;
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
  const pinnedOpen = useSessionsStore((s: SessionsSnapshot) => s.pinnedOpen);
  const tasksOpen = useSessionsStore((s: SessionsSnapshot) => s.tasksOpen);
  const spacesOpen = useSessionsStore((s: SessionsSnapshot) => s.spacesOpen);
  const expanded = useSessionsStore((s: SessionsSnapshot) => s.expanded);
  const { t, tOptional, locale } = useLocale();
  const navLabel = (label: string) => tOptional(`nav.${label}`) ?? label;
  const currentSessionId = useSessionsStore((s) => s.currentSessionId);
  const permissionQueues = usePermissionStore((s) => s.queues);
  const unseenIds = useUnseenStore((s) => s.ids);
  const questionQueues = useQuestionStore((s) => s.queues);
  const upsertSession = useSessionsStore((s) => s.upsert);
  const removeSession = useSessionsStore((s) => s.remove);
  const setTasksOpen = useSessionsStore((s) => s.setTasksOpen);
  const setSpacesOpen = useSessionsStore((s) => s.setSpacesOpen);

  // Task filter state
  const filterStatus = useSessionsStore((s) => s.filterStatus);
  const filterDate = useSessionsStore((s) => s.filterDate);
  const setFilterStatus = useSessionsStore((s) => s.setFilterStatus);
  const setFilterDate = useSessionsStore((s) => s.setFilterDate);
  const clearFilters = useSessionsStore((s) => s.clearFilters);
  const hasFilter = useSessionsStore(selectHasFilter);

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

  // G1-30 批量选择：归档/删除多个任务；删除需要一次确认。
  const [selectionMode, setSelectionMode] = useState(false);
  // WorkBuddy 的「最近」默认只显示一屏，超出折叠为「查看更多 (总数)」。
  const [recentShowAll, setRecentShowAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const exitSelection = useCallback(() => { setSelectionMode(false); setSelected(new Set()); }, []);
  const toggleSelected = useCallback((sessionId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId); else next.add(sessionId);
      return next;
    });
  }, []);

  // Flat view across both groups — used to look up a session's cwd for the
  // rename/delete/pin round-trips (the entries may live in either group).
  const allSessions = useMemo<SessionSummary[]>(
    () => [...independent, ...Object.values(workspaceSessions).flat()],
    [independent, workspaceSessions],
  );

  // WorkBuddy-style pinned section: pinned tasks live in their own group and
  // are removed from 最近 / 空间 so a task appears exactly once.
  const pinnedSessions = useMemo(
    () => filterSessions(allSessions.filter((s) => s.pinned), filterStatus, filterDate),
    [allSessions, filterStatus, filterDate],
  );

  // ProjectsPanel already sorts pinned first; mirror that contract in the
  // sidebar space group so the two entry points stay consistent.
  const sortedProjects = useMemo(
    () => [...projects].sort((a: ProjectMeta, b: ProjectMeta) => Number(b.pinned === true) - Number(a.pinned === true)),
    [projects],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, sessionId: string, sessionTitle: string, isPinned: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId, sessionTitle, isPinned });
  }, []);

  // SessionSummaryGenerated on success (agent://summary → store upsert); we also
  // update optimistically to avoid flicker.
  const handleRename = useCallback(async (sessionId: string, newTitle: string) => {
    const session = allSessions.find(s => s.sessionId === sessionId);
    if (!session) return;
    try {
      await agentRenameSession(sessionId, newTitle, session.cwd);
      upsertSession({ ...session, title: newTitle });
    } catch (e) {
      onToast?.(`重命名失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  }, [allSessions, upsertSession, onToast]);

  // directory. Only drop the sidebar entry once the backend confirms.
  const handleDelete = useCallback(async (sessionId: string) => {
    const session = allSessions.find(s => s.sessionId === sessionId);
    const cwd = session?.cwd;
    const name = session?.title?.trim() || "未命名任务";
    const ok = await appConfirm({
      title: `删除任务「${name.length > 24 ? name.slice(0, 24) + "…" : name}」？`,
      message: "对话记录会从本机删除且无法恢复。如只是不想在列表中看到，可以选择归档。",
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await agentDeleteSession(sessionId, cwd);
      removeSession(sessionId);
    } catch (e) {
      onToast?.(`删除失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  }, [allSessions, removeSession, onToast]);

  const handlePin = useCallback(async (sessionId: string, pinned: boolean) => {
    const session = allSessions.find(s => s.sessionId === sessionId);
    if (!session) return;
    try {
      await agentSetSessionPinned(sessionId, pinned);
      upsertSession({ ...session, pinned });
    } catch (e) {
      onToast?.(`置顶失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  }, [allSessions, upsertSession, onToast]);

  // Archive — OpenBuddy-only state; archived sessions are filtered out of
  // list_sessions, so drop the sidebar entry immediately on success.
  const handleArchive = useCallback(async (sessionId: string) => {
    try {
      await agentSetSessionArchived(sessionId, true);
      removeSession(sessionId);
    } catch (e) {
      onToast?.(`归档失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  }, [removeSession, onToast]);

  /** G1-30: archive every selected task; one toast summarises partial failures. */
  const handleBulkArchive = useCallback(async () => {
    if (!selected.size || bulkBusy) return;
    setBulkBusy(true);
    const ids = [...selected];
    let failed = 0;
    for (const id of ids) {
      try {
        await agentSetSessionArchived(id, true);
        removeSession(id);
      } catch { failed++; }
    }
    setBulkBusy(false);
    exitSelection();
    onToast?.(failed ? `已归档 ${ids.length - failed} 个任务，${failed} 个失败` : `已归档 ${ids.length} 个任务`);
  }, [selected, bulkBusy, removeSession, exitSelection, onToast]);

  /** G1-30: delete every selected task after a single confirmation. */
  const handleBulkDelete = useCallback(async () => {
    if (!selected.size || bulkBusy) return;
    const ids = [...selected];
    const ok = await appConfirm({
      title: `删除选中的 ${ids.length} 个任务？`,
      message: "对话记录会从本机删除且无法恢复。如只是不想在列表中看到，可以选择归档。",
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
    setBulkBusy(true);
    let failed = 0;
    for (const id of ids) {
      try {
        await agentDeleteSession(id, allSessions.find((s) => s.sessionId === id)?.cwd);
        removeSession(id);
      } catch { failed++; }
    }
    setBulkBusy(false);
    exitSelection();
    onToast?.(failed ? `已删除 ${ids.length - failed} 个任务，${failed} 个失败` : `已删除 ${ids.length} 个任务`);
  }, [selected, bulkBusy, allSessions, removeSession, exitSelection, onToast]);

  // Open the row's context menu anchored to its 更多 hover button.
  const openMenuFromButton = useCallback((e: React.MouseEvent, sessionId: string, sessionTitle: string, isPinned: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({ x: rect.left, y: rect.bottom + 4, sessionId, sessionTitle, isPinned });
  }, []);

  // One session row, shared by the 任务 group and 空间 node children.
  // No leading icon (WorkBuddy parity); hover reveals 更多/归档/置顶 actions
  // in place of the relative-time tail.
  const renderConv = (s: SessionSummary) => {
    const awaiting = (permissionQueues[s.sessionId]?.length ?? 0) + (questionQueues[s.sessionId]?.length ?? 0) > 0;
    const working = s.status === "working";
    const failed = s.status === "failed";
    const unseen = unseenIds.includes(s.sessionId) && s.sessionId !== currentSessionId;
    return (
    <button
      key={s.sessionId}
      className={
        "sidebar__conv" +
        (s.sessionId === currentSessionId ? " sidebar__conv--active" : "") +
        (s.pinned ? " sidebar__conv--pinned" : "") +
        (selectionMode ? " sidebar__conv--selecting" : "") +
        (selected.has(s.sessionId) ? " sidebar__conv--selected" : "") +
        (working || awaiting ? " sidebar__conv--live" : "")
      }
      onClick={() => (selectionMode ? toggleSelected(s.sessionId) : onSelect(s.sessionId, s.cwd))}
      onContextMenu={(e) => handleContextMenu(e, s.sessionId, s.title || "未命名会话", s.pinned || false)}
      title={s.title}
    >
      {selectionMode && (
        <span
          className={"sidebar__conv-check" + (selected.has(s.sessionId) ? " sidebar__conv-check--on" : "")}
          role="checkbox"
          aria-checked={selected.has(s.sessionId)}
          aria-label={`选择 ${s.title || "未命名会话"}`}
        />
      )}
      {awaiting ? (
        <span className="sidebar__conv-state sidebar__conv-state--awaiting" aria-label="待确认" />
      ) : working ? (
        <span className="sidebar__conv-state sidebar__conv-state--working" aria-label="执行中" />
      ) : failed ? (
        <span className="sidebar__conv-state sidebar__conv-state--failed" aria-label="执行出错" />
      ) : unseen ? (
        <span className="sidebar__conv-state sidebar__conv-state--done" aria-label="已完成未查看" title="已完成，还没查看" />
      ) : null}
      <span className="sidebar__conv-title">{s.title || "未命名会话"}</span>
      {s.pinned && <PinFilledIcon size="sm" className="sidebar__conv-pin" />}
      {awaiting ? (
        <span className="sidebar__conv-badge">待确认</span>
      ) : working ? (
        <span className="sidebar__conv-time">执行中</span>
      ) : (
        s.updatedAt && <span className="sidebar__conv-time">{relativeTime(s.updatedAt, locale)}</span>
      )}
      {!selectionMode && (
        <span className="sidebar__conv-actions" onClick={(e) => e.stopPropagation()}>
          <span
            role="button"
            className="sidebar__conv-action"
            aria-label="更多"
            data-tip="更多"
            onClick={(e) => openMenuFromButton(e, s.sessionId, s.title || "未命名会话", s.pinned || false)}
          >
            <MoreDotsIcon size="sm" />
          </span>
          <span
            role="button"
            className="sidebar__conv-action"
            aria-label="归档"
            data-tip="归档"
            onClick={() => handleArchive(s.sessionId)}
          >
            <ArchiveIcon size="sm" />
          </span>
          <span
            role="button"
            className="sidebar__conv-action"
            aria-label={s.pinned ? "取消置顶" : "置顶"}
            data-tip={s.pinned ? "取消置顶" : "置顶"}
            onClick={() => handlePin(s.sessionId, !s.pinned)}
          >
            {s.pinned ? <WbUnpinIcon size="sm" /> : <WbPinIcon size="sm" />}
          </span>
        </span>
      )}
    </button>
    );
  };

  // 空间 nodes = every workspace except the inbox (homeCwd), whose sessions
  // already appear in the 任务 group.
  const spaceNodes = workspaces.filter((w) => w.cwd !== homeCwd);

  // Apply status + date filters to the 任务 (independent) list.
  const filteredIndependent = useMemo(
    () => filterSessions(independent.filter((s: SessionSummary) => !s.pinned), filterStatus, filterDate),
    [independent, filterStatus, filterDate],
  );

  return (
    <aside className="sidebar">
      {/* macOS Overlay 标题栏:红绿灯悬浮在 logo 行左上,整行作为拖拽区
          (Windows 的窗口拖拽由自绘 TitleBar 负责,故仅在 mac 加属性)。 */}
      <div className="sidebar__logo-row" {...(IS_MACOS ? { "data-window-drag-region": true } : {})}>
        <div className="sidebar__logo-col" {...(IS_MACOS ? { "data-window-drag-region": true } : {})}>
          <span className="sidebar__logo">
            <img className="sidebar__logo-mark" src={logoMarkUrl} alt="" width={18} height={18} />
            OpenBuddy
          </span>
          <span className="sidebar__version">v{APP_VERSION}</span>
        </div>
        {/* WorkBuddy 顶栏：品牌块右侧是当前应用切换器（同一行）。 */}
        <AppSwitcher cwd={homeCwd} onToast={onToast} />
        <div className="sidebar__logo-spacer" {...(IS_MACOS ? { "data-window-drag-region": true } : {})} />
        <button
          className="sidebar__icon-btn"
          aria-label="收起侧边栏"
          data-tip="收起侧边栏"
          onClick={onToggleCollapse}
        >
          <SidebarToggleIcon size="md" />
        </button>
        <button className="sidebar__icon-btn" aria-label={t("sidebar.searchTasks")} data-tip={`${t("sidebar.searchTasks")} (${keyLabel("Mod")}+K)`} onClick={onOpenSearch}>
          <SearchIcon size="md" />
        </button>
        <button
          className={"sidebar__icon-btn" + (selectionMode ? " sidebar__icon-btn--active" : "")}
          aria-label={selectionMode ? "退出批量选择" : "批量选择任务"}
          aria-pressed={selectionMode}
          data-tip={selectionMode ? "退出批量选择" : "批量选择"}
          onClick={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
        >
          <ListChecks size={16} />
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

      <nav className="sidebar__nav">
        <button
          className={
            "sidebar__nav-item" +
            (activeNav === "新建任务" ? " sidebar__nav-item--active" : "")
          }
          onClick={onNewSession}
        >
          <WbNewTaskIcon size="md" />
          <span>{t("nav.newTask")}</span>
        </button>
        {nav.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            data-feature={id}
            className={
              "sidebar__nav-item" +
              (activeNav === label ? " sidebar__nav-item--active" : "")
            }
            onClick={() => onNavigate(label)}
          >
            <Icon size="md" />
            <span>{navLabel(label)}</span>
          </button>
        ))}
        {moreItems.length > 0 && <MoreDropdown items={moreItems} onNavigate={onNavigate} activeNav={activeNav} />}
      </nav>

      {/* 运行中 (pii W4.5): automation / 子代理 / 命令 / 普通回合，含用时与待确认数。 */}
      <TasksPanel />

      {pinnedSessions.length > 0 && (
        <div className="sidebar__pinned-section">
          <button
            className="sidebar__section-label"
            aria-expanded={pinnedOpen}
            onClick={() => useSessionsStore.getState().setPinnedOpen(!pinnedOpen)}
          >
            <span>{t("sidebar.pinned")} ({hasFilter ? `${pinnedSessions.length}/${allSessions.filter((s) => s.pinned).length}` : pinnedSessions.length})</span>
            <ChevronDownIcon
              size="sm"
              className={"sidebar__chevron" + (pinnedOpen ? "" : " sidebar__chevron--collapsed")}
            />
          </button>
          {pinnedOpen && (
            <div className="sidebar__children">{pinnedSessions.map(renderConv)}</div>
          )}
        </div>
      )}

      <div className="sidebar__content">
        {/* 任务分组: 收件箱(初始目录)下的会话（WorkBuddy 文案：最近） */}
        <button className="sidebar__section-label" onClick={() => setTasksOpen(!tasksOpen)}>
          <span>{t("sidebar.recent")} ({hasFilter ? `${filteredIndependent.length}/${independent.length}` : independent.length})</span>
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
            {sortPinnedFirst(filteredIndependent)
              .slice(0, recentShowAll ? undefined : RECENT_COLLAPSED)
              .map(renderConv)}
            {!recentShowAll && filteredIndependent.length > RECENT_COLLAPSED && (
              <button
                type="button"
                className="sidebar__see-more"
                onClick={() => setRecentShowAll(true)}
              >
                查看更多 ({filteredIndependent.length})
              </button>
            )}
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
            {/* 项目节点 */}
            {projects.length === 0 && spaceNodes.length === 0 && (
              <div className="sidebar__empty">暂无空间</div>
            )}
            {sortedProjects.map((proj) => {
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
                          key={conv.sessionId}
                          className={
                            "sidebar__conv" +
                            (conv.sessionId === currentSessionId ? " sidebar__conv--active" : "")
                          }
                          onClick={() => onSelect(conv.sessionId, proj.cwd)}
                          title={conv.title}
                        >
                          <span className="sidebar__conv-title">{conv.title}</span>
                          <span className="sidebar__conv-time">{relativeTime(conv.createdAt, locale)}</span>
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
                <div key={ws.cwd} className="sidebar__node-wrap">
                  <button
                    className="sidebar__node"
                    onClick={() => onToggleWorkspace(ws.cwd, !open)}
                    title={ws.cwd}
                  >
                    <WbExpertNavIcon size="sm" />
                    <span className="sidebar__node-name">{basename(ws.cwd)}</span>
                    <ChevronDownIcon
                      size="sm"
                      className={"sidebar__chevron" + (open ? "" : " sidebar__chevron--collapsed")}
                    />
                  </button>
                  {open && (
                    <div className="sidebar__children">
                      {children === undefined && <div className="sidebar__empty">加载中…</div>}
                      {children && children.filter((s: SessionSummary) => !s.pinned).length === 0 && <div className="sidebar__empty">暂无会话</div>}
                      {children && sortPinnedFirst(children.filter((s: SessionSummary) => !s.pinned)).map(renderConv)}
                     </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectionMode && (
        <div className="sidebar-bulk" role="region" aria-label="批量操作">
          <span className="sidebar-bulk__count">已选 {selected.size} 项</span>
          <button type="button" className="sidebar-bulk__btn" disabled={!selected.size || bulkBusy} onClick={() => void handleBulkArchive()}>归档</button>
          <button type="button" className="sidebar-bulk__btn sidebar-bulk__btn--danger" disabled={!selected.size || bulkBusy} onClick={() => void handleBulkDelete()}>删除</button>
          <button type="button" className="sidebar-bulk__btn" onClick={exitSelection}>取消</button>
        </div>
      )}

      <div className="sidebar__footer">
        <button className="sidebar__user" onClick={() => onPlaceholder("用户中心")}>
          <UserIcon size="md" />
          <span>本地用户</span>
        </button>
        <div className="sidebar__logo-spacer" />
        <button className="sidebar__icon-btn" aria-label={t("sidebar.notifications")} onClick={() => onOpenSettings()}>
          <BellIcon size="md" />
        </button>
        <button className="sidebar__icon-btn" aria-label={t("sidebar.settings")} onClick={onOpenSettings}>
          <SettingsIcon size="md" />
        </button>
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
  );
}
