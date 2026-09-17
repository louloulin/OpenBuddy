import { lazy, Suspense, useCallback } from "react";
import { AgentToolIcon } from "@openbuddy/ui-primitives/icons";
import { assistantWorkspaceSectionFromRoute } from "@openbuddy/ui-shared";
import { AssistantWorkbenchNav } from "@openbuddy/ui-shell";
import { invoke } from "@/lib/platform/electron-api";
import { useRendererContributions } from "@/lib/runtime/renderer-plugin-runtime";
import { useSlotComponent } from "@/features/app/slot-bridge";
import type { AgentEntry } from "@openbuddy/shared-types";
import type { ModelOption } from "@openbuddy/ui-workbench";
import { EXPERTS_ROUTE_LABEL } from "@/lib/navigation/placeholder-routes";
import type { ProjectMeta } from "@/stores/projects-store";

/**
 * 面板统一 React.lazy 化(PanelRouter 收敛方向的第一步)。
 * 能否真正拆出主 chunk 由 Rollup 依据全图静态引用决定——当前 ui-email/ui-files
 * 可拆;ui-workbench/ui-collaboration/ui-experts/ui-automation 被 ui-conversation
 * 静态拖住、ui-mcp/ui-billing 被 ui-settings 拖住,拆不动但 lazy 无成本,
 * 待 A2/A3 分层债收敛后自动生效。
 */
const LocalAssistantView = lazy(() => import("@openbuddy/ui-workbench").then((m) => ({ default: m.LocalAssistantView })));
const AssistantWorkspacePanel = lazy(() => import("@openbuddy/ui-workbench").then((m) => ({ default: m.AssistantWorkspacePanel })));
const AssistantExtensionPanel = lazy(() => import("@openbuddy/ui-workbench").then((m) => ({ default: m.AssistantExtensionPanel })));
const BrowserPreview = lazy(() => import("@openbuddy/ui-workbench").then((m) => ({ default: m.BrowserPreview })));
const ProjectsPanel = lazy(() => import("@openbuddy/ui-collaboration").then((m) => ({ default: m.ProjectsPanel })));
// Phase 7 — WorkBuddy 风格项目模板入口 + 9 卡 3 列专家网格直接导入,
// 与 ui-collaboration/ExpertsPanel 的 lazy 边界区分开,避免 home overview 与
// placeholder 视图互相拖入对方的 chunk。
import { ProjectTemplatesPanel } from "@openbuddy/ui-home";

// 这些面板同时是「内核槽位的内置 fallback」:第三方插件可以用更高 priority
// 注册同名 `placeholder.*` 槽来整体替换某个页面(企业内网文件柜、自研邮件
// 客户端、私有市场……),而内置实现仍是底座。因此这里用 lazy 保持 chunk 边界,
// 渲染时统一走 `useSlotComponent(name, <built-in>)`。
const ExpertsPanel = lazy(() => import("@openbuddy/ui-experts").then((m) => ({ default: m.ExpertsPanel })));
const AutomationPanel = lazy(() => import("@openbuddy/ui-automation").then((m) => ({ default: m.AutomationPanel })));
const MyFilesPanel = lazy(() => import("@openbuddy/ui-files").then((m) => ({ default: m.MyFilesPanel })));
const KnowledgeBasePanel = lazy(() => import("@openbuddy/ui-files").then((m) => ({ default: m.KnowledgeBasePanel })));
const CloudStoragePanel = lazy(() => import("@openbuddy/ui-files").then((m) => ({ default: m.CloudStoragePanel })));
const DiscoverPanel = lazy(() => import("@openbuddy/ui-mcp").then((m) => ({ default: m.DiscoverPanel })));
const NotifyChannelsPanel = lazy(() => import("@openbuddy/ui-mcp").then((m) => ({ default: m.NotifyChannelsPanel })));
const UsageQuotaPanel = lazy(() => import("@openbuddy/ui-billing").then((m) => ({ default: m.UsageQuotaPanel })));
const EmailPanel = lazy(() => import("@openbuddy/ui-email").then((m) => ({ default: m.EmailPanel })));
const PolicySettingsPanel = lazy(() => import("@openbuddy/ui-settings").then((m) => ({ default: m.PolicySettingsPanel })));
// R37 — 资料库页整体走内核 `placeholder.library` 槽(ui-library 注册默认实现)。
const LibraryPage = lazy(() => import("@openbuddy/ui-library").then((m) => ({ default: m.LibraryPage })));

