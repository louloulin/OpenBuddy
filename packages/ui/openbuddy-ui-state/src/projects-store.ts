import { create } from "zustand";
import type { CasdoorResourceRecord } from "@openbuddy/auth-casdoor";
import type { BuddyExecutionRef } from "@openbuddy/collaboration-protocol";

/**
 * 本地「项目」实体存储 — 对齐 WorkBuddy 项目列表 + 项目详情页的产品语义，落地为纯前端持久化。
 *
 * WorkBuddy 的项目/计划/任务/资产/成员/配置全由云端 facade 驱动；OpenBuddy 没有该后端，
 * 故这里把项目元数据 + 详情页内部数据（指令/连接器/专家/技能/看板/任务/资产/成员）
 * 一并存进 localStorage，使详情页的本地交互（增删改、看板流转）可跨刷新保留。
 */

export interface RefItem {
  id: string;
  name: string;
  iconUrl?: string;
}

/** 项目下的真实对话（pi 会话）。 */
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
  owner?: "personal" | "shared";
  /** OpenBuddy 工作区标签；不映射为邮箱厂商原生 Label。 */
  tags?: string[];
}

export interface TaskItem {
  id: string;
  title: string;
  scope: "personal" | "shared";
  source: string;
  status: PlanStatus;
  collaborationTaskId?: string;
  executionRef?: BuddyExecutionRef;
  /** OpenBuddy 工作区标签；邮件关联只保存引用，不复制正文。 */
  tags?: string[];
}

export type WorkspaceTagEntityType = "email-thread" | "project" | "project-plan" | "project-task" | "collaboration-inbox" | "knowledge-document";

export interface WorkspaceTagRef {
  entityType: WorkspaceTagEntityType;
  entityId: string;
  projectId?: string;
  accountId?: string;
  threadId?: string;
  tags: string[];
  updatedAt: string;
}

export interface WorkspaceTagEmailProjection {
  accountId: string;
  threadId: string;
  projectId?: string;
  tags?: string[];
  updatedAt?: string;
}

export interface AssetItem {
  id: string;
  name: string;
  kind: "folder" | "file";
  ext?: string;
  sizeLabel?: string;
  sizeBytes?: number;
  updater?: string;
  updatedAt?: string;
  path?: string;
}

export interface ProjectDataSource {
  id: string;
  path: string;
  label: string;
  addedAt: string;
}

export interface ProjectActivity {
  id: string;
  kind: "project" | "plan" | "task" | "asset" | "member" | "config" | "conversation";
  text: string;
  createdAt: string;
  actor: "我";
}

export interface ProjectMeta {
  id: string;
  /** Optional main-process protected resource binding for an enterprise project. */
  enterpriseResourceId?: string;
  enterpriseVersion?: number;
  tenantId?: string;
  name: string;
  cwd?: string;
  templateId?: string;
  instructions?: string;
  createdAt: string;
  /** 跨项目/邮件/任务搜索使用的本地工作区标签。 */
  tags?: string[];
  // 详情
  connectors: RefItem[];
  experts: RefItem[];
  skills: RefItem[];
  plans: PlanCard[];
  tasks: TaskItem[];
  assets: AssetItem[];
  dataSources: ProjectDataSource[];
  members: string[];
  activities: ProjectActivity[];
  /** 项目下的真实对话（pi 会话列表），按创建时间倒序。 */
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

function normalizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const tags = value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return tags.length ? tags : undefined;
}

function normalizePlan(value: unknown): PlanCard | null {
  if (!value || typeof value !== "object") return null;
  const plan = value as Partial<PlanCard>;
  if (typeof plan.id !== "string" || typeof plan.title !== "string") return null;
  return {
    id: plan.id,
    title: plan.title,
    status: plan.status ?? "pending",
    source: plan.source,
    owner: plan.owner,
    tags: normalizeTags(plan.tags),
  };
}

