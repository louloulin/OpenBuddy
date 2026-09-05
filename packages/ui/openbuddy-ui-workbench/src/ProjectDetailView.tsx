/**
 * 项目详情页 — 对齐目标截图（图3-6）。
 *
 *  布局: 顶部面包屑(📁 项目 / 名) + 右上「邀请」 + tab 栏(动态/计划/任务/Buddy 协作/资产)
 *        + 右侧「项目配置」栏(指令/连接器/专家/技能/自动化) + 底部项目级 Composer。
 *  项目元数据与企业项目绑定由主进程/资源网关保护；本地项目仍使用本地持久化。
 *  企业成员与组织权限由 Casdoor 管理，OpenBuddy 不伪造本地邀请成功。
 *  数据全部读自 useProjectsStore（本地持久），项目对话通过 Electron Main 创建真实 Pi 会话。
 *  当前版本是单机工作区：成员和项目配置保存到本地，不伪装成云端协作服务。
 */
import { useEffect, useMemo, useState } from "react";
import {
  useProjectsStore,
  type ProjectMeta,
  type RefItem,
} from "@/stores/projects-store";
import {
  ConfigRow,
  RefPickerDialog,
  useLiveProjectPickerOptions,
} from "@openbuddy/ui-shared";
import { ActivityTab, PlanTab, TaskTab, AssetsTab } from "@openbuddy/ui-shared";
import { ProjectCollaborationTab } from "./ProjectCollaborationTab";
import { AutomationPanel } from "@openbuddy/ui-automation";
import { ProjectInputDialog } from "@openbuddy/ui-dialogs";
import { RendererContributionView } from "./RendererContributionView";
import { useRendererContributions } from "@/lib/runtime/renderer-plugin-runtime";
import { emailListProjectThreads, type EmailProjectThread } from "@/lib/agent/pi-client";
import {
  FolderIcon,
  ChevronDownIcon,
} from "@openbuddy/ui-primitives/icons";
import { casdoorOpenMembershipManagement } from "@/lib/casdoor/casdoor-client";

type TabKey = "activity" | "plan" | "task" | "collaboration" | "asset" | "email" | `plugin:${string}`;
type DrawerKey = "instruction" | "tags" | "connectors" | "experts" | "skills" | "automation";

const TABS: { key: TabKey; label: string }[] = [
  { key: "activity", label: "动态" },
  { key: "plan", label: "计划" },
  { key: "task", label: "任务" },
  { key: "collaboration", label: "Buddy 协作" },
  { key: "asset", label: "资产" },
  { key: "email", label: "邮件" },
];

