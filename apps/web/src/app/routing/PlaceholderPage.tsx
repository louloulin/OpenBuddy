import { AgentResourcesPanel } from "../../features/agent-resources/AgentResourcesPanel";
import { AgentToolIcon } from "@openbuddy/ui/icon/icons/index";
import { LocalAssistantView } from "../../features/assistant/LocalAssistantView";
import { ProjectsPanel } from "../../features/projects/ProjectsPanel";
import { ExpertsPanel } from "../../features/experts";
import { AutomationPanel } from "../../features/automation/AutomationPanel";
import { ResourcesPanel } from "../../features/library/ResourcesPanel";
import { InspirationPanel } from "../../features/library/InspirationPanel";
import { MyFilesPanel } from "../../features/library/MyFilesPanel";
import { PluginsPanel } from "../../features/experts/PluginsPanel";
import { MarketplacePanel } from "../../features/experts/MarketplacePanel";
import { DiscoverPanel } from "../../features/experts/DiscoverPanel";
import { KnowledgeBasePanel } from "../../features/library/KnowledgeBasePanel";
import { BrowserPreview } from "../../features/workbench/BrowserPreview";
import { UsageQuotaPanel } from "../../features/settings/UsageQuotaPanel";
import { NotifyChannelsPanel } from "../../features/settings/NotifyChannelsPanel";
import { PolicySettingsPanel } from "../../features/settings/PolicySettingsPanel";
import { CloudStoragePanel } from "../../features/library/CloudStoragePanel";
import type { AgentEntry } from "@openbuddy/protocol/dto";
import type { ModelOption } from "../../features/models/ModelSelector";
import type { ProjectMeta } from "@/features/projects/state/projects-store";

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
  onSend?: (text: string, attachments?: { path: string }[]) => void | Promise<void>;
  /** 本地助理页：是否流式中。 */
  streaming?: boolean;
  /** 本地助理页：API 是否就绪。 */
  apiReady?: boolean;
  /** 本地助理页：打开设置。 */
  onOpenSettings?: () => void;
  /** 本地助理页：模型选择器（与聊天页一致）。 */
  modelId?: string;
  models?: ModelOption[];
  onModelChange?: (id: string) => void | Promise<void>;
  /** 项目页：进入项目（新建会话并注入说明）。 */
  onStartProject?: (project: ProjectMeta) => void;
  
  onStartProjectConversation?: (projectId: string, message: string) => void;
}

/** WorkBuddy 独有功能面板（助理/专家·技能·连接器/项目/自动化/资料库/插件·市场/发现）。 */
export function PlaceholderPage({
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
  streaming,
  apiReady,
  onOpenSettings,
  modelId,
  models,
  onModelChange,
  onStartProject,
  onStartProjectConversation,
}: PlaceholderPageProps) {
  if (label === "技能与 MCP") return <AgentResourcesPanel cwd={cwd} sessionId={sessionId} onToast={onToast} />;

  if (label === "助理") {
    return (
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
    );
  }

  if (label === "项目") {
    return (
      <ProjectsPanel
        cwd={cwd}
        onSelectWorkspace={onSelectWorkspace}
        onToast={onToast}
        onStartProject={onStartProject}
        onStartProjectConversation={onStartProjectConversation}
      />
    );
  }

  if (label === "专家·技能·连接器") {
    return <ExpertsPanel onGoHome={onGoHome} onToast={onToast} />;
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

  if (label === "插件·市场") {
    return (
      <PluginsMarketTabs
        sessionId={sessionId}
        onToast={onToast}
      />
    );
  }

  if (label === "更多" || label === "资料库") {
    return <ResourcesPanel cwd={cwd} onToast={onToast} initialTab="library" />;
  }

  if (label === "灵感") {
    return <InspirationPanel cwd={cwd} onToast={onToast} onLaunch={onLaunch ? (p: string) => onLaunch(p) : undefined} />;
  }

  if (label === "我的文件") {
    return <MyFilesPanel cwd={cwd} onToast={onToast} />;
  }

  // 知识库(可插拔源,对齐 WorkBuddy knowledge-base-panel)。
  if (label === "知识库") {
    return (
      <div className="placeholder-page placeholder-page--panel">
        <KnowledgeBasePanel
          onOpen={(id) => onToast?.(`打开知识条目 ${id}`)}
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

  // 其他功能显示占位页面
  return (
    <div className="placeholder-page">
      <AgentToolIcon size="xl" color="var(--wb-text-tertiary)" />
      <h2 className="placeholder-page__title">{label}</h2>
      <p className="placeholder-page__desc">该功能即将上线,敬请期待</p>
    </div>
  );
}

/** 双 tab 容器：插件（已安装）/ 市场（可浏览安装）。 */
import { useState } from "react";
import { PuzzlePieceIcon, RepoIcon } from "@openbuddy/ui/icon/icons/index";
function PluginsMarketTabs({
  sessionId,
  onToast,
}: {
  sessionId?: string;
  onToast?: (msg: string) => void;
}) {
  const [tab, setTab] = useState<"plugins" | "marketplace">("plugins");
  return (
    <div className="plugins-market-wrap">
      <div className="plugins-market-tabs">
        <button
          className={`plugins-market-tab ${tab === "plugins" ? "plugins-market-tab--active" : ""}`}
          onClick={() => setTab("plugins")}
        >
          <PuzzlePieceIcon size="sm" /> 插件
        </button>
        <button
          className={`plugins-market-tab ${tab === "marketplace" ? "plugins-market-tab--active" : ""}`}
          onClick={() => setTab("marketplace")}
        >
          <RepoIcon size="sm" /> 市场
        </button>
      </div>
      {tab === "plugins" ? (
        <PluginsPanel sessionId={sessionId} onToast={onToast} />
      ) : (
        <MarketplacePanel sessionId={sessionId} onToast={onToast} />
      )}
    </div>
  );
}