function normalizeTask(value: unknown): TaskItem | null {
  if (!value || typeof value !== "object") return null;
  const task = value as Partial<TaskItem>;
  if (typeof task.id !== "string" || typeof task.title !== "string") return null;
  return {
    id: task.id,
    title: task.title,
    scope: task.scope ?? "personal",
    source: task.source ?? "manual",
    status: task.status ?? "pending",
    collaborationTaskId: task.collaborationTaskId,
    executionRef: task.executionRef,
    tags: normalizeTags(task.tags),
  };
}

/** 旧数据/外部数据补齐缺省详情字段，保证组件可直接读数组。 */
function normalize(x: unknown): ProjectMeta | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Partial<ProjectMeta> & { id?: unknown; name?: unknown };
  if (typeof o.id !== "string" || typeof o.name !== "string") return null;
  return {
    id: o.id,
    enterpriseResourceId: typeof o.enterpriseResourceId === "string" ? o.enterpriseResourceId : undefined,
    enterpriseVersion: typeof o.enterpriseVersion === "number" ? o.enterpriseVersion : undefined,
    tenantId: typeof o.tenantId === "string" ? o.tenantId : undefined,
    name: o.name,
    cwd: o.cwd,
    templateId: o.templateId,
    instructions: o.instructions,
    createdAt: o.createdAt ?? new Date().toISOString(),
    tags: normalizeTags(o.tags),
    connectors: Array.isArray(o.connectors) ? o.connectors : [],
    experts: Array.isArray(o.experts) ? o.experts : [],
    skills: Array.isArray(o.skills) ? o.skills : [],
    plans: Array.isArray(o.plans) ? o.plans.map(normalizePlan).filter(Boolean) as PlanCard[] : [],
    tasks: Array.isArray(o.tasks) ? o.tasks.map(normalizeTask).filter(Boolean) as TaskItem[] : [],
    assets: Array.isArray(o.assets) ? o.assets : [],
    dataSources: Array.isArray(o.dataSources) ? o.dataSources : [],
    members: Array.isArray(o.members) ? o.members : [],
    activities: Array.isArray(o.activities) ? o.activities : [],
    conversations: Array.isArray(o.conversations) ? o.conversations : [],
  };
}

function storageKey(scope: string): string {
  return `openbuddy.projects.${encodeURIComponent(scope)}`;
}

function load(scope: string): ProjectMeta[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(scope)) ?? (scope === "local" ? window.localStorage.getItem(STORAGE_KEY) : null);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(normalize).filter(Boolean) as ProjectMeta[] : [];
  } catch {
    return [];
  }
}

// P1-09: debounced localStorage persistence. The previous implementation
// called `localStorage.setItem` synchronously on every mutation (4 call
// sites: lines 327/363/370/409). For workflows like renaming a project
// or moving assets across kanban columns, that meant several fsyncs
// per user action — visibly janky on slow disks and contending with the
// renderer's main-thread animation budget.
//
// The 300ms window is short enough to feel synchronous for the user
// (no "wait for save" UX needed) and long enough to coalesce a
// drag/rename cascade into a single write.
//
// Flush triggers cover the cases where we MUST NOT lose data:
//   - page visibility change to hidden (user switches tabs / closes)
//   - window beforeunload (real close)
//   - a flush() helper exposed for explicit callers (e.g. IPC handlers
//     that need durability before replying)
const SAVE_DEBOUNCE_MS = 300;
const pendingWrites = new Map<string, ProjectMeta[]>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingWrites(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  for (const [scope, list] of pendingWrites) {
    writeNow(scope, list);
  }
  pendingWrites.clear();
}

function writeNow(scope: string, list: ProjectMeta[]): void {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(list);
    window.localStorage.setItem(storageKey(scope), serialized);
    if (scope === "local") {
      // 兼容旧的 STORAGE_KEY 读取路径,load() 仍然会优先尝试 storageKey(scope),这里只是 mirror 一份。
      window.localStorage.setItem(STORAGE_KEY, serialized);
    }
  } catch {
    /* quota / 隐私模式 — 静默降级为仅内存 */
  }
}

/** Test-only + explicit flush. Hides pending debounced writes synchronously. */
export function flushProjectsStoreWrites(): void {
  flushPendingWrites();
}