const CONFIG_CARDS: { key: DrawerKey; title: string; desc: string }[] = [
  { key: "instruction", title: "指令", desc: "设定项目背景与规范，让 AI 与你高效协作" },
  { key: "tags", title: "工作区标签", desc: "将项目与邮件、任务、计划放入统一工作流" },
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
  onNavigate,
}: {
  project: ProjectMeta;
  onBack: () => void;
  onToast?: (msg: string) => void;
  /** Start a new conversation within this project (creates a real pi session). */
  onStartConversation?: (projectId: string, message: string) => void;
  onNavigate?: (label: string) => void;
}) {
  // 读最新（交互后 store 更新，父传入的快照可能过期）。
  const live = useProjectsStore((s) => s.projects.find((p) => p.id === project.id)) ?? project;
  const updateConfig = useProjectsStore((s) => s.updateConfig);
  const addMember = useProjectsStore((s) => s.addMember);

  const [tab, setTab] = useState<TabKey>("activity");
  const [drawer, setDrawer] = useState<DrawerKey | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pickerFor, setPickerFor] = useState<null | "connectors" | "experts" | "skills">(null);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [projectEmails, setProjectEmails] = useState<EmailProjectThread[]>([]);
  const [projectEmailsLoading, setProjectEmailsLoading] = useState(false);
  const pickerOptions = useLiveProjectPickerOptions();
  const projectContributions = useRendererContributions("project");
  const projectTabs = useMemo(
    () => projectContributions
      .filter((contribution) => typeof contribution.payload.projectTab === "string" && contribution.payload.projectTab.trim())
      .sort((left, right) => Number(left.payload.order ?? 1000) - Number(right.payload.order ?? 1000)
        || (left.payload.label ?? left.payload.title ?? left.id).localeCompare(right.payload.label ?? right.payload.title ?? right.id)),
    [projectContributions],
  );

  useEffect(() => {
    if (tab !== "email") return;
    let cancelled = false;
    setProjectEmailsLoading(true);
    void emailListProjectThreads(live.id).then((items) => {
      if (!cancelled) setProjectEmails(items);
    }).catch(() => {
      if (!cancelled) setProjectEmails([]);
    }).finally(() => {
      if (!cancelled) setProjectEmailsLoading(false);
    });
    return () => { cancelled = true; };
  }, [live.id, tab]);

  const openProjectEmail = (item: EmailProjectThread) => {
    window.localStorage.setItem("openbuddy.email.inbox-target", JSON.stringify({ accountId: item.accountId, threadId: item.threadId }));
    onNavigate?.("邮件");
  };

  const setPicked = (k: typeof pickerFor, items: RefItem[]) => {
    if (!k) return;
    if (k === "connectors") updateConfig(live.id, { connectors: items });
    else if (k === "experts") updateConfig(live.id, { experts: items });
    else updateConfig(live.id, { skills: items });
    setPickerFor(null);
  };

  const invite = () => {
    if (live.enterpriseResourceId) {
      void casdoorOpenMembershipManagement()
        .then(() => onToast?.("已打开 Casdoor 管理控制台，请在当前租户中邀请成员或配置群组"))
        .catch((error) => onToast?.(`无法打开企业成员管理：${String(error).replace(/^Error:\s*/, "")}`));
      setMembersOpen(false);
      return;
    }
    setInviteOpen(true);
  };

  const handleComposerSend = (text: string) => {
    if (onStartConversation) {
      onStartConversation(live.id, text);
    } else {
      const preview = text.slice(0, 20);
      const suffix = text.length > 20 ? "…" : "";
      onToast?.(`项目会话未连接，消息未发送：${preview}${suffix}`);
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
        <div className="pd-topbar__right">
          <button className="pd-invite" onClick={() => setMembersOpen((v) => !v)}>添加成员</button>
          {membersOpen && (
            <div className="pd-members-pop">
              <div className="pd-members-pop__head">项目成员</div>
              {live.members.length === 0 ? (
                <div className="pd-members-pop__empty">暂无成员</div>
              ) : (
                live.members.map((m) => (
                  <div className="pd-members-pop__item" key={m}>{m}</div>
                ))
              )}
              <button className="pd-members-pop__add" onClick={invite}>+ 添加本地成员</button>
            </div>
          )}
        </div>
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
              {projectTabs.map((contribution) => (
                <button
                  key={contribution.id}
                  className={`pd-tab-btn${tab === `plugin:${contribution.id}` ? " pd-tab-btn--on" : ""}`}
                  onClick={() => setTab(`plugin:${contribution.id}` as TabKey)}
                  title={contribution.payload.description ?? contribution.payload.label ?? contribution.id}
                >
                  {contribution.payload.label ?? contribution.payload.title ?? contribution.id}
                </button>
              ))}
            </nav>
            <button className="pd-config-toggle" title="刷新活动" onClick={() => onToast?.("活动已刷新")}>↻</button>
          </div>

          <div className="pd-tab-content">
            {tab === "activity" && <ActivityTab projectId={live.id} />}
            {tab === "plan" && <PlanTab projectId={live.id} onToast={onToast} />}
            {tab === "task" && <TaskTab projectId={live.id} />}
            {tab === "collaboration" && <ProjectCollaborationTab projectId={live.id} projectName={live.name} onToast={onToast} />}
            {tab === "asset" && <AssetsTab projectId={live.id} onToast={onToast} />}
            {tab === "email" && <section className="pd-email-list" aria-label="项目邮件">
              <div className="pd-email-list__head"><div><h3>项目邮件</h3><p>与项目关联的邮件线程；正文仍以邮箱 provider 为事实源。</p></div><button type="button" onClick={() => onNavigate?.("邮件")}>打开邮件</button></div>
              {projectEmailsLoading ? <p>加载项目邮件…</p> : projectEmails.length === 0 ? <p>暂无关联邮件，可在邮件线程中选择“关联项目”。</p> : <div className="pd-email-list__items">{projectEmails.map((item) => <button type="button" className="pd-email-list__item" key={`${item.accountId}:${item.threadId}`} onClick={() => openProjectEmail(item)}><span><strong>{item.subject || "（无主题）"}</strong><small>{item.from.address} · {new Date(item.date).toLocaleString()} · {item.messageCount} 封</small>{item.tags?.length ? <span className="pd-entity-tags" aria-label={`${item.subject || "邮件"} 的工作区标签`}>{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</span> : null}</span>{item.unread ? <em>未读</em> : null}</button>)}</div>}
            </section>}
            {projectTabs.map((contribution) => tab === `plugin:${contribution.id}` && (
              <RendererContributionView
                key={contribution.id}
                contribution={contribution}
                onPlaceholder={onToast}
                context={{ projectId: live.id, projectName: live.name }}
              />
            ))}
          </div>

          <ProjectComposer onSend={handleComposerSend} />
        </div>

        <aside className="pd-side">
          <h3 className="pd-side__title">项目配置</h3>
          {CONFIG_CARDS.map((c) => (
            <button key={c.key} className="pd-config-card" onClick={() => setDrawer(c.key)}>
              <div className="pd-config-card__head">
                <span className="pd-config-card__title">{c.title}</span>
                <span className="pd-config-card__plus">+</span>
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
          onOpenPicker={(k) => setPickerFor(k)}
          onOpenAutomation={() => setAutomationOpen(true)}
        />
      )}

      {pickerFor && (
        <RefPickerDialog
          title={pickerFor === "connectors" ? "连接器" : pickerFor === "experts" ? "专家" : "技能"}
          options={pickerOptions[pickerFor]}
          selected={pickerFor === "connectors" ? live.connectors : pickerFor === "experts" ? live.experts : live.skills}
          onCancel={() => setPickerFor(null)}
          onConfirm={(items) => setPicked(pickerFor, items)}
        />
      )}
      {automationOpen && (
        <div className="modal-overlay" onClick={() => setAutomationOpen(false)}>
          <div className="proj-automation-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="自动化管理">
            <div className="proj-automation-modal__head">
              <h3>自动化管理</h3>
              <button type="button" className="create-colleague-close" onClick={() => setAutomationOpen(false)} aria-label="关闭">×</button>
            </div>
            <AutomationPanel onToast={onToast} />
          </div>
        </div>
      )}
      {inviteOpen && (
        <ProjectInputDialog
          title="添加项目成员"
          label="名称或邮箱"
          placeholder="例如：name@example.com"
          onCancel={() => setInviteOpen(false)}
          onConfirm={(name) => {
            addMember(live.id, name);
            setInviteOpen(false);
            setMembersOpen(false);
            onToast?.(`已添加本地成员：${name}`);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// 配置抽屉
// ============================================================

function ConfigDrawer({
  drawer, project, onClose, onOpenPicker, onOpenAutomation,
}: {
  drawer: DrawerKey;
  project: ProjectMeta;
  onClose: () => void;
  onOpenPicker: (k: "connectors" | "experts" | "skills") => void;
  onOpenAutomation: () => void;
}) {
  const updateConfig = useProjectsStore((s) => s.updateConfig);
  const updateProjectTags = useProjectsStore((s) => s.updateProjectTags);
  const card = CONFIG_CARDS.find((c) => c.key === drawer)!;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="create-colleague-dialog proj-drawer" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="create-colleague-header">
          <h3>{card.title}</h3>
          <button className="create-colleague-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="create-colleague-body">
          {drawer === "instruction" && (
            <textarea
              className="create-colleague-textarea"
              rows={8}
              value={project.instructions ?? ""}
              onChange={(e) => updateConfig(project.id, { instructions: e.target.value })}
              placeholder="设定项目背景与规范，让 AI 与你高效协作…"
              autoFocus
            />
          )}
          {drawer === "tags" && (
            <label className="proj-tags-editor">
              <span>项目标签（用逗号分隔）</span>
              <input
                className="pd-search-inline"
                value={project.tags?.join(", ") ?? ""}
                onChange={(event) => updateProjectTags(project.id, event.target.value.split(","))}
                placeholder="例如：客户、重点、邮件"
                autoFocus
              />
              <small>这是 OpenBuddy 本地工作区标签，不会修改 Gmail、Outlook 或其他邮箱的原生标签。</small>
            </label>
          )}
          {drawer === "connectors" && (
            <ConfigRow label="连接器" items={project.connectors} onAdd={() => onOpenPicker("connectors")} onRemove={(id) => updateConfig(project.id, { connectors: project.connectors.filter((x) => x.id !== id) })} />
          )}
          {drawer === "experts" && (
            <ConfigRow label="专家" items={project.experts} onAdd={() => onOpenPicker("experts")} onRemove={(id) => updateConfig(project.id, { experts: project.experts.filter((x) => x.id !== id) })} />
          )}
          {drawer === "skills" && (
            <ConfigRow label="技能" items={project.skills} onAdd={() => onOpenPicker("skills")} onRemove={(id) => updateConfig(project.id, { skills: project.skills.filter((x) => x.id !== id) })} />
          )}
          {drawer === "automation" && (
            <div className="proj-drawer-empty">
              <p>暂无自动化规则。</p>
              <button className="btn btn--ghost" onClick={onOpenAutomation}>打开自动化管理</button>
            </div>
          )}
        </div>
        <div className="create-colleague-footer">
          <button className="btn btn--primary" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 项目级 Composer 薄壳（左 Craft/Auto/技能/连接器 + 右 +/发送）
// ============================================================

function ProjectComposer({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };
  return (
    <div className="pd-composer">
      <textarea
        className="pd-composer__input"
        rows={1}
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
        <button className="pd-composer__chip">✎ Craft <ChevronDownIcon size="sm" /></button>
        <button className="pd-composer__chip">Ⓐ Auto <ChevronDownIcon size="sm" /></button>
        <button className="pd-composer__chip">⚡ 技能</button>
        <button className="pd-composer__chip">🔗 连接器 <ChevronDownIcon size="sm" /></button>
        <span className="pd-composer__spacer" />
        <button className="pd-composer__add" aria-label="更多">+</button>
        <button className="pd-composer__send" onClick={send} aria-label="发送" disabled={!text.trim()}>➤</button>
      </div>
    </div>
  );
}
