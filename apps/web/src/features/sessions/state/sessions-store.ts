import { create } from "zustand";

const DRAFTS_KEY = "openbuddy.drafts";
const SIDEBAR_LAYOUT_KEY = "openbuddy.sidebar-layout.v1";
const MAX_EXPANDED_WORKSPACES = 100;
import type { SessionSummary, SessionStatus } from "@openbuddy/protocol/dto";
import type { WorkspaceInfo } from "@openbuddy/client/agent-client";

/**
 * Sentinel draft keys for sessions that don't have a real sessionId yet.
 * Used when the user is typing on HomePage ("新建任务") or LocalAssistantView
 * before any session has been created. Kept here so callers don't hardcode
 * magic strings.
 */
export const HOME_DRAFT_KEY = "__home__";
export const ASSISTANT_DRAFT_KEY = "__assistant__";

/**
 * Sidebar fold state survives restarts (WorkBuddy parity, 20261119 §10.2.2).
 * Stored under a versioned key so a future layout change can migrate explicitly
 * instead of silently treating unknown shapes as user preferences.
 */
interface SidebarLayout {
  pinnedOpen: boolean;
  tasksOpen: boolean;
  spacesOpen: boolean;
  expanded: Record<string, boolean>;
}

const DEFAULT_SIDEBAR_LAYOUT: SidebarLayout = {
  pinnedOpen: true,
  tasksOpen: true,
  spacesOpen: true,
  expanded: {},
};

function readSidebarLayout(): SidebarLayout {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_SIDEBAR_LAYOUT, expanded: {} };
    const raw = localStorage.getItem(SIDEBAR_LAYOUT_KEY);
    if (!raw) return { ...DEFAULT_SIDEBAR_LAYOUT, expanded: {} };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_SIDEBAR_LAYOUT, expanded: {} };
    }
    const value = parsed as Record<string, unknown>;
    if (value.version !== 1) return { ...DEFAULT_SIDEBAR_LAYOUT, expanded: {} };
    const source = value.expanded;
    const expanded = source && typeof source === "object" && !Array.isArray(source)
      ? Object.fromEntries(
          Object.entries(source as Record<string, unknown>)
            .filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")
            .slice(-MAX_EXPANDED_WORKSPACES)
        )
      : {};
    return {
      pinnedOpen: typeof value.pinnedOpen === "boolean" ? value.pinnedOpen : true,
      tasksOpen: typeof value.tasksOpen === "boolean" ? value.tasksOpen : true,
      spacesOpen: typeof value.spacesOpen === "boolean" ? value.spacesOpen : true,
      expanded,
    };
  } catch {
    return { ...DEFAULT_SIDEBAR_LAYOUT, expanded: {} };
  }
}

function writeSidebarLayout(layout: SidebarLayout): void {
  try {
    if (typeof localStorage === "undefined") return;
    const entries = Object.entries(layout.expanded).slice(-MAX_EXPANDED_WORKSPACES);
    localStorage.setItem(
      SIDEBAR_LAYOUT_KEY,
      JSON.stringify({ version: 1, pinnedOpen: layout.pinnedOpen, tasksOpen: layout.tasksOpen, spacesOpen: layout.spacesOpen, expanded: Object.fromEntries(entries) })
    );
  } catch { /* quota / private mode: fold state is a convenience, never a blocker */ }
}

/** Testable hook for the versioned on-disk shape (no store side effects). */
export function parseSidebarLayout(raw: string | null): SidebarLayout {
  if (raw === null) return { ...DEFAULT_SIDEBAR_LAYOUT, expanded: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid layout");
    const value = parsed as Record<string, unknown>;
    if (value.version !== 1) throw new Error("unsupported version");
    const source = value.expanded;
    return {
      pinnedOpen: typeof value.pinnedOpen === "boolean" ? value.pinnedOpen : true,
      tasksOpen: typeof value.tasksOpen === "boolean" ? value.tasksOpen : true,
      spacesOpen: typeof value.spacesOpen === "boolean" ? value.spacesOpen : true,
      expanded: source && typeof source === "object" && !Array.isArray(source)
        ? Object.fromEntries(
            Object.entries(source as Record<string, unknown>)
              .filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")
              .slice(-MAX_EXPANDED_WORKSPACES)
          )
        : {},
    };
  } catch {
    return { ...DEFAULT_SIDEBAR_LAYOUT, expanded: {} };
  }
}