if (typeof window !== "undefined") {
  // 1) tab becomes hidden — flush so background tabs see the latest data
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPendingWrites();
  });
  // 2) real close — flush before the browser tears down the document
  window.addEventListener("beforeunload", () => flushPendingWrites());
}

function save(scope: string, list: ProjectMeta[]) {
  pendingWrites.set(scope, list);
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushPendingWrites, SAVE_DEBOUNCE_MS);
}

export function projectWorkspaceTagRefs(projects: ProjectMeta[], emailThreads: WorkspaceTagEmailProjection[] = []): WorkspaceTagRef[] {
  const refs: WorkspaceTagRef[] = [];
  for (const project of projects) {
    if (project.tags?.length) refs.push({ entityType: "project", entityId: project.id, tags: project.tags, updatedAt: project.createdAt });
    for (const plan of project.plans) {
      if (plan.tags?.length) refs.push({ entityType: "project-plan", entityId: plan.id, projectId: project.id, tags: plan.tags, updatedAt: project.createdAt });
    }
    for (const task of project.tasks) {
      if (task.tags?.length) refs.push({ entityType: "project-task", entityId: task.id, projectId: project.id, tags: task.tags, updatedAt: project.createdAt });
    }
  }
  for (const email of emailThreads) {
    const tags = normalizeTags(email.tags);
    if (tags?.length) {
      refs.push({
        entityType: "email-thread",
        entityId: `${email.accountId}:${email.threadId}`,
        accountId: email.accountId,
        threadId: email.threadId,
        ...(email.projectId ? { projectId: email.projectId } : {}),
        tags,
        updatedAt: email.updatedAt ?? new Date().toISOString(),
      });
    }
  }
  return refs;
}

const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const makeActivity = (kind: ProjectActivity["kind"], text: string): ProjectActivity => ({
  id: uid("activity"),
  kind,
  text,
  createdAt: new Date().toISOString(),
  actor: "我",
});

interface ProjectsState {
  projects: ProjectMeta[];
  scope: string;
  setScope: (scope: string) => void;
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
    enterpriseResourceId?: string;
    enterpriseVersion?: number;
    tenantId?: string;
    tags?: string[];
  }) => ProjectMeta;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  updateConfig: (
    id: string,
    patch: Partial<Pick<ProjectMeta, "instructions" | "connectors" | "experts" | "skills">>,
  ) => void;
  updateEnterpriseBinding: (id: string, enterpriseResourceId: string, enterpriseVersion: number) => void;
  replaceEnterpriseProjects: (resources: CasdoorResourceRecord[]) => void;
  updateProjectTags: (id: string, tags: string[]) => void;
  updatePlanTags: (projectId: string, planId: string, tags: string[]) => void;
  updateTaskTags: (projectId: string, taskId: string, tags: string[]) => void;
  addPlan: (id: string, title: string, status?: PlanStatus, options?: Pick<PlanCard, "source" | "owner" | "tags">) => void;
  movePlan: (id: string, cardId: string, status: PlanStatus) => void;
  removePlan: (id: string, cardId: string) => void;
  addTask: (id: string, title: string, options?: Partial<Pick<TaskItem, "scope" | "source" | "collaborationTaskId" | "executionRef" | "tags">>) => string;
  removeTask: (id: string, taskId: string) => void;
  addAsset: (id: string, a: Pick<AssetItem, "name" | "kind"> & Partial<AssetItem>) => void;
  removeAsset: (id: string, assetId: string) => void;
  addDataSource: (id: string, source: Omit<ProjectDataSource, "id" | "addedAt">) => void;
  removeDataSource: (id: string, sourceId: string) => void;
  addMember: (id: string, name: string) => void;
  addActivity: (id: string, activity: Pick<ProjectActivity, "kind" | "text">) => void;
  addConversation: (id: string, conv: ProjectConversation) => void;
  removeConversation: (id: string, sessionId: string) => void;
  updateConversationTitle: (id: string, sessionId: string, title: string) => void;
}

