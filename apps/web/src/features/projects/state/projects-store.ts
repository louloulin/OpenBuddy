import { create } from "zustand";
import { projectsDelete, projectsImport, projectsSave, projectsSnapshot } from "@openbuddy/client/agent-client";
import type { ProjectRecord } from "@openbuddy/protocol/projects";

/**
 * 本地「项目」实体存储 — 对齐 WorkBuddy 项目列表 + 项目详情页的产品语义。
 *
 * W5.4：项目元数据与详情（指令/连接器/专家/技能/看板/任务/资产/成员）现在由宿主持久化到
 * `projects.json`；localStorage 只作为首屏缓存与宿主不可用（浏览器预览）时的降级。
 * 首次启动把旧缓存幂等导入宿主（按 id upsert），之后每次变更都同步一份给宿主。
 * 项目 `instructions` 由引擎追加到该 cwd 下新会话的系统提示词（`session-pool.ts`）。
 */

export interface RefItem {
  id: string;
  name: string;
  iconUrl?: string;
}


export interface ProjectConversation {
  sessionId: string;
  title: string;
  createdAt: string;
}

export type PlanStatus = "pending" | "in_progress" | "paused" | "completed";

export interface PlanCard {
  id: string;
  title: string;
  status: PlanStatus;
  source?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  scope: "personal" | "shared";
  source: string;
  status: PlanStatus;
}

export interface AssetItem {
  id: string;
  name: string;
  kind: "folder" | "file";
  ext?: string;
  sizeLabel?: string;
  updater?: string;
  updatedAt?: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  cwd?: string;
  templateId?: string;
  instructions?: string;
  createdAt: string;
  /** 置顶 (U1): pinned projects sort first in the list and the sidebar picker. */
  pinned?: boolean;
  // 详情
  connectors: RefItem[];
  experts: RefItem[];
  skills: RefItem[];
  plans: PlanCard[];
  tasks: TaskItem[];
  assets: AssetItem[];
  members: string[];
  
  conversations: ProjectConversation[];
}

/** 计划看板列定义（对齐目标截图：待开始/进行中/暂停/完成）。 */
export const PLAN_COLUMNS: { status: PlanStatus; label: string }[] = [
  { status: "pending", label: "待开始" },
  { status: "in_progress", label: "进行中" },
  { status: "paused", label: "暂停" },
  { status: "completed", label: "完成" },
];

const STORAGE_KEY = "openbuddy.projects";

/** 旧数据/外部数据补齐缺省详情字段，保证组件可直接读数组。 */
function normalize(x: unknown): ProjectMeta | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Partial<ProjectMeta> & { id?: unknown; name?: unknown };
  if (typeof o.id !== "string" || typeof o.name !== "string") return null;
  return {
    id: o.id,
    name: o.name,
    cwd: o.cwd,
    templateId: o.templateId,
    instructions: o.instructions,
    createdAt: o.createdAt ?? new Date().toISOString(),
    ...(o.pinned === true ? { pinned: true } : {}),
    connectors: Array.isArray(o.connectors) ? o.connectors : [],
    experts: Array.isArray(o.experts) ? o.experts : [],
    skills: Array.isArray(o.skills) ? o.skills : [],
    plans: Array.isArray(o.plans) ? o.plans : [],
    tasks: Array.isArray(o.tasks) ? o.tasks : [],
    assets: Array.isArray(o.assets) ? o.assets : [],
    members: Array.isArray(o.members) ? o.members : [],
    conversations: Array.isArray(o.conversations) ? o.conversations : [],
  };
}

function load(): ProjectMeta[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(normalize).filter(Boolean) as ProjectMeta[] : [];
  } catch {
    return [];
  }
}

function save(list: ProjectMeta[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota / 隐私模式 — 静默降级为仅内存 */
  }
}

const asRecord = (project: ProjectMeta) => project as unknown as ProjectRecord;
const mirror = (task: Promise<unknown>) => { void task.catch(() => { /* 浏览器 / 宿主不可用：localStorage 仍是权威 */ }); };

/**
 * 宿主为权威、localStorage 为缓存：宿主有数据就覆盖缓存；宿主为空就把旧缓存一次性导入。
 * 幂等：导入按 id upsert，重复执行不会产生重复项目。
 */
export async function hydrateProjects(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const snapshot = await projectsSnapshot();
    const hostProjects = Array.isArray(snapshot?.projects) ? (snapshot.projects as unknown as ProjectMeta[]) : [];
    if (hostProjects.length) {
      useProjectsStore.setState({ projects: hostProjects });
      save(hostProjects);
      return;
    }
    const local = load();
    if (!local.length) return;
    const imported = await projectsImport(local.map(asRecord));
    const merged = Array.isArray(imported?.projects) ? (imported.projects as unknown as ProjectMeta[]) : local;
    useProjectsStore.setState({ projects: merged });
    save(merged);
  } catch {
    /* renderer without a host bridge keeps the localStorage cache */
  }
}

const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

