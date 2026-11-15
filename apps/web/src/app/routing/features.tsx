import { Bot, Brain, Cpu, HardDrive, HelpCircle, Keyboard, Mail, Palette, Settings2, Shield, SlidersHorizontal, User } from "lucide-react";
import {
  LibraryIcon, MoreMenuImaKnowledgeIcon, MoreMenuInspirationIcon, MyFilesIconV2,
  WbAssistantNavIcon, WbAutomationNavIcon, WbExpertNavIcon, WbProjectNavIcon,
} from "@openbuddy/ui/icon/icons/index";
import type { AgentEntry } from "@openbuddy/protocol/dto";
import { openPath } from "@openbuddy/client/api/files";
import type { ModelOption } from "../../features/models/ModelSelector";
import type { ProjectMeta } from "../../features/projects/state/projects-store";
import { LocalAssistantView } from "../../features/assistant/LocalAssistantView";
import { ProjectsPanel } from "../../features/projects/ProjectsPanel";
import { AutomationPanel } from "../../features/automation/AutomationPanel";
import { ResourcesPanel } from "../../features/library/ResourcesPanel";
import { InspirationPanel } from "../../features/library/InspirationPanel";
import { MyFilesPanel } from "../../features/library/MyFilesPanel";
import { KnowledgeBasePanel } from "../../features/library/KnowledgeBasePanel";
import { CloudStoragePanel } from "../../features/library/CloudStoragePanel";
import { DiscoverPanel } from "../../features/experts/DiscoverPanel";
import { BrowserPreview } from "../../features/workbench/BrowserPreview";
import { UsageQuotaPanel } from "../../features/settings/UsageQuotaPanel";
import { NotifyChannelsPanel } from "../../features/settings/NotifyChannelsPanel";
import { PolicySettingsPanel } from "../../features/settings/PolicySettingsPanel";
import { ModelsSettingsPanel } from "../../features/models/settings/ModelsSettingsPanel";
import {
  AccountSettingsPanel, AgentMailSettingsPanel, AgentSettingsPanel, AssistantSettingsPanel, DataSettingsPanel,
  GeneralSettingsPanel, HelpSettingsPanel, MemorySettingsPanel, PersonalizeSettingsPanel, SecuritySettingsPanel,
  ShortcutsSettingsPanel,
} from "../../features/settings/SettingsSections";
import { ExpertsHub } from "./ExpertsHub";
import { PluginsMarketTabs } from "./PluginsMarketTabs";
import { CAPABILITY_FEATURES } from "./capability-features";
import type { FeatureEntry } from "./registry";

/** What PlaceholderPage hands to a feature's route (everything the App wires into panels). */
export interface FeatureRouteProps {
  onPlaceholder?: (label: string) => void;
  /** Navigate to another view (e.g. 自动化 → 管理连接器 → 专家·技能·连接器). */
  onNavigate?: (label: string) => void;
  onGoHome?: () => void;
  onStartWithExpert?: (agent: AgentEntry, meta?: { expertId?: string; source?: string }) => void;
  onToast?: (message: string) => void;
  cwd?: string;
  onSelectWorkspace?: (cwd: string) => void;
  sessionId?: string;
  onLaunch?: (prompt: string, agent?: AgentEntry) => void;
  onSend?: (text: string, attachments?: { path: string }[]) => void | Promise<void>;
  streaming?: boolean;
  apiReady?: boolean;
  onOpenSettings?: () => void;
  modelId?: string;
  models?: ModelOption[];
  onModelChange?: (id: string) => void | Promise<void>;
  onStartProject?: (project: ProjectMeta) => void;
  onStartProjectConversation?: (projectId: string, message: string) => void;
}

const panel = (node: React.ReactNode) => <div className="placeholder-page placeholder-page--panel">{node}</div>;

/**
 * Every entry point of the app (pii W0.2). `requires` names host commands as the renderer
 * calls them, so entries light up as soon as their module lands:
 * 我的专家 → agents_list · 专家中心 → experts_load · 连接器目录 → connectors_load ·
 * 技能目录 → skills_catalog_load · 自动化 → automations_snapshot · 资料库 / 记忆 → memory_list ·
 * 全文搜索 → session_search · 计划面板 → event agent://plan.
 */