/**
 * Sidebar session list — WorkBuddy-style two-section model.
 *
 * The sidebar no longer shows a single cwd's sessions flat under one "默认空间".
 * Instead it renders two collapsible groups:
 *
 *   任务 (N)  — `independent`: sessions with an empty cwd (playground / 独立任务).
 *               Sourced from `agentListSessions("")`, which the Rust backend
 *               already filters to cwd-less sessions (sessions.rs:111).
 *   空间 (M)  — `workspaces`: one expandable node per local working directory
 *               (sourced from `agentListWorkspaces()`). Expanding a node lazily
 *               loads that cwd's sessions into `workspaceSessions[cwd]`.
 *
 * Kept separate from the active-session transcript store so switching sessions
 * doesn't thrash the list, and each group can refresh independently.
 */
interface SessionsState {
  /** 任务分组: cwd-less (independent) sessions. */
  independent: SessionSummary[];
  
  workspaces: WorkspaceInfo[];
  /** 空间节点展开后的子会话缓存, keyed by cwd. Absent key = not yet loaded. */
  workspaceSessions: Record<string, SessionSummary[]>;
  /** 置顶分组 collapsed? (default expanded). */
  pinnedOpen: boolean;
  /** 任务分组 collapsed? (default expanded). */
  tasksOpen: boolean;
  /** 空间分组 collapsed? (default expanded). */
  spacesOpen: boolean;
  /** Per-cwd expand state for 空间 nodes. */
  expanded: Record<string, boolean>;
  
  homeCwd: string;
  currentSessionId: string | null;
  loading: boolean;
  error: string | null;
  /** Search query for the session search overlay (empty = no filter). */
  query: string;
  /** Sidebar task filter: selected status (null = 全部状态). */
  filterStatus: SessionStatus | null;
  /** Sidebar task filter: selected date range (null = 全部时间). */
  filterDate: string | null;
  
  drafts: Record<string, string>;

  setIndependent: (list: SessionSummary[]) => void;
  setWorkspaces: (list: WorkspaceInfo[]) => void;
  setWorkspaceSessions: (cwd: string, list: SessionSummary[]) => void;
  setPinnedOpen: (b: boolean) => void;
  setTasksOpen: (b: boolean) => void;
  setSpacesOpen: (b: boolean) => void;
  setExpanded: (cwd: string, b: boolean) => void;
  setHomeCwd: (cwd: string) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  setCurrent: (id: string | null) => void;
  setQuery: (q: string) => void;
  setFilterStatus: (s: SessionStatus | null) => void;
  setFilterDate: (d: string | null) => void;
  clearFilters: () => void;
  /** Save the draft for one session id. Empty string deletes the entry so
   *  the map stays tidy and `drafts[id] ?? ""` always reflects truth. */
  setDraft: (id: string, text: string) => void;
  /** Drop the draft for one session id (no-op if absent). */
  clearDraft: (id: string) => void;
  /** Insert or merge a session entry, routing it into the correct group by
   *  cwd. On update (id already present) the entry is merged in place wherever
   *  it lives, so a cwd-less `{ sessionId, title }` (e.g. agent://summary)
   *  updates the right group without needing the cwd. */
  upsert: (s: Partial<SessionSummary> & { sessionId: string }) => void;
  /** Sidebar title of a session in any group. */
  titleOf: (sessionId: string) => string | undefined;
  /** Remove a session from every group and decrement its workspace node count. */
  remove: (id: string) => void;
}

/** Returns true when any sidebar task filter is active. */
export function selectHasFilter(s: { filterStatus: SessionStatus | null; filterDate: string | null }): boolean {
  return s.filterStatus !== null || s.filterDate !== null;
}

const initialLayout = readSidebarLayout();

