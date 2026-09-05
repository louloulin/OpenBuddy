import { lazy, Suspense } from "react";
import { AgentToolIcon } from "@openbuddy/ui-primitives/icons";
import { assistantWorkspaceSectionFromRoute } from "@openbuddy/ui-shared";
import { AssistantWorkbenchNav } from "@openbuddy/ui-shell";
import { invoke } from "@/lib/platform/electron-api";
import { useRendererContributions } from "@/lib/runtime/renderer-plugin-runtime";
import type { AgentEntry } from "@openbuddy/shared-types";
import type { ModelOption } from "@openbuddy/ui-workbench";
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
}: PlaceholderPageProps) {
  const assistantSection = assistantWorkspaceSectionFromRoute(label);
  const assistantExtension = useRendererContributions("assistant").find((contribution) => contribution.payload.route === label);
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

  if (label === "邮件") return <EmailPanel sessionId={sessionId} onNavigate={onNavigate} onToast={onToast} onLaunch={onLaunch ? (prompt) => onLaunch(prompt) : undefined} />;

  if (label === "项目") {
    return (
      <ProjectsPanel
        cwd={cwd}
        onSelectWorkspace={onSelectWorkspace}
        onToast={onToast}
        onStartProject={onStartProject}
        onStartProjectConversation={onStartProjectConversation}
        onNavigate={onNavigate}
      />
    );
  }

  if (label === "专家·技能·连接器") {
    // MarketplacePanel requires a `sessionId` to issue install/uninstall IPC
    // calls; without one the panel renders a yellow "open a session first"
    // banner and disables every action. Pass it through here so users can
    // install plugins the moment they enter the experts panel, instead of
    // having to bounce out to the home page.
    return (
      <ExpertsPanel
        onGoHome={onGoHome}
        onToast={onToast}
        sessionId={sessionId}
      />
    );
  }

  if (label === "自动化") {
    return <AutomationPanel onToast={onToast} onNavigate={onNavigate} />;
  }

  if (label === "发现") {
    return (
      <DiscoverPanel
        sessionId={sessionId}
        onLaunch={onLaunch}
        onToast={onToast}
      />
    );
  }

  if (label === "更多" || label === "资料库") {
    // Stage G-1c restoration: ResourcesPanel was removed when openbuddy-memory
    // Cordis backend was deleted. Replaced with an empty placeholder shell so
    // route navigation still resolves without breaking.
    return (
      <div className="placeholder-page placeholder-page--panel">
        <h2 className="settings-section__title">资料库</h2>
        <p className="settings-section__desc">
          资源目录由 pi-resource 接管；本视图在 pi-native 重建完成前先提供占位入口。
        </p>
      </div>
    );
  }

  // Stage G-1c restoration: InspirationPanel removed (openbuddy-inspiration
  // backend was deleted in Stage B-2; the panel depended on it). Route still
  // resolves, just shows a placeholder.
  if (label === "灵感") {
    return (
      <div className="placeholder-page placeholder-page--panel">
        <h2 className="settings-section__title">灵感</h2>
        <p className="settings-section__desc">
          灵感面板后端已迁移至 pi-native 插件；本视图暂时停用。
        </p>
      </div>
    );
  }

  if (label === "我的文件") {
    return <MyFilesPanel cwd={cwd} onToast={onToast} />;
  }

  // 知识库(可插拔源,对齐 WorkBuddy knowledge-base-panel)。
  if (label === "知识库") {
    return (
      <div className="placeholder-page placeholder-page--panel">
        <KnowledgeBasePanel
          onOpen={(id, url) => {
            if (url) {
              void invoke("open_path", { path: url, cwd: null }).catch(() => onToast?.(`无法打开知识条目：${id}`));
              return;
            }
            onToast?.(`打开知识条目 ${id}`);
          }}
          onToast={onToast}
        />
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
        <UsageQuotaPanel />
      </div>
    );
  }

  // 通知渠道(对齐 WorkBuddy IM 渠道)。
  if (label === "通知渠道") {
    return (
      <div className="placeholder-page placeholder-page--panel">
        <NotifyChannelsPanel onToast={onToast} />
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
        <CloudStoragePanel onToast={onToast} />
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