interface PlaceholderPageProps {
  label: string;
  onPlaceholder?: (label: string) => void;
  /** Navigate to another sidebar view (e.g. 自动化 → 管理连接器 → 专家·技能·连接器). */
  onNavigate?: (label: string) => void;
  /** Navigate to the home page (used after expert summon). */
  onGoHome?: () => void;
  /** Start a new chat guided by an expert/assistant definition. */
  onStartWithExpert?: (agent: AgentEntry, meta?: { expertId?: string; source?: string }) => void;
  /** Surface transient feedback (errors, success toasts). */
  onToast?: (message: string) => void;
  /** Current cwd (for memory workspace scope, projects panel). */
  cwd?: string;
  /** Switch the active workspace (projects panel). */
  onSelectWorkspace?: (cwd: string) => void;
  /** Current session id (for plugins/marketplace actions that need a session). */
  sessionId?: string;
  /** Discover launcher: open a new session + send prompt (optionally with agent). */
  onLaunch?: (prompt: string, agent?: AgentEntry) => void;
  /** 本地助理页：发送消息（新建会话）。 */
  onSend?: (text: string) => void;
  /** R1 — content-based send (text + image). 当本地助理页附加图片时,
   *  通过 piSendContent 走 vision path。 */
  onSendContent?: (content: Array<{ type: "text"; text: string } | { type: "image"; mediaType: string; data: string; name?: string }>) => void | Promise<void>;
  /** 本地助理页：是否流式中。 */
  streaming?: boolean;
  /** 本地助理页：API 是否就绪。 */
  apiReady?: boolean;
  /** 本地助理页：打开设置。 */
  onOpenSettings?: () => void;
  /** 本地助理页：模型选择器（与聊天页一致）。 */
  modelId?: string;
  models?: ModelOption[];
  onModelChange?: (id: string) => void;
  /** 项目页：进入项目（新建会话并注入说明）。 */
  onStartProject?: (project: ProjectMeta) => void;
  /** 项目页：在项目中新建对话（创建真实 pi 会话）。 */
  onStartProjectConversation?: (projectId: string, message: string) => void;
  /** R42 — WorkBuddy v5.4.7 左侧「任务」栏点击会话的回调。 */
  onSelectSession?: (sessionId: string, cwd?: string) => void;
}

/** WorkBuddy 独有功能面板（助理/专家·技能·连接器/项目/自动化/资料库/插件·市场/发现）。 */
export function PlaceholderPage(props: PlaceholderPageProps) {
  return (
    <Suspense fallback={<PanelSuspenseFallback label={props.label} />}>
      <PlaceholderPageInner {...props} />
    </Suspense>
  );
}

function PanelSuspenseFallback({ label }: { label: string }) {
  return (
    <div className="placeholder-page placeholder-page--panel" aria-busy="true">
      <p className="placeholder-page__desc">正在加载「{label}」…</p>
    </div>
  );
}