export const useSessionsStore = create<SessionsState>((set, get) => ({
  independent: [],
  workspaces: [],
  workspaceSessions: {},
  pinnedOpen: initialLayout.pinnedOpen,
  tasksOpen: initialLayout.tasksOpen,
  spacesOpen: initialLayout.spacesOpen,
  expanded: initialLayout.expanded,
  homeCwd: "",
  currentSessionId: null,
  loading: false,
  error: null,
  query: "",
  filterStatus: null,
  filterDate: null,
  drafts: loadDrafts(),

  setIndependent: (independent) => set({ independent }),
  setWorkspaces: (workspaces) => set({ workspaces }),
  setWorkspaceSessions: (cwd, list) =>
    set((state) => ({
      workspaceSessions: { ...state.workspaceSessions, [cwd]: list },
    })),
  setPinnedOpen: (pinnedOpen) => {
    set({ pinnedOpen });
    const s = get();
    writeSidebarLayout({ pinnedOpen, tasksOpen: s.tasksOpen, spacesOpen: s.spacesOpen, expanded: s.expanded });
  },
  setTasksOpen: (tasksOpen) => {
    set({ tasksOpen });
    const s = get();
    writeSidebarLayout({ pinnedOpen: s.pinnedOpen, tasksOpen, spacesOpen: s.spacesOpen, expanded: s.expanded });
  },
  setSpacesOpen: (spacesOpen) => {
    set({ spacesOpen });
    const s = get();
    writeSidebarLayout({ pinnedOpen: s.pinnedOpen, tasksOpen: s.tasksOpen, spacesOpen, expanded: s.expanded });
  },
  setExpanded: (cwd, b) => {
    const next = { ...get().expanded, [cwd]: b };
    const entries = Object.entries(next).slice(-MAX_EXPANDED_WORKSPACES);
    const expanded = Object.fromEntries(entries);
    set({ expanded });
    const s = get();
    writeSidebarLayout({ pinnedOpen: s.pinnedOpen, tasksOpen: s.tasksOpen, spacesOpen: s.spacesOpen, expanded });
  },
  setHomeCwd: (homeCwd) => set({ homeCwd }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setCurrent: (id) => set({ currentSessionId: id }),
  titleOf: (sessionId) => {
    const state = get();
    return (state.independent.find((x) => x.sessionId === sessionId)
      ?? Object.values(state.workspaceSessions).flat().find((x) => x.sessionId === sessionId))?.title;
  },
  setQuery: (query) => set({ query }),
  setFilterStatus: (filterStatus) => set({ filterStatus }),
  setFilterDate: (filterDate) => set({ filterDate }),
  clearFilters: () => set({ filterStatus: null, filterDate: null }),
  setDraft: (id, text) =>
    set((state) => {
      // Avoid a new object reference when nothing changes (no text + absent).
      if (text === "") {
        if (!Object.prototype.hasOwnProperty.call(state.drafts, id)) return {};
        const next = { ...state.drafts };
        delete next[id];
        return { drafts: next };
      }
      if (state.drafts[id] === text) return {};
      return { drafts: { ...state.drafts, [id]: text } };
    }),
  clearDraft: (id) =>
    set((state) => {
      if (!Object.prototype.hasOwnProperty.call(state.drafts, id)) return {};
      const next = { ...state.drafts };
      delete next[id];
      return { drafts: next };
    }),

  upsert: (s) =>
    set((state) => {
      const id = s.sessionId;

      // 1) Update in place if it already lives in the 任务 group.
      const iIdx = state.independent.findIndex((x) => x.sessionId === id);
      if (iIdx !== -1) {
        const independent = [...state.independent];
        independent[iIdx] = { ...independent[iIdx], ...s };
        return { independent };
      }

      // 2) Update in place if it already lives in some 空间 node's cache.
      for (const cwd of Object.keys(state.workspaceSessions)) {
        const list = state.workspaceSessions[cwd];
        const wIdx = list.findIndex((x) => x.sessionId === id);
        if (wIdx !== -1) {
          const next = [...list];
          next[wIdx] = { ...next[wIdx], ...s };
          return { workspaceSessions: { ...state.workspaceSessions, [cwd]: next } };
        }
      }

      // 3) New entry — route by cwd. The 任务 group is the "inbox" = the cwd
      // an absolute path. A session whose cwd equals homeCwd (or, defensively,
      // an empty cwd) is independent; everything else belongs to a 空间 node.
      // A status-only update for a session the sidebar has never seen must not create a row:
      // 子代理 (W3.4) children and other side-channel sessions emit status without a title or cwd.
      if (!s.title && !s.cwd) return {};
      const cwd = s.cwd ?? "";
      const isInbox = !cwd || cwd === state.homeCwd;
      if (isInbox) {
        const inserted: SessionSummary = {
          title: "未命名会话",
          cwd: state.homeCwd,
          ...s,
          // Fresh sessions must carry a timestamp so the sidebar's
          // recently-active sort pins them to the top instead of sinking.
          updatedAt: s.updatedAt ?? new Date().toISOString(),
        };
        return { independent: [inserted, ...state.independent] };
      }

      // Non-empty cwd ⇒ belongs to a 空间 node. Only insert if that node's
      // cache is loaded (expanded); otherwise the node's sessionCount carries
      // the truth until the user expands it (or a refresh repopulates it).
      if (Object.prototype.hasOwnProperty.call(state.workspaceSessions, cwd)) {
        const inserted: SessionSummary = {
          title: "未命名会话",
          cwd,
          ...s,
          updatedAt: s.updatedAt ?? new Date().toISOString(),
        };
        return {
          workspaceSessions: {
            ...state.workspaceSessions,
            [cwd]: [inserted, ...state.workspaceSessions[cwd]],
          },
        };
      }

      // Node not expanded — nothing to insert into right now.
      return {};
    }),

  remove: (id) =>
    set((state) => {
      const independent = state.independent.filter((x) => x.sessionId !== id);

      // Drop from any 空间 node cache that holds it, remembering which cwd
      // lost a session so we can keep that node's count in sync.
      let removedCwd: string | null = null;
      const workspaceSessions: Record<string, SessionSummary[]> = {};
      for (const cwd of Object.keys(state.workspaceSessions)) {
        const list = state.workspaceSessions[cwd];
        const next = list.filter((x) => x.sessionId !== id);
        workspaceSessions[cwd] = next;
        if (next.length !== list.length) removedCwd = cwd;
      }

      // Optimistically decrement the affected node's count (floored at 0).
      // A subsequent refresh corrects this against the on-disk truth.
      const workspaces =
        removedCwd == null
          ? state.workspaces
          : state.workspaces.map((w) =>
              w.cwd === removedCwd
                ? { ...w, sessionCount: Math.max(0, w.sessionCount - 1) }
                : w,
            );

      // Drop the deleted session's draft too, so the map doesn't grow forever.
      let drafts = state.drafts;
      if (Object.prototype.hasOwnProperty.call(state.drafts, id)) {
        drafts = { ...state.drafts };
        delete drafts[id];
      }

      return {
        independent,
        workspaceSessions,
        workspaces,
        drafts,
        currentSessionId:
          state.currentSessionId === id ? null : state.currentSessionId,
      };
    }),
}));

/** Unsent drafts survive restarts (20261115-ui U4.8); written at most every 400ms. */
function loadDrafts(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string" && !!e[1]));
  } catch {
    return {};
  }
}
let draftTimer: ReturnType<typeof setTimeout> | undefined;
if (typeof window !== "undefined") {
  useSessionsStore.subscribe((state, prev) => {
    if (state.drafts === prev.drafts) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        const entries = Object.entries(useSessionsStore.getState().drafts).slice(-50);
        localStorage.setItem(DRAFTS_KEY, JSON.stringify(Object.fromEntries(entries)));
      } catch { /* quota / private mode */ }
    }, 400);
  });

  // Multiple desktop windows share one profile but own separate localStorage
  // replicas. Mirror another window's fold changes into this store so the
  // sidebar does not jump back when the user switches windows.
  window.addEventListener("storage", (event) => {
    if (event.key !== SIDEBAR_LAYOUT_KEY) return;
    useSessionsStore.setState(readSidebarLayout());
  });
}
