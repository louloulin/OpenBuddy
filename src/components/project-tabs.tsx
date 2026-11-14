/**
 * 项目详情页四个 tab 面板 — 对齐目标截图，数据来自本地 store。
 *
 *  - 动态: 与我相关 / 成员动态 切换 + 空态（无云端活动流，仅壳）
 *  - 计划: 看板 4 列（待开始/进行中/暂停/完成）+ 新建待办/流转/删除（本地交互）
 *  - 任务: 列表 + 筛选下拉(占位) + 新建/删除（本地交互）+ 空态
 *  - 资产: 工具栏 + 配额(本地估算) + 文件表格 + 新建文件夹/上传(本地) + 删除
 */
import { useMemo, useState } from "react";
import { appPrompt } from "./AppDialog";
import { useProjectsStore, PLAN_COLUMNS, type PlanStatus, type AssetItem } from "@/stores/projects-store";
import { ChevronDownIcon, SearchIcon } from "@/foundation/components/Icon/icons";

// ============================================================
// 动态
// ============================================================

export function ActivityTab() {
  const [sub, setSub] = useState<"personal" | "member">("personal");
  return (
    <div className="pd-tab">
      <div className="pd-activity-switch">
        <button className={`pd-pill${sub === "personal" ? " pd-pill--on" : ""}`} onClick={() => setSub("personal")}>与我相关</button>
        <button className={`pd-pill${sub === "member" ? " pd-pill--on" : ""}`} disabled title="云成员动态尚未开放" onClick={() => setSub("member")}>成员动态</button>
      </div>
      <div className="pd-empty">{sub === "personal" ? "暂无与我有关的动态" : "暂无成员动态"}</div>
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

export function PlanTab({ projectId }: { projectId: string }) {
  const plans = useProjectsStore((s) => s.projects.find((p) => p.id === projectId)?.plans ?? []);
  const addPlan = useProjectsStore((s) => s.addPlan);
  const movePlan = useProjectsStore((s) => s.movePlan);
  const removePlan = useProjectsStore((s) => s.removePlan);

  const newTodo = async () => {
    const title = await appPrompt({ title: "新建待办", placeholder: "待办标题", confirmLabel: "创建" });
    if (title) addPlan(projectId, title, "pending");
  };

  return (
    <div className="pd-tab">
      <div className="pd-toolbar">
        <div className="pd-toolbar__left">
          <button className="pd-btn pd-btn--primary" onClick={newTodo}>+ 新建待办</button>
          <button className="pd-btn" disabled title="云端数据源尚未开放">+ 添加数据源</button>
        </div>
        <div className="pd-toolbar__right">
          <button className="pd-btn">全部归属 <ChevronDownIcon size="sm" style={{ verticalAlign: "text-bottom" }} /></button>
          <button className="pd-btn" disabled title="当前仅支持本地来源">全部来源 <ChevronDownIcon size="sm" style={{ verticalAlign: "text-bottom" }} /></button>
          <button className="pd-btn">批量操作</button>
          <button className="pd-btn pd-btn--icon" aria-label="搜索"><SearchIcon size="sm" /></button>
        </div>
      </div>

      <div className="pd-board">
        {PLAN_COLUMNS.map((col) => {
          const cards = plans.filter((c) => c.status === col.status);
          return (
            <div className="pd-board-col" key={col.status}>
              <div className="pd-board-col__head">
                <span className="pd-board-col__dot" style={{ background: COL_DOT[col.status] }} />
                <span className="pd-board-col__label">{col.label}</span>
                <span className="pd-board-col__count">{cards.length}</span>
                <button
                  className="pd-board-col__add"
                  aria-label={`在${col.label}新建`}
                  onClick={async () => {
                    const title = await appPrompt({ title: `在「${col.label}」新建待办`, placeholder: "待办标题", confirmLabel: "创建" });
                    if (title) addPlan(projectId, title, col.status);
                  }}
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
  const [q, setQ] = useState("");

  const filtered = tasks.filter((t) => t.title.toLowerCase().includes(q.toLowerCase()));

  const newTask = async () => {
    const title = await appPrompt({ title: "新建任务", placeholder: "任务标题", confirmLabel: "创建" });
    if (title) addTask(projectId, title);
  };

  return (
    <div className="pd-tab">
      <div className="pd-toolbar">
        <div className="pd-toolbar__left">
          <button className="pd-btn" disabled title="当前仅显示本地任务">全部任务 <ChevronDownIcon size="sm" style={{ verticalAlign: "text-bottom" }} /></button>
          <button className="pd-btn" disabled title="当前仅支持本地来源">全部来源 <ChevronDownIcon size="sm" style={{ verticalAlign: "text-bottom" }} /></button>
          <span className="pd-toolbar__hint">当前是本地任务记录，不会同步给云端成员</span>
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
              <span className="pd-task-item__meta">{t.scope === "personal" ? "个人" : "共享"} · {t.source}</span>
              <button className="pd-task-item__del" aria-label="删除" onClick={() => removeTask(projectId, t.id)}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================
// 资产
// ============================================================

function estimateUsed(assets: AssetItem[]): number {
  return new TextEncoder().encode(JSON.stringify(assets)).byteLength / (1024 * 1024);
}

export function AssetsTab({ projectId }: { projectId: string }) {
  const assets = useProjectsStore((s) => s.projects.find((p) => p.id === projectId)?.assets ?? []);
  const addAsset = useProjectsStore((s) => s.addAsset);
  const removeAsset = useProjectsStore((s) => s.removeAsset);
  const [q, setQ] = useState("");

  const used = useMemo(() => estimateUsed(assets), [assets]);

  const newFolder = async () => {
    const name = await appPrompt({ title: "新建本地分类", placeholder: "分类名称", confirmLabel: "创建" });
    if (name) addAsset(projectId, { name, kind: "folder" });
  };
  const rows = assets.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="pd-tab">
      <div className="pd-toolbar">
        <div className="pd-toolbar__left">
          <button className="pd-btn" onClick={newFolder}>新建本地分类</button>
          <button className="pd-btn" disabled title="文件上传尚未接入；可在对话中添加真实附件">上传文件</button>
          <span className="pd-toolbar__hint">
            本地条目元数据估算 {(used * 1024).toFixed(2)} KB，不代表文件容量或云配额
          </span>
        </div>
        <div className="pd-toolbar__right">
          <button className="pd-btn" disabled title="类型筛选尚未开放">全部类型 <ChevronDownIcon size="sm" style={{ verticalAlign: "text-bottom" }} /></button>
          <input className="pd-search-inline" placeholder="搜索文件或文件夹…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

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
              <td className="pd-asset-empty" colSpan={6}>暂无本地资产条目。文件上传尚未开放，可在对话中添加真实附件。</td>
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
                  <button className="pd-asset-del" aria-label="删除" onClick={() => removeAsset(projectId, a.id)}>×</button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
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