function PlaceholderPageInner({
  label,
  onPlaceholder,
  onNavigate,
  onGoHome,
  onToast,
  cwd,
  onSelectWorkspace,
  sessionId,
  onLaunch,
  onSend,
  onSendContent,
  streaming,
  apiReady,
  onOpenSettings,
  modelId,
  models,
  onModelChange,
  onStartProject,
  onStartProjectConversation,
  onSelectSession,
}: PlaceholderPageProps) {
  const assistantSection = assistantWorkspaceSectionFromRoute(label);
  const assistantExtension = useRendererContributions("assistant").find((contribution) => contribution.payload.route === label);
  // 「专家·技能·连接器」整块走内核 `experts.panel` 槽:插件可以注册更高优先级
  // 实现整体替换这个面板(例如换成企业内部的专家目录)。必须在所有 early return
  // 之前调用 hook —— 与下面 `files.tree` / `editor.body` 的接线方式一致。
  const ExpertsPanelSlot = useSlotComponent("experts.panel", ExpertsPanel);
  // R92 — 下面这些页面此前是**直接 import 渲染**的,于是 ui-files / ui-email /
  // ui-mcp / ui-billing / ui-collaboration 注册的 `placeholder.*` 槽从来没有
  // 消费方:插件能注册成功,界面却永远不变。现在每条路由都先问内核要实现,
  // 拿不到才回落到内置组件,插件才真正具备「整体替换某个页面」的能力。
  const EmailSlot = useSlotComponent("placeholder.email", EmailPanel);
  const ProjectsSlot = useSlotComponent("placeholder.projects", ProjectsPanel);
  const MyFilesSlot = useSlotComponent("placeholder.my-files", MyFilesPanel);
  const KnowledgeBaseSlot = useSlotComponent("placeholder.knowledge-base", KnowledgeBasePanel);
  const CloudStorageSlot = useSlotComponent("placeholder.cloud-storage", CloudStoragePanel);
  const DiscoverSlot = useSlotComponent("placeholder.discover", DiscoverPanel);
  const NotifyChannelsSlot = useSlotComponent("placeholder.notify-channels", NotifyChannelsPanel);
  const UsageQuotaSlot = useSlotComponent("placeholder.usage-quota", UsageQuotaPanel);
  // R37 — 「资料库 / 更多」与「灵感」都落到资料库页:`灵感` 是它的一个分区
  // (`initialSection="inspiration"`),于是这个从 Stage G-1c 起一直空着的
  // 入口第一次有了真内容;插件注册更高优先级即可整体替换这一页。
  const LibrarySlot = useSlotComponent("placeholder.library", LibraryPage);

  // 知识条目打开:有 url 就交给系统打开,否则退化成提示。原先这段内联在
  // 「知识库」分支里,现在资料库分区与独立路由共用同一份实现。
  const openKnowledgeEntry = useCallback(
    (id: string, url?: string) => {
      if (url) {
        void invoke("open_path", { path: url, cwd: null }).catch(() =>
          onToast?.(`无法打开知识条目：${id}`),
        );
        return;
      }
      onToast?.(`打开知识条目 ${id}`);
    },
    [onToast],
  );
  if (label === "助理·本地助理") {
    return (
      <AssistantLocalWorkspace
        onNavigate={onNavigate}
        onGoHome={onGoHome}
        onSend={onSend}
        streaming={streaming}
        apiReady={apiReady}
        onOpenSettings={onOpenSettings}
        onPlaceholder={onPlaceholder}
        modelId={modelId}
        models={models}
        onModelChange={onModelChange}
      />
    );
  }
  if (assistantSection) {
    return (
      <AssistantWorkspacePanel
        section={assistantSection}
        onToast={onToast}
        onNavigate={onNavigate}
        onGoHome={onGoHome}
      />
    );
  }

  if (assistantExtension) {
    return <AssistantExtensionPanel contribution={assistantExtension} onToast={onToast} onGoHome={onGoHome} onNavigate={onNavigate} />;
  }

  if (label === "助理") {
    return (
      <AssistantHomePanel
        onNavigate={onNavigate}
        onSend={onSend}
        streaming={streaming}
        apiReady={apiReady}
        onOpenSettings={onOpenSettings}
        onPlaceholder={onPlaceholder}
        modelId={modelId}
        models={models}
        onModelChange={onModelChange}
      />
    );
  }

  if (label.startsWith("助理·")) {
    return (
      <AssistantHomePanel
        onNavigate={onNavigate}
        onSend={onSend}
        streaming={streaming}
        apiReady={apiReady}
        onOpenSettings={onOpenSettings}
        onPlaceholder={onPlaceholder}
        modelId={modelId}
        models={models}
        onModelChange={onModelChange}
      />
    );
  }

  if (label === "邮件") return <EmailSlot sessionId={sessionId} onNavigate={onNavigate} onToast={onToast} onLaunch={onLaunch ? (prompt) => onLaunch(prompt) : undefined} />;

  if (label === "项目") {
    return (
      <div className="placeholder-page-stack">
        <div className="project-templates-host">
          <ProjectTemplatesPanel />
        </div>
        <ProjectsSlot
          cwd={cwd}
          onSelectWorkspace={onSelectWorkspace}
          onToast={onToast}
          onStartProject={onStartProject}
          onStartProjectConversation={onStartProjectConversation}
          onNavigate={onNavigate}
        />
      </div>
    );
  }

  if (label === EXPERTS_ROUTE_LABEL) {
    // R42 — 完全复刻 WorkBuddy v5.4.7:左侧「任务」栏 + 右侧 4 列专家网格
    // 都由 ExpertsPanel 内部 .ec-page-split 提供。
    // 此前 Phase 7 在这里塞了一个 9 卡 3 列的 ExpertsGrid banner,
    // 但它跟新的 WorkBuddy 风格布局重复,而且高度 (~700px) 会把新的
    // 任务栏 + 4 列网格推到屏幕外 —— 用户看到的还是旧 banner,以
    // 为改造没生效。删除 banner,直接渲染 ExpertsPanel。
    return (
      <ExpertsPanelSlot
        onGoHome={onGoHome}
        onToast={onToast}
        sessionId={sessionId}
        onSelectSession={onSelectSession}
      />
    );
  }

  if (label === "自动化") {
    return <AutomationPanel onToast={onToast} onNavigate={onNavigate} />;
  }

  if (label === "发现") {
    return (
      <DiscoverSlot
        sessionId={sessionId}
        onLaunch={onLaunch}
        onToast={onToast}
      />
    );
  }

  // R37 — 资料库:我的文件 / 知识库 / 云存储 / 灵感 四个分区(内置也走
  // `library.section` 槽,插件可追加或顶替)。此前这里是空壳占位。
  if (label === "更多" || label === "资料库") {
    return (
      <LibrarySlot
        initialSection="my-files"
        cwd={cwd}
        sessionId={sessionId}
        onToast={onToast}
        onLaunch={onLaunch}
        onOpenKnowledge={openKnowledgeEntry}
      />
    );
  }

  // R37 — 「灵感」不再是停用页,它就是资料库的 inspiration 分区
  // (SceneTabs + PracticeCases,数据来自 HOME_MODES 这一份单一来源)。
  if (label === "灵感") {
    return (
      <LibrarySlot
        initialSection="inspiration"
        cwd={cwd}
        sessionId={sessionId}
        onToast={onToast}
        onLaunch={onLaunch}
        onOpenKnowledge={openKnowledgeEntry}
      />
    );
  }

  if (label === "我的文件") {
    return <MyFilesSlot cwd={cwd} onToast={onToast} />;
  }

  // 知识库(可插拔源,对齐 WorkBuddy knowledge-base-panel)。
  if (label === "知识库") {
    return (
      <div className="placeholder-page placeholder-page--panel">
        <KnowledgeBaseSlot onOpen={openKnowledgeEntry} onToast={onToast} />
      </div>
    );
  }

  // 网页预览(对齐 WorkBuddy browser-preview)。
  if (label === "网页预览") {
    return (
      <div className="placeholder-page placeholder-page--panel">
        <BrowserPreview url="" />
      </div>
    );
  }

  // 用量配额(对齐 WorkBuddy credit-usage)。
  if (label === "用量统计") {
    return (
      <div className="placeholder-page placeholder-page--panel">
        <UsageQuotaSlot />
      </div>
    );
  }

  // 通知渠道(对齐 WorkBuddy IM 渠道)。
  if (label === "通知渠道") {
    return (
      <div className="placeholder-page placeholder-page--panel">
        <NotifyChannelsSlot onToast={onToast} />
      </div>
    );
  }

  // 策略设置(对齐 WorkBuddy 企业策略)。
  if (label === "策略设置") {
    return (
      <div className="placeholder-page placeholder-page--panel">
        <PolicySettingsPanel onToast={onToast} />
      </div>
    );
  }

  // 云存储(对齐 WorkBuddy 腾讯 Drive)。
  if (label === "云存储") {
    return (
      <div className="placeholder-page placeholder-page--panel">
        <CloudStorageSlot onToast={onToast} />
      </div>
    );
  }

  // Keep unknown routes explicit rather than implying that a hidden feature is
  // already available; all supported routes above render their real panel.
  return (
    <div className="placeholder-page">
      <AgentToolIcon size="xl" color="var(--wb-text-tertiary)" />
      <h2 className="placeholder-page__title">{label}</h2>
      <p className="placeholder-page__desc">当前入口未配置可用功能。</p>
    </div>
  );
}