export const FEATURES: FeatureEntry<FeatureRouteProps>[] = [
  // ---- primary sidebar (WorkBuddy order: 专家·技能·连接器 / 自动化 / 资料库 / 项目) ----
  {
    id: "experts-hub",
    nav: { label: "专家·技能·连接器", slot: "primary", order: 10, icon: WbExpertNavIcon },
    // "技能与 MCP" was its own sidebar entry; it is now the 技能 / 连接器 / 扩展 tabs here (U7.6).
    route: { view: "专家·技能·连接器", aliases: ["技能与 MCP"], render: (p) => <ExpertsHub cwd={p.cwd} sessionId={p.sessionId} onGoHome={p.onGoHome} onToast={p.onToast} /> },
    requires: ["skills_list", "mcp_config_read", "agent_extensions_list"],
  },
  // 我的专家 / 专家中心 / 技能目录 / 连接器目录 (tabs of the hub), 全文搜索, 计划面板.
  ...CAPABILITY_FEATURES,
  {
    id: "automation",
    nav: { label: "自动化", slot: "primary", order: 20, icon: WbAutomationNavIcon },
    route: { view: "自动化", render: (p) => <AutomationPanel onToast={p.onToast} onNavigate={p.onNavigate} /> },
    requires: ["automations_snapshot"],
  },
  {
    id: "library",
    nav: { label: "资料库", slot: "primary", order: 30, icon: LibraryIcon },
    route: { view: "资料库", aliases: ["更多"], render: (p) => <ResourcesPanel cwd={p.cwd} onToast={p.onToast} initialTab="library" /> },
    requires: ["memory_list"],
  },
  {
    id: "projects",
    nav: { label: "项目", slot: "primary", order: 40, icon: WbProjectNavIcon },
    route: { view: "项目", render: (p) => <ProjectsPanel cwd={p.cwd} onSelectWorkspace={p.onSelectWorkspace} onToast={p.onToast} onStartProject={p.onStartProject} onStartProjectConversation={p.onStartProjectConversation} /> },
    requires: ["agent_new_session"],
  },
  {
    id: "assistant",
    nav: { label: "助理", slot: "primary", order: 50, icon: WbAssistantNavIcon },
    route: { view: "助理", render: (p) => <LocalAssistantView onSend={p.onSend ?? (() => {})} streaming={p.streaming ?? false} apiReady={p.apiReady ?? true} onOpenSettings={p.onOpenSettings} onPlaceholder={p.onPlaceholder} modelId={p.modelId} models={p.models} onModelChange={p.onModelChange} /> },
    requires: [],
    offline: "§9-D3：先删除入口，W5 之后再评估常驻助理",
  },
  // ---- 更多 menu ----
  {
    id: "my-files",
    nav: { label: "我的文件", slot: "more", order: 10, icon: MyFilesIconV2 },
    route: { view: "我的文件", render: (p) => <MyFilesPanel cwd={p.cwd} onToast={p.onToast} /> },
    requires: ["list_dir", "open_path"],
  },
  {
    id: "knowledge-base",
    nav: { label: "知识库", slot: "more", order: 20, icon: MoreMenuImaKnowledgeIcon },
    // Opening an entry used to only show a toast; local entries carry their file path.
    route: { view: "知识库", render: (p) => panel(<KnowledgeBasePanel onToast={p.onToast} onOpen={(_id, url) => { if (url) void openPath(url).catch(() => p.onToast?.("无法打开该文件，请重新添加知识源后再试")); }} />) },
    requires: ["list_dir"],
  },
  {
    id: "usage",
    nav: { label: "用量统计", slot: "more", order: 30, icon: MoreMenuInspirationIcon },
    route: { view: "用量统计", render: () => panel(<UsageQuotaPanel />) },
    requires: [],
  },
  {
    id: "notify-channels",
    nav: { label: "通知渠道", slot: "more", order: 40, icon: MoreMenuInspirationIcon },
    route: { view: "通知渠道", render: (p) => panel(<NotifyChannelsPanel onToast={p.onToast} />) },
    requires: [],
  },
  {
    id: "browser-preview",
    nav: { label: "网页预览", slot: "more", order: 50, icon: MoreMenuInspirationIcon },
    route: { view: "网页预览", render: () => panel(<BrowserPreview url="" />) },
    requires: ["open_url"],
    offline: "没有地址来源的空白预览；随 W1.9 产物尾项再评估",
  },
  {
    id: "inspiration",
    nav: { label: "灵感", slot: "more", order: 60, icon: MoreMenuInspirationIcon },
    route: { view: "灵感", render: (p) => <InspirationPanel cwd={p.cwd} onToast={p.onToast} onLaunch={p.onLaunch ? (prompt: string) => p.onLaunch!(prompt) : undefined} /> },
    requires: ["inspiration_generate"],
  },
  {
    id: "policy",
    nav: { label: "策略设置", slot: "more", order: 70, icon: MoreMenuInspirationIcon },
    route: { view: "策略设置", render: (p) => panel(<PolicySettingsPanel onToast={p.onToast} />) },
    requires: [],
    offline: "规则从未生效（checkPolicy 没有调用方）；W6 并入安全中心",
  },
  {
    id: "cloud-storage",
    nav: { label: "云存储", slot: "more", order: 80, icon: MoreMenuInspirationIcon },
    route: { view: "云存储", render: (p) => panel(<CloudStoragePanel onToast={p.onToast} />) },
    requires: [],
    offline: "§9 仍然不做：云存储",
  },
  // ---- views without a nav item ----
  {
    id: "discover",
    route: { view: "发现", render: (p) => <DiscoverPanel sessionId={p.sessionId} onLaunch={p.onLaunch} onToast={p.onToast} /> },
    requires: ["agents_list", "mcp_list", "skills_list"],
  },
  {
    id: "plugins-market",
    route: { view: "插件·市场", render: (p) => <PluginsMarketTabs sessionId={p.sessionId} onToast={p.onToast} /> },
    requires: ["plugins_list", "marketplace_list"],
  },
  // ---- settings sections ----
  { id: "settings-account", settingsSections: [{ id: "account", label: "账户管理", icon: User, order: 10, render: () => <AccountSettingsPanel /> }], requires: ["account_get_api_key", "agent_auth_status"] },
  { id: "settings-agent-mail", settingsSections: [{ id: "agent-mail", label: "智能体邮箱", icon: Mail, order: 20, render: () => <AgentMailSettingsPanel /> }], requires: ["notification_list"] },
  { id: "settings-shortcuts", settingsSections: [{ id: "shortcuts", label: "快捷键", icon: Keyboard, order: 30, render: () => <ShortcutsSettingsPanel /> }], requires: [] },
  { id: "settings-model", settingsSections: [{ id: "model", label: "模型", icon: Cpu, order: 40, render: (p) => <ModelsSettingsPanel onModelsChanged={p.onModelsChanged} /> }], requires: ["providers_list"] },
  { id: "settings-memory", settingsSections: [{ id: "memory", label: "记忆", icon: Brain, order: 45, render: () => <MemorySettingsPanel /> }], requires: ["memory_list", "memory_rewrite"] },
  { id: "settings-assistant", settingsSections: [{ id: "assistant", label: "助理设置", icon: Bot, order: 50, render: () => <AssistantSettingsPanel /> }], requires: ["agents_defaults_get"] },
  { id: "settings-agent", settingsSections: [{ id: "agent-settings", label: "智能体设置", icon: Settings2, order: 55, render: () => <AgentSettingsPanel /> }], requires: ["subagents_config_get", "web_search_config_get"] },
  { id: "settings-personalize", settingsSections: [{ id: "personalize", label: "个性化", icon: Palette, order: 60, render: () => <PersonalizeSettingsPanel /> }], requires: [] },
  { id: "settings-security", settingsSections: [{ id: "security", label: "安全中心", icon: Shield, order: 70, render: () => <SecuritySettingsPanel /> }], requires: ["permission_list"] },
  {
    id: "settings-data",
    settingsSections: [{ id: "data", label: "数据管理", icon: HardDrive, order: 75, render: () => <DataSettingsPanel /> }],
    requires: [],
    offline: "只清理一个没有任何代码读取的本地缓存键，数据目录也是写死的提示；W6 设置重排时重做",
  },
  { id: "settings-help", settingsSections: [{ id: "help", label: "帮助与反馈", icon: HelpCircle, order: 80, render: () => <HelpSettingsPanel /> }], requires: [] },
  { id: "settings-general", settingsSections: [{ id: "general", label: "系统设置", icon: SlidersHorizontal, order: 85, render: () => <GeneralSettingsPanel /> }], requires: ["internal_reload"] },
];

/**
 * The labels App.tsx used to block with a toast (`App.tsx:415`, "暂未在 Electron MVP 开放").
 * Kept for reference (plan D8); the registry's `requires` / `offline` now decide.
 */
export const LEGACY_BLOCKED_VIEWS = ["助理", "专家·技能·连接器", "自动化", "资料库", "灵感", "云存储"] as const;

export const featureById = (id: string) => FEATURES.find((entry) => entry.id === id);
