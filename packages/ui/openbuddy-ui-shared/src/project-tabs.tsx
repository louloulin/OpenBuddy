/**
 * 项目详情页基础 tab 面板 — 对齐目标截图，数据来自本地 store。
 *
 *  - 动态: 与我相关 / 成员动态 切换 + 空态（无云端活动流，仅壳）
 *  - 计划: 看板 4 列（待开始/进行中/暂停/完成）+ 新建待办/流转/删除（本地交互）
 *  - 任务: 列表 + 筛选下拉(占位) + 新建/删除（本地交互）+ 空态
 *  - 资产: 工具栏 + 配额(本地估算) + 文件表格 + 新建文件夹/上传(本地) + 删除
 */
import { useEffect, useMemo, useState } from "react";
import { useProjectsStore, PLAN_COLUMNS, type PlanStatus, type AssetItem } from "@/stores/projects-store";
import { SearchIcon } from "@openbuddy/ui-primitives/icons";
import { open as openDialog, invoke } from "@/lib/platform/electron-api";
import { collaborationSnapshot } from "@/lib/agent/pi-client";
import { ProjectInputDialog } from "@openbuddy/ui-dialogs";
import { PromptDialog } from "@openbuddy/ui-dialogs";

function relativeActivityTime(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

// ============================================================
// 动态
// ============================================================

export function ActivityTab({ projectId }: { projectId: string }) {
  const [sub, setSub] = useState<"personal" | "member">("personal");
  const activities = useProjectsStore((s) => s.projects.find((p) => p.id === projectId)?.activities ?? []);
  return (
    <div className="pd-tab">
      <div className="pd-activity-switch">
        <button className={`pd-pill${sub === "personal" ? " pd-pill--on" : ""}`} onClick={() => setSub("personal")}>与我相关</button>
        <button className={`pd-pill${sub === "member" ? " pd-pill--on" : ""}`} onClick={() => setSub("member")}>成员动态</button>
      </div>
      {activities.filter((activity) => sub === "personal" || activity.kind === "member").length === 0 ? (
        <div className="pd-empty">{sub === "personal" ? "暂无与我有关的动态" : "暂无成员动态"}</div>
      ) : (
        <ul className="pd-activity-list">
          {activities.filter((activity) => sub === "personal" || activity.kind === "member").map((activity) => (
            <li className="pd-activity-item" key={activity.id}>
              <span className="pd-activity-item__text">{activity.text}</span>
              <time dateTime={activity.createdAt}>{relativeActivityTime(activity.createdAt)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================
// 计划（看板）
// ============================================================

const COL_DOT: Record<PlanStatus, string> = {
  pending: "#bbb",
  in_progress: "#18a058",
  paused: "#f0a020",
  completed: "#18a058",
};

export function PlanTab({ projectId, onToast }: { projectId: string; onToast?: (message: string) => void }) {
  const plans = useProjectsStore((s) => s.projects.find((p) => p.id === projectId)?.plans ?? []);
  const addPlan = useProjectsStore((s) => s.addPlan);
  const movePlan = useProjectsStore((s) => s.movePlan);
  const removePlan = useProjectsStore((s) => s.removePlan);
  const updatePlanTags = useProjectsStore((s) => s.updatePlanTags);
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === projectId));
  const addDataSource = useProjectsStore((s) => s.addDataSource);
  const removeDataSource = useProjectsStore((s) => s.removeDataSource);
  const [q, setQ] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<"all" | "personal" | "shared">("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | string>("all");
  const [newPlanStatus, setNewPlanStatus] = useState<PlanStatus | null>(null);
  const [tagsPrompt, setTagsPrompt] = useState<{ planId: string; currentTags: string[] } | null>(null);

  const sourceOptions = Array.from(new Set(plans.map((plan) => plan.source ?? "manual")));
  const visiblePlans = plans.filter((plan) => {
    const owner = plan.owner ?? "personal";
    const source = plan.source ?? "manual";
    return (ownerFilter === "all" || owner === ownerFilter)
      && (sourceFilter === "all" || source === sourceFilter)
      && `${plan.title} ${(plan.tags ?? []).join(" ")}`.toLowerCase().includes(q.toLowerCase());
  });

  const newTodo = () => {
    setNewPlanStatus("pending");
  };

  const addSource = async () => {
    const selected = await openDialog({ directory: true, multiple: false, title: "选择项目数据源" });
    if (!selected || Array.isArray(selected)) return;
    const path = selected as string;
    addDataSource(projectId, { path, label: path.split(/[\\/]/).pop() || path });
    onToast?.("已添加项目数据源");
  };

  const editPlanTags = (planId: string, currentTags: string[] = []) => {
    setTagsPrompt({ planId, currentTags });
  };

  return (
    <div className="pd-tab">
      <div className="pd-toolbar">
        <div className="pd-toolbar__left">
          <button className="pd-btn pd-btn--primary" onClick={newTodo}>+ 新建待办</button>
          <button className="pd-btn" onClick={() => void addSource()}>+ 添加数据源</button>
        </div>
        <div className="pd-toolbar__right">
          <label className="pd-select-wrap">
            <span className="sr-only">计划归属</span>
            <select className="pd-btn" aria-label="计划归属" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value as typeof ownerFilter)}>
              <option value="all">全部归属</option>
              <option value="personal">个人计划</option>
              <option value="shared">共享计划</option>
            </select>
          </label>
          <label className="pd-select-wrap">
            <span className="sr-only">计划来源</span>
            <select className="pd-btn" aria-label="计划来源" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
              <option value="all">全部来源</option>
              {sourceOptions.map((source) => <option value={source} key={source}>{source === "manual" ? "手动创建" : source}</option>)}
            </select>
          </label>
          <button className="pd-btn" onClick={() => {
            const pending = visiblePlans.filter((plan) => plan.status !== "completed");
            pending.forEach((plan) => movePlan(projectId, plan.id, "completed"));
            onToast?.(pending.length ? `已完成 ${pending.length} 项计划` : "没有可批量完成的计划");
          }}>批量完成</button>
          <label className="pd-search-inline-wrap">
            <SearchIcon size="sm" />
            <input className="pd-search-inline" aria-label="搜索计划" placeholder="搜索计划" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
      </div>

      {project?.dataSources.length ? (
        <div className="pd-data-sources" aria-label="项目数据源">
          {project.dataSources.map((source) => (
            <span className="pd-data-source" key={source.id} title={source.path}>
              📁 {source.label}
              <button type="button" aria-label={`移除数据源 ${source.label}`} onClick={() => removeDataSource(projectId, source.id)}>×</button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="pd-board">
        {PLAN_COLUMNS.map((col) => {
          const cards = visiblePlans.filter((c) => c.status === col.status);
          return (
            <div className="pd-board-col" key={col.status}>
              <div className="pd-board-col__head">
                <span className="pd-board-col__dot" style={{ background: COL_DOT[col.status] }} />
                <span className="pd-board-col__label">{col.label}</span>
                <span className="pd-board-col__count">{cards.length}</span>
                <button
                  className="pd-board-col__add"
                  aria-label={`在${col.label}新建`}
                  onClick={() => setNewPlanStatus(col.status)}
                >
                  +
                </button>
              </div>
              <div className="pd-board-col__body">
                {cards.length === 0 ? (
                  <div className="pd-board-empty">
                    {col.status === "pending" ? "暂无事项，可从这里开始新建。" : "暂无事项"}
                  </div>
                ) : (
                  cards.map((c) => (
                    <div className="pd-board-card" key={c.id}>
                      <span className="pd-board-card__title">{c.title}</span>
                      {c.tags?.length ? <div className="pd-entity-tags" aria-label={`${c.title} 的工作区标签`}>{c.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
                      <div className="pd-board-card__acts">
                        {PLAN_COLUMNS.filter((x) => x.status !== c.status).map((x) => (
                          <button
                            key={x.status}
                            className="pd-board-card__move"
                            title={`移到${x.label}`}
                            onClick={() => movePlan(projectId, c.id, x.status)}
                          >
                            →{x.label}
                          </button>
                        ))}
                        <button className="pd-board-card__tag" onClick={() => editPlanTags(c.id, c.tags)}>{c.tags?.length ? "改标签" : "加标签"}</button>
                        <button className="pd-board-card__del" aria-label="删除" onClick={() => removePlan(projectId, c.id)}>×</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
      {newPlanStatus && (
        <ProjectInputDialog
          title={`在「${PLAN_COLUMNS.find((column) => column.status === newPlanStatus)?.label}」新建待办`}
          label="待办标题"
          placeholder="例如：整理验收清单"
          onCancel={() => setNewPlanStatus(null)}
          onConfirm={(title) => {
            addPlan(projectId, title, newPlanStatus);
            setNewPlanStatus(null);
          }}
        />
      )}
      {tagsPrompt && (
        <PromptDialog
          open
          title="编辑计划工作区标签"
          description="使用英文逗号分隔多个标签；留空会清空当前标签。"
          placeholder="标签 1, 标签 2"
          defaultValue={tagsPrompt.currentTags.join(", ")}
          confirmLabel="保存"
          onConfirm={(value) => {
            updatePlanTags(projectId, tagsPrompt.planId, value.split(","));
            onToast?.("计划工作区标签已更新");
            setTagsPrompt(null);
          }}
          onCancel={() => setTagsPrompt(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// 任务
// ============================================================

export function TaskTab({ projectId }: { projectId: string }) {
  const tasks = useProjectsStore((s) => s.projects.find((p) => p.id === projectId)?.tasks ?? []);
  const addTask = useProjectsStore((s) => s.addTask);
  const removeTask = useProjectsStore((s) => s.removeTask);
  const updateTaskTags = useProjectsStore((s) => s.updateTaskTags);
  const [q, setQ] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | "personal" | "shared">("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | string>("all");
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const collaborationTaskIds = tasks.map((task) => task.collaborationTaskId).filter((id): id is string => Boolean(id));
  const collaborationTaskKey = collaborationTaskIds.join(",");
  const [collaborationStatuses, setCollaborationStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    if (!collaborationTaskIds.length) {
      setCollaborationStatuses({});
      return () => { active = false; };
    }
    void collaborationSnapshot().then((snapshot) => {
      if (!active) return;
      const next = Object.fromEntries(snapshot.tasks
        .filter((task) => collaborationTaskIds.includes(task.taskId))
        .map((task) => [task.taskId, task.status]));
      setCollaborationStatuses(next);
    }).catch(() => {
      if (active) setCollaborationStatuses({});
    });
    return () => { active = false; };
  }, [collaborationTaskKey]);

  const sourceOptions = Array.from(new Set(tasks.map((task) => task.source)));
  const filtered = tasks.filter((task) =>
    (scopeFilter === "all" || task.scope === scopeFilter)
    && (sourceFilter === "all" || task.source === sourceFilter)
    && `${task.title} ${(task.tags ?? []).join(" ")}`.toLowerCase().includes(q.toLowerCase()));

  const newTask = () => {
    setNewTaskOpen(true);
  };
  const [tagsPrompt, setTagsPrompt] = useState<{ taskId: string; currentTags: string[] } | null>(null);

  const editTaskTags = (taskId: string, currentTags: string[] = []) => {
    setTagsPrompt({ taskId, currentTags });
  };

  return (
    <>
    <div className="pd-tab">
      <div className="pd-toolbar">
        <div className="pd-toolbar__left">
          <label className="pd-select-wrap">
            <span className="sr-only">任务归属</span>
            <select className="pd-btn" aria-label="任务归属" value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as typeof scopeFilter)}>
              <option value="all">全部任务</option>
              <option value="personal">个人任务</option>
              <option value="shared">共享任务</option>
            </select>
          </label>
          <label className="pd-select-wrap">
            <span className="sr-only">任务来源</span>
            <select className="pd-btn" aria-label="任务来源" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
              <option value="all">全部来源</option>
              {sourceOptions.map((source) => <option value={source} key={source}>{source}</option>)}
            </select>
          </label>
          <span className="pd-toolbar__hint">你的任务是私密的，除非你共享它们</span>
        </div>
        <div className="pd-toolbar__right">
          <input className="pd-search-inline" placeholder="搜索任务标题" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="pd-btn pd-btn--primary" onClick={newTask}>+ 新建任务</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="pd-empty">{q ? "没有符合条件的任务" : "暂无任务，点击「新建任务」开始。"}</div>
      ) : (
        <ul className="pd-task-list">
          {filtered.map((t) => (
            <li className="pd-task-item" key={t.id}>
              <span className="pd-task-item__title">{t.title}</span>
              <span className="pd-task-item__meta">{t.scope === "personal" ? "个人" : "共享"} · {t.source}{t.collaborationTaskId ? ` · Buddy 协作 · ${collaborationStatuses[t.collaborationTaskId] ?? "同步中"}` : ""}</span>
              {t.tags?.length ? <span className="pd-entity-tags" aria-label={`${t.title} 的工作区标签`}>{t.tags.map((tag) => <span key={tag}>{tag}</span>)}</span> : null}
              <button className="pd-task-item__tag" type="button" onClick={() => editTaskTags(t.id, t.tags)}>{t.tags?.length ? "改标签" : "加标签"}</button>
              {t.collaborationTaskId ? (
                <span className="pd-task-item__canonical" title="Buddy 任务必须在助理工作台中控制">由助理控制</span>
              ) : (
                <button className="pd-task-item__del" aria-label="删除" onClick={() => removeTask(projectId, t.id)}>×</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {newTaskOpen && (
        <ProjectInputDialog
          title="新建任务"
          label="任务标题"
          placeholder="例如：验证 Electron 启动流程"
          onCancel={() => setNewTaskOpen(false)}
          onConfirm={(title) => {
            addTask(projectId, title);
            setNewTaskOpen(false);
          }}
        />
      )}
    </div>
      {tagsPrompt && (
        <PromptDialog
          open
          title="编辑任务工作区标签"
          description="使用英文逗号分隔多个标签；留空会清空当前标签。"
          placeholder="标签 1, 标签 2"
          defaultValue={tagsPrompt.currentTags.join(", ")}
          confirmLabel="保存"
          onConfirm={(value) => {
            updateTaskTags(projectId, tagsPrompt.taskId, value.split(","));
            setTagsPrompt(null);
          }}
          onCancel={() => setTagsPrompt(null)}
        />
      )}
    </>
  );
}

// ============================================================
// 资产
// ============================================================

const QUOTA_TOTAL_MB = 5 * 1024; // 5.00 GB

function fmtSize(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(2)} MB`;
}

function estimateUsed(assets: AssetItem[]): number {
  const bytes = assets.reduce((sum, asset) => sum + (asset.sizeBytes ?? 0), 0);
  return bytes / (1024 * 1024);
}

export function AssetsTab({ projectId, onToast }: { projectId: string; onToast?: (message: string) => void }) {
  const assets = useProjectsStore((s) => s.projects.find((p) => p.id === projectId)?.assets ?? []);
  const addAsset = useProjectsStore((s) => s.addAsset);
  const removeAsset = useProjectsStore((s) => s.removeAsset);
  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | AssetItem["kind"]>("all");
  const [removingAssetId, setRemovingAssetId] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);

  const used = useMemo(() => estimateUsed(assets), [assets]);

  const newFolder = async () => {
    const project = useProjectsStore.getState().projects.find((item) => item.id === projectId);
    if (!project?.cwd) return;
    setNewFolderOpen(true);
  };

  const createFolder = async (name: string) => {
    const project = useProjectsStore.getState().projects.find((item) => item.id === projectId);
    if (!project?.cwd) return;
    try {
      const path = await invoke<string>("shellfs:mkdir", { path: name.trim(), workspaceRoot: project.cwd });
      addAsset(projectId, { name: name.trim(), kind: "folder", path });
      setNewFolderOpen(false);
    } catch (error) {
      onToast?.(`创建文件夹失败：${String(error).replace(/^Error:\s*/, "")}`);
    }
  };
  const upload = async () => {
    const project = useProjectsStore.getState().projects.find((item) => item.id === projectId);
    const workspaceRoot = project?.cwd;
    if (!workspaceRoot) return;
    const selected = await openDialog({ multiple: true, directory: false, title: "选择要导入项目的文件" });
    const files = Array.isArray(selected) ? selected : selected ? [selected] : [];
    for (const sourcePath of files) {
      try {
        const imported = await invoke<{ path: string; name: string; size: number }>("shellfs:import-file", { sourcePath, workspaceRoot });
        const ext = imported.name.includes(".") ? imported.name.split(".").pop()?.toUpperCase() : undefined;
        addAsset(projectId, { name: imported.name, kind: "file", ext, sizeBytes: imported.size, sizeLabel: formatBytes(imported.size), path: imported.path });
      } catch (error) {
        onToast?.(`导入失败：${String(error).replace(/^Error:\s*/, "")}`);
      }
    }
  };

  const rows = assets.filter((asset) =>
    (kindFilter === "all" || asset.kind === kindFilter)
    && asset.name.toLowerCase().includes(q.toLowerCase()));

  const deleteAsset = async (asset: AssetItem) => {
    if (removingAssetId) return;
    setRemovingAssetId(asset.id);
    try {
      const project = useProjectsStore.getState().projects.find((item) => item.id === projectId);
      if (asset.path) await invoke("shellfs:remove", { path: asset.path, workspaceRoot: project?.cwd });
      removeAsset(projectId, asset.id);
    } catch (error) {
      onToast?.(`删除失败，资产记录已保留：${String(error).replace(/^Error:\s*/, "")}`);
    } finally {
      setRemovingAssetId(null);
    }
  };

  return (
    <div className="pd-tab">
      <div className="pd-toolbar">
        <div className="pd-toolbar__left">
          <button className="pd-btn" onClick={newFolder}>新建文件夹</button>
          <button className="pd-btn" onClick={upload}>上传文件</button>
          <span className="pd-toolbar__hint">
            存储空间已用 {fmtSize(used)} / {fmtSize(QUOTA_TOTAL_MB)}
          </span>
        </div>
        <div className="pd-toolbar__right">
          <label className="pd-select-wrap">
            <span className="sr-only">资产类型</span>
            <select className="pd-btn" aria-label="资产类型" value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}>
              <option value="all">全部类型</option>
              <option value="folder">文件夹</option>
              <option value="file">文件</option>
            </select>
          </label>
          <input className="pd-search-inline" placeholder="搜索文件或文件夹…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {newFolderOpen && (
        <ProjectInputDialog
          title="新建文件夹"
          label="文件夹名称"
          placeholder="例如：交付资料"
          onCancel={() => setNewFolderOpen(false)}
          onConfirm={(name) => void createFolder(name)}
        />
      )}
      <table className="pd-asset-table">
        <thead>
          <tr>
            <th className="pd-asset-table__name">名称</th>
            <th>类型</th>
            <th>更新人</th>
            <th>更新时间</th>
            <th>大小</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="pd-asset-empty" colSpan={6}>暂无资产，点击「上传文件」或「新建文件夹」开始。</td>
            </tr>
          ) : (
            rows.map((a) => (
              <tr key={a.id}>
                <td className="pd-asset-table__name">
                  <span className="pd-asset-icon">{a.kind === "folder" ? "📁" : "📄"}</span>
                  {a.name}
                </td>
                <td>{a.kind === "folder" ? "文件夹" : a.ext ?? "文件"}</td>
                <td>{a.updater ?? "-"}</td>
                <td>{a.updatedAt ? relTime(a.updatedAt) : "-"}</td>
                <td>{a.kind === "folder" ? "-" : a.sizeLabel ?? "-"}</td>
                <td>
              <button className="pd-asset-del" aria-label={`删除 ${a.name}`} disabled={removingAssetId === a.id} onClick={() => void deleteAsset(a)}>×</button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
}