function AssistantHomePanel({
  onNavigate,
  onSend,
  streaming,
  apiReady,
  onOpenSettings,
  onPlaceholder,
  modelId,
  models,
  onModelChange,
}: Pick<PlaceholderPageProps, "onNavigate" | "onSend" | "streaming" | "apiReady" | "onOpenSettings" | "onPlaceholder" | "modelId" | "models" | "onModelChange">) {
  const goAssistantHome = onNavigate ? () => onNavigate("助理") : undefined;
  return (
    <div className="assistant-home">
      <header className="assistant-home__header">
        <div className="assistant-home__header-main">
          <h1>助理工作台</h1>
          <p>管理本地助理、跨项目协作和 Buddy 网络。</p>
        </div>
        <AssistantWorkbenchNav activeRoute="助理" onNavigate={onNavigate ?? (() => {})} onGoHome={goAssistantHome} />
      </header>
      <LocalAssistantView
        onSend={onSend ?? (() => {})}
        streaming={streaming ?? false}
        apiReady={apiReady ?? true}
        onOpenSettings={onOpenSettings}
        onPlaceholder={onPlaceholder}
        modelId={modelId}
        models={models}
        onModelChange={onModelChange}
      />
    </div>
  );
}

function AssistantLocalWorkspace({
  onNavigate,
  onGoHome,
  onSend,
  streaming,
  apiReady,
  onOpenSettings,
  onPlaceholder,
  modelId,
  models,
  onModelChange,
}: Pick<PlaceholderPageProps, "onNavigate" | "onGoHome" | "onSend" | "streaming" | "apiReady" | "onOpenSettings" | "onPlaceholder" | "modelId" | "models" | "onModelChange">) {
  const goAssistantHome = onNavigate ? () => onNavigate("助理") : onGoHome;
  return (
    <div className="assistant-workspace assistant-workspace--local">
      <header className="assistant-workspace__header">
        <div className="assistant-workspace__header-main">
          <button type="button" className="assistant-workspace__back" onClick={goAssistantHome}>助理</button>
          <span aria-hidden="true">›</span>
          <div><h1>本地助理</h1><p>直接与个人 Buddy 对话，发起本地任务或进入协作工作台。</p></div>
        </div>
        <AssistantWorkbenchNav activeRoute="助理·本地助理" onNavigate={onNavigate ?? (() => {})} onGoHome={goAssistantHome} />
      </header>
      <LocalAssistantView
        onSend={onSend ?? (() => {})}
        streaming={streaming ?? false}
        apiReady={apiReady ?? true}
        onOpenSettings={onOpenSettings}
        onPlaceholder={onPlaceholder}
        modelId={modelId}
        models={models}
        onModelChange={onModelChange}
      />
    </div>
  );
}