interface ProjectsState {
  projects: ProjectMeta[];
  /** Sidebar → ProjectsPanel communication: when set, the panel auto-opens this project. */
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
  add: (p: {
    name: string;
    cwd?: string;
    templateId?: string;
    instructions?: string;
    connectors?: RefItem[];
    experts?: RefItem[];
    skills?: RefItem[];
  }) => ProjectMeta;
  rename: (id: string, name: string) => void;
  setPinned: (id: string, pinned: boolean) => void;
  remove: (id: string) => void;
  updateConfig: (
    id: string,
    patch: Partial<Pick<ProjectMeta, "instructions" | "connectors" | "experts" | "skills">>,
  ) => void;
  addPlan: (id: string, title: string, status?: PlanStatus) => void;
  movePlan: (id: string, cardId: string, status: PlanStatus) => void;
  removePlan: (id: string, cardId: string) => void;
  addTask: (id: string, title: string) => void;
  removeTask: (id: string, taskId: string) => void;
  addAsset: (id: string, a: Pick<AssetItem, "name" | "kind"> & Partial<AssetItem>) => void;
  removeAsset: (id: string, assetId: string) => void;
  addMember: (id: string, name: string) => void;
  addConversation: (id: string, conv: ProjectConversation) => void;
  removeConversation: (id: string, sessionId: string) => void;
  updateConversationTitle: (id: string, sessionId: string, title: string) => void;
}

export const useProjectsStore = create<ProjectsState>((set, get) => {
  const patch = (id: string, fn: (p: ProjectMeta) => ProjectMeta) => {
    const next = get().projects.map((p) => (p.id === id ? fn(p) : p));
    set({ projects: next });
    save(next);
    const updated = next.find((p) => p.id === id);
    if (updated) mirror(projectsSave(asRecord(updated)));
  };
  return {
    projects: load(),
    activeProjectId: null,
    setActiveProjectId: (id) => set({ activeProjectId: id }),
    add: (p) => {
      const item: ProjectMeta = {
        id: uid("proj"),
        name: p.name,
        cwd: p.cwd || undefined,
        templateId: p.templateId || undefined,
        instructions: p.instructions || undefined,
        createdAt: new Date().toISOString(),
        connectors: p.connectors ?? [],
        experts: p.experts ?? [],
        skills: p.skills ?? [],
        plans: [],
        tasks: [],
        assets: [],
        members: [],
        conversations: [],
      };
      const next = [item, ...get().projects];
      set({ projects: next });
      save(next);
      mirror(projectsSave(asRecord(item)));
      return item;
    },
    rename: (id, name) => patch(id, (p) => ({ ...p, name })),
    setPinned: (id, pinned) => patch(id, (p) => ({ ...p, pinned })),
    remove: (id) => {
      const next = get().projects.filter((p) => p.id !== id);
      set({ projects: next });
      save(next);
      mirror(projectsDelete(id));
    },
    updateConfig: (id, cfg) => patch(id, (p) => ({ ...p, ...cfg })),
    addPlan: (id, title, status = "pending") =>
      patch(id, (p) => ({ ...p, plans: [...p.plans, { id: uid("plan"), title, status }] })),
    movePlan: (id, cardId, status) =>
      patch(id, (p) => ({
        ...p,
        plans: p.plans.map((c) => (c.id === cardId ? { ...c, status } : c)),
      })),
    removePlan: (id, cardId) =>
      patch(id, (p) => ({ ...p, plans: p.plans.filter((c) => c.id !== cardId) })),
    addTask: (id, title) =>
      patch(id, (p) => ({
        ...p,
        tasks: [
          ...p.tasks,
          { id: uid("task"), title, scope: "personal", source: "manual", status: "pending" },
        ],
      })),
    removeTask: (id, taskId) =>
      patch(id, (p) => ({ ...p, tasks: p.tasks.filter((t) => t.id !== taskId) })),
    addAsset: (id, a) =>
      patch(id, (p) => ({
        ...p,
        assets: [
          ...p.assets,
          {
            id: uid("asset"),
            name: a.name,
            kind: a.kind,
            ext: a.ext,
            sizeLabel: a.sizeLabel,
            updater: a.updater ?? "-",
            updatedAt: a.updatedAt ?? new Date().toISOString(),
          },
        ],
      })),
    removeAsset: (id, assetId) =>
      patch(id, (p) => ({ ...p, assets: p.assets.filter((a) => a.id !== assetId) })),
    addMember: (id, name) =>
      patch(id, (p) =>
        p.members.includes(name) ? p : { ...p, members: [...p.members, name] },
      ),
    addConversation: (id, conv) =>
      patch(id, (p) => ({
        ...p,
        conversations: [conv, ...p.conversations],
      })),
    removeConversation: (id, sessionId) =>
      patch(id, (p) => ({
        ...p,
        conversations: p.conversations.filter((c) => c.sessionId !== sessionId),
      })),
    updateConversationTitle: (id, sessionId, title) =>
      patch(id, (p) => ({
        ...p,
        conversations: p.conversations.map((c) =>
          c.sessionId === sessionId ? { ...c, title } : c,
        ),
      })),
  };
});

// 首屏后台对齐宿主（旧 localStorage 一次性导入），失败时静默保留本地缓存。
void hydrateProjects();