export const useProjectsStore = create<ProjectsState>((set, get) => {
  let scope = "local";
  const patch = (id: string, fn: (p: ProjectMeta) => ProjectMeta) => {
    const next = get().projects.map((p) => (p.id === id ? fn(p) : p));
    set({ projects: next });
    save(scope, next);
  };
  return {
    projects: load(scope),
    scope,
    setScope: (nextScope) => {
      scope = nextScope.trim() || "local";
      set({ scope, projects: load(scope), activeProjectId: null });
    },
    activeProjectId: null,
    setActiveProjectId: (id) => set({ activeProjectId: id }),
    add: (p) => {
      const item: ProjectMeta = {
        id: uid("proj"),
        enterpriseResourceId: p.enterpriseResourceId,
        enterpriseVersion: p.enterpriseVersion,
        tenantId: p.tenantId,
        name: p.name,
        cwd: p.cwd || undefined,
        templateId: p.templateId || undefined,
        instructions: p.instructions || undefined,
        createdAt: new Date().toISOString(),
        tags: normalizeTags(p.tags),
        connectors: p.connectors ?? [],
        experts: p.experts ?? [],
        skills: p.skills ?? [],
        plans: [],
        tasks: [],
        assets: [],
        dataSources: [],
        members: [],
        activities: [],
        conversations: [],
      };
      const next = [item, ...get().projects];
      set({ projects: next });
      save(scope, next);
      return item;
    },
    rename: (id, name) => patch(id, (p) => ({ ...p, name })),
    remove: (id) => {
      const next = get().projects.filter((p) => p.id !== id);
      set({ projects: next });
      save(scope, next);
    },
    updateEnterpriseBinding: (id, enterpriseResourceId, enterpriseVersion) => patch(id, (p) => ({ ...p, enterpriseResourceId, enterpriseVersion })),
    replaceEnterpriseProjects: (resources) => {
      const enterpriseProjects = resources.filter((resource) => resource.type === "project");
      const resourceIds = new Set(enterpriseProjects.map((resource) => resource.id));
      const existingByResourceId = new Map(
        get().projects
          .filter((project) => project.enterpriseResourceId)
          .map((project) => [project.enterpriseResourceId, project]),
      );
      const merged = get().projects.filter((project) => !project.enterpriseResourceId || resourceIds.has(project.enterpriseResourceId));
      for (const resource of enterpriseProjects) {
        const existing = existingByResourceId.get(resource.id);
        if (existing) {
          const index = merged.findIndex((project) => project.id === existing.id);
          if (index >= 0) merged[index] = { ...existing, name: resource.name, enterpriseVersion: resource.version, tenantId: resource.tenantId };
          continue;
        }
        merged.unshift({
          id: `enterprise:${resource.id}`,
          enterpriseResourceId: resource.id,
          enterpriseVersion: resource.version,
          tenantId: resource.tenantId,
          name: resource.name,
          createdAt: resource.createdAt,
          connectors: [],
          experts: [],
          skills: [],
          plans: [],
          tasks: [],
          assets: [],
          dataSources: [],
          members: [],
          activities: [],
          conversations: [],
        });
      }
      set({ projects: merged });
      save(scope, merged);
    },
    updateConfig: (id, cfg) => patch(id, (p) => ({
      ...p,
      ...cfg,
      activities: [makeActivity("config", "更新了项目配置"), ...p.activities].slice(0, 100),
    })),
    updateProjectTags: (id, tags) => patch(id, (p) => ({
      ...p,
      tags: normalizeTags(tags),
      activities: [makeActivity("config", "更新了项目标签"), ...p.activities].slice(0, 100),
    })),
    updatePlanTags: (projectId, planId, tags) => patch(projectId, (p) => ({
      ...p,
      plans: p.plans.map((plan) => (plan.id === planId ? { ...plan, tags: normalizeTags(tags) } : plan)),
      activities: [makeActivity("plan", "更新了计划标签"), ...p.activities].slice(0, 100),
    })),
    updateTaskTags: (projectId, taskId, tags) => patch(projectId, (p) => ({
      ...p,
      tasks: p.tasks.map((task) => (task.id === taskId ? { ...task, tags: normalizeTags(tags) } : task)),
      activities: [makeActivity("task", "更新了任务标签"), ...p.activities].slice(0, 100),
    })),
    addPlan: (id, title, status = "pending", options) =>
      patch(id, (p) => ({
        ...p,
        plans: [...p.plans, { id: uid("plan"), title, status, source: options?.source ?? "manual", owner: options?.owner ?? "personal", tags: normalizeTags(options?.tags) }],
        activities: [makeActivity("plan", `新建计划：${title}`), ...p.activities].slice(0, 100),
      })),
    movePlan: (id, cardId, status) =>
      patch(id, (p) => ({
        ...p,
        plans: p.plans.map((c) => (c.id === cardId ? { ...c, status } : c)),
        activities: [makeActivity("plan", "更新了计划状态"), ...p.activities].slice(0, 100),
      })),
    removePlan: (id, cardId) =>
      patch(id, (p) => {
        const removed = p.plans.find((card) => card.id === cardId);
        return {
          ...p,
          plans: p.plans.filter((c) => c.id !== cardId),
          activities: removed ? [makeActivity("plan", `删除计划：${removed.title}`), ...p.activities].slice(0, 100) : p.activities,
        };
      }),
    addTask: (id, title, options) => {
      const taskId = uid("task");
      patch(id, (p) => ({
        ...p,
        tasks: [
          ...p.tasks,
          {
            id: taskId,
            title,
            scope: options?.scope ?? "personal",
            source: options?.source ?? "manual",
            status: "pending",
            tags: normalizeTags(options?.tags),
            ...(options?.collaborationTaskId ? { collaborationTaskId: options.collaborationTaskId } : {}),
            ...(options?.executionRef ? { executionRef: options.executionRef } : {}),
          },
        ],
        activities: [makeActivity("task", `新建任务：${title}`), ...p.activities].slice(0, 100),
      }));
      return taskId;
    },
    removeTask: (id, taskId) =>
      patch(id, (p) => {
        const removed = p.tasks.find((task) => task.id === taskId);
        return {
          ...p,
          tasks: p.tasks.filter((t) => t.id !== taskId),
          activities: removed ? [makeActivity("task", `删除任务：${removed.title}`), ...p.activities].slice(0, 100) : p.activities,
        };
      }),
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
            path: a.path,
          },
        ],
        activities: [makeActivity("asset", `添加资产：${a.name}`), ...p.activities].slice(0, 100),
      })),
    removeAsset: (id, assetId) =>
      patch(id, (p) => {
        const removed = p.assets.find((asset) => asset.id === assetId);
        return {
          ...p,
          assets: p.assets.filter((a) => a.id !== assetId),
          activities: removed ? [makeActivity("asset", `删除资产：${removed.name}`), ...p.activities].slice(0, 100) : p.activities,
        };
      }),
    addDataSource: (id, source) =>
      patch(id, (p) => p.dataSources.some((item) => item.path === source.path)
        ? p
        : { ...p, dataSources: [...p.dataSources, { ...source, id: uid("source"), addedAt: new Date().toISOString() }] }),
    removeDataSource: (id, sourceId) =>
      patch(id, (p) => ({ ...p, dataSources: p.dataSources.filter((source) => source.id !== sourceId) })),
    addMember: (id, name) =>
      patch(id, (p) =>
        p.members.includes(name) ? p : {
          ...p,
          members: [...p.members, name],
          activities: [makeActivity("member", `邀请成员：${name}`), ...p.activities].slice(0, 100),
        },
      ),
    addActivity: (id, activity) => patch(id, (p) => ({
      ...p,
      activities: [makeActivity(activity.kind, activity.text), ...p.activities].slice(0, 100),
    })),
    addConversation: (id, conv) =>
      patch(id, (p) => ({
        ...p,
        conversations: [conv, ...p.conversations],
        activities: [makeActivity("conversation", `创建对话：${conv.title}`), ...p.activities].slice(0, 100),
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
