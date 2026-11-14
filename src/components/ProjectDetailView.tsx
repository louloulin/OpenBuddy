/**
 * 项目详情页 — 对齐目标截图（图3-6）。
 *
 *  布局: 顶部面包屑(📁 项目 / 名) + 右上「邀请」 + tab 栏(动态/计划/任务/资产)
 *        + 右侧「项目配置」栏(指令/连接器/专家/技能/自动化) + 底部项目级 Composer。
 *  数据全部读自 useProjectsStore（本地持久）；动态/资产为本地模拟，配置/看板/任务可交互。
 *  无云端成员/授权后端：邀请=本地 popover 模拟复制链接，连接器/专家/技能 +添加=本地占位 picker。
 */
import { useState } from "react";
import {
  useProjectsStore,
  type ProjectMeta,
} from "@/stores/projects-store";
import { ActivityTab, PlanTab, TaskTab, AssetsTab } from "./project-tabs";
import {
  FolderIcon,
} from "@openbuddy/ui/icon/icons/index";

type TabKey = "activity" | "plan" | "task" | "asset";
type DrawerKey = "instruction" | "connectors" | "experts" | "skills" | "automation";

const TABS: { key: TabKey; label: string }[] = [
  { key: "activity", label: "动态" },
  { key: "plan", label: "计划" },
  { key: "task", label: "任务" },
  { key: "asset", label: "资产" },
];

const CONFIG_CARDS: { key: DrawerKey; title: string; desc: string }[] = [
  { key: "instruction", title: "指令", desc: "设定项目背景与规范，让 AI 与你高效协作" },
  { key: "connectors", title: "连接器", desc: "连接外部服务，扩展 AI 能力" },
  { key: "experts", title: "专家", desc: "配置项目专家，为成员提供更专业的服务" },
  { key: "skills", title: "技能", desc: "配置项目技能，让 AI 精准执行任务" },
  { key: "automation", title: "自动化", desc: "让 AI 按计划自动执行任务" },
];

export function ProjectDetailView({
  project,
  onBack,
  onToast,
  onStartConversation,
}: {
  project: ProjectMeta;
  onBack: () => void;
  onToast?: (msg: string) => void;
  
  onStartConversation?: (projectId: string, message: string) => void;
}) {
  // 读最新（交互后 store 更新，父传入的快照可能过期）。
  const live = useProjectsStore((s) => s.projects.find((p) => p.id === project.id)) ?? project;
  const [tab, setTab] = useState<TabKey>("activity");
  const [drawer, setDrawer] = useState<DrawerKey | null>(null);

  const handleComposerSend = (text: string) => {
    if (onStartConversation) {
      onStartConversation(live.id, text);
    } else {
      onToast?.("当前页面未连接 Pi 会话入口，请返回项目列表后重试。");
    }
  };

  return (
    <div className="pd-page">
      <header className="pd-topbar">
        <div className="pd-crumb">
          <FolderIcon size="sm" />
          <button className="pd-crumb__link" onClick={onBack}>项目</button>
          <span className="pd-crumb__sep">/</span>
          <span className="pd-crumb__name">{live.name}</span>
        </div>
        <div className="pd-topbar__right"><span>本地项目 · 云协作尚未开放</span><button className="pd-invite" disabled title="云协作尚未开放">邀请</button></div>
      </header>

      <div className="pd-body">
        <div className="pd-main">
          <div className="pd-tabs-row">
            <nav className="pd-tabs">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={`pd-tab-btn${tab === t.key ? " pd-tab-btn--on" : ""}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            <button className="pd-config-toggle" title="项目动态筛选暂未开放" disabled>⇄</button>
          </div>

          <div className="pd-tab-content">
            {tab === "activity" && <ActivityTab />}
            {tab === "plan" && <PlanTab projectId={live.id} />}
            {tab === "task" && <TaskTab projectId={live.id} />}
            {tab === "asset" && <AssetsTab projectId={live.id} />}
          </div>

          <ProjectComposer onSend={handleComposerSend} disabled={!onStartConversation} />
        </div>

        <aside className="pd-side">
          <h3 className="pd-side__title">项目配置</h3>
          {CONFIG_CARDS.map((c) => (
            <button key={c.key} className="pd-config-card" disabled={c.key !== "instruction"} title={c.key === "instruction" ? "编辑本地项目指令" : "项目级绑定暂未开放，请使用技能与MCP资源页"} onClick={() => setDrawer(c.key)}>
              <div className="pd-config-card__head">
                <span className="pd-config-card__title">{c.title}</span>
                <span className="pd-config-card__plus">{c.key === "instruction" ? "+" : "暂缓"}</span>
              </div>
              <div className="pd-config-card__desc">{c.desc}</div>
            </button>
          ))}
        </aside>
      </div>

      {drawer && (
        <ConfigDrawer
          drawer={drawer}
          project={live}
          onClose={() => setDrawer(null)}
        />
      )}


    </div>
  );
}

// ============================================================
// 配置抽屉
// ============================================================

function ConfigDrawer({ drawer, project, onClose }: { drawer: DrawerKey; project: ProjectMeta; onClose: () => void }) {
  const updateConfig = useProjectsStore(state => state.updateConfig);
  return <div className="modal-overlay" onClick={onClose}><div className="create-colleague-dialog proj-drawer" onClick={event => event.stopPropagation()} role="dialog" aria-label="本地项目指令">
    <div className="create-colleague-header"><h3>本地项目指令</h3><button onClick={onClose} aria-label="关闭">×</button></div>
    <div className="create-colleague-body">{drawer === "instruction" ? <textarea className="create-colleague-textarea" rows={8} value={project.instructions ?? ""} onChange={event => updateConfig(project.id, { instructions: event.target.value })} placeholder="设定项目背景与规范…" /> : <p>此项目级绑定尚未开放，请使用资源页的实际技能和 MCP 配置。</p>}</div>
    <div className="create-colleague-footer"><button className="btn btn--primary" onClick={onClose}>完成</button></div>
  </div></div>;
}

// ============================================================
// 项目级 Composer 薄壳（左 Craft/Auto/技能/连接器 + 右 +/发送）
// ============================================================

function ProjectComposer({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  const [text, setText] = useState("");
  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
  };
  return (
    <div className="pd-composer">
      <textarea
        className="pd-composer__input"
        rows={1}
        disabled={disabled}
        value={text}
        placeholder="输入消息..."
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="pd-composer__footer">
        <span className="pd-composer__chip">在本地项目中创建 Pi 对话</span><span className="pd-composer__spacer" />
        <button className="pd-composer__send" onClick={send} aria-label="发送" disabled={disabled || !text.trim()}>➤</button>
      </div>
    </div>
  );
}
