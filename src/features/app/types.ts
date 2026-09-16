/**
 * src/features/app/types.ts
 *
 * Phase 1 — 微内核激活
 * AppShell 的运行时类型契约。把 1757 行 App.tsx 拆解为
 * 「AppShell(JSX) + useAppShellRuntime(状态/IPC) + chrome(纯展示)」三件套，
 * 整个 AppShell 通过单一 `AppShellRuntime` 对象消费 hook 暴露的状态与回调。
 *
 * 设计原则（参考 PI-Desktop 的 `useAppShellRuntime`）：
 *   - 所有 useState / useRef / useEffect / useCallback 集中在 hook 内
 *   - AppShell 组件只接收 props 并渲染
 *   - chrome.tsx 内的子组件是纯展示，不订阅 store
 *   - 类型集中在 types.ts，避免循环依赖
 */

import type { Dispatch, SetStateAction } from "react";
import type { InitResult, WorkspaceInfo } from "@/lib/agent/pi-client";
import type { ModelOption } from "@openbuddy/ui-workbench";
import type { CasdoorSessionView } from "@/lib/casdoor/casdoor-client";
import type { CasdoorLifecycleEvent } from "@openbuddy/auth-casdoor";
import type { UserContentPart } from "@/stores/session-store";
import type { ProjectMeta } from "@/stores/projects-store";
import type { AgentEntry } from "@openbuddy/shared-types";

/** 设置面板内嵌的子区域选择。 */
export type SettingsSection =
  | "model"
  | "account"
  | "shortcuts"
  | "personalize"
  | "assistant"
  | "agent-settings"
  | "data"
  | "security"
  | "help"
  | "general"
  | "notifications"
  | "linking"
  | "members"
  | "policy"
  | "resources"
  | "sessions"
  | "introspect"
  | "health"
  | "agent-mail"
  | "billing"
  | "pricing"
  | "reconciliation"
  | "wallet"
  | "webhooks";

/** 一条 toast 的可选 action 描述（与 toast-store 的 shape 对齐）。 */
export interface ToastActionSpec {
  label: string;
  hint?: string;
  onClick: () => void;
}

/** 一次 toast 推送的可选参数（与 toast-store 的 setToast API 对齐）。 */
export interface ToastOptions {
  action?: ToastActionSpec;
  kind?: "info" | "warning" | "error";
  ttlMs?: number;
  id?: string;
}

/** extension widgets / status 注入的 UI 数据（由 useAgentSession 写入）。 */
export interface ExtensionUiBySession {
  statuses: Record<string, string>;
  widgets: Record<string, string[]>;
  workingMessage?: string;
  workingVisible?: boolean;
  workingIndicator?: unknown;
  hiddenThinkingLabel?: string;
  toolsExpanded?: boolean;
}

/** useAgentSession 暴露给 AppShell 的事件订阅 / 重订阅句柄。 */
export interface AgentSessionEvents {
  resubscribe(): Promise<void>;
  truncations: Map<string, import("@/components/TruncationBanner").TruncationInfo>;
  dismissTruncation(sessionId: string): void;
  restoreTruncation(sessionId: string): Promise<void>;
}

/**
 * AppShell 运行时上下文 — 由 useAppShellRuntime() 返回。
 *
 * AppShell 组件必须消费的对象。包含：
 *   - 一次性 IPC 结果 (init, initError)
 *   - UI 状态机 (settingsOpen, searchOpen, aboutOpen, sidebarCollapsed, ...)
 *   - 数据快照 (currentSessionId, currentTitle, models, workspaces, ...)
 *   - 业务回调 (handleSendNew, handleSelectSession, handleModelChange, ...)
 *
 * 不包含：
 *   - 任何 React 内部 state setter（除非 setter 也需要被外部组件消费）
 *   - zustand store hooks（AppShell 通过 selector 自行订阅 store）
 */
export interface AppShellRuntime {
  // ---- 启动状态 -----------------------------------------------------------
  init: InitResult | null;
  initError: string | null;
  apiReady: boolean;

  // ---- toast 队列（AppShell 直接渲染）-----------------------------------
  toastQueue: readonly import("@/stores/toast-store").ToastEntry[];
  dismissToast(id: string): void;

  // ---- 快捷键面板 -------------------------------------------------------
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsSection: Dispatch<SetStateAction<SettingsSection>>;
  settingsSection: SettingsSection;

  // ---- 弹层/对话框 -------------------------------------------------------
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  searchOpen: boolean;
  aboutOpen: boolean;
  trustRequest: { cwd?: string; reason?: string } | null;
  placeholderView: string | null;

  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  setAboutOpen: Dispatch<SetStateAction<boolean>>;
  setTrustRequest: Dispatch<SetStateAction<{ cwd?: string; reason?: string } | null>>;
  setPlaceholderView: Dispatch<SetStateAction<string | null>>;

  // ---- 侧栏折叠 -----------------------------------------------------------
  sidebarCollapsed: boolean;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;

  // ---- 模型/工作空间 ------------------------------------------------------
  currentModelId: string | undefined;
  setCurrentModelId: Dispatch<SetStateAction<string | undefined>>;
  models: ModelOption[];
  workspaces: WorkspaceInfo[];
  switchingWorkspace: string | null;

  // ---- 会话/标题 ----------------------------------------------------------
  currentSessionId: string | undefined;
  currentTitle: string;
  streaming: boolean;

  // ---- Casdoor ------------------------------------------------------------
  casdoorSession: CasdoorSessionView | null;

  // ---- 任务面板刷新信号 ---------------------------------------------------
  taskRefreshSignal: number;

  // ---- extension 文本/UI -------------------------------------------------
  extensionText: string;
  extensionTextNonce: number;
  extensionUiBySession: Record<string, ExtensionUiBySession>;

  // ---- 桥状态 ------------------------------------------------------------
  notifyBridgeUnavailable(): void;

  // ---- 业务回调 -----------------------------------------------------------
  openSettings(section?: SettingsSection): void;
  showToast(message: string): void;
  setToast(message: string, opts?: ToastOptions): void;
  /** R15 — 恢复历史功能:打开「设置 → 账户管理」+ 刷新 casdoor 状态 +
   *  未登录时自动拉起 Casdoor 登录页。左下角用户按钮/账户菜单走这条路径。 */
  openAccountSettings(): void;
  /** R15 — 触发 casdoor 企业登录(打开 Casdoor 浏览器窗口)。 */
  handleLogin(): Promise<void>;
  /** R15 — 触发 casdoor 登出。 */
  handleLogout(): Promise<void>;

  // 导航/视图
  handleNavigate(label: string): void;
  handleGoHome(): void;
  handleNewSession(): void;
  handlePlaceholder(label: string): void;
  handleOpenProjectFromSidebar(projectId: string): void;

  // 会话操作
  handleSendNew(text: string, content?: UserContentPart[]): Promise<void>;
  handleSendCurrent(text: string): Promise<void>;
  handleSendContent(content: UserContentPart[]): Promise<void>;
  handleCancel(): Promise<void>;
  handleSelectSession(sessionId: string, sessionCwd?: string): Promise<void>;
  handleToggleWorkspace(cwd: string, next: boolean): Promise<void>;
  handleRenameTitle(newTitle: string): Promise<void>;
  handleModelChange(modelId: string): Promise<void>;
  handleSelectWorkspace(newCwd: string): void;
  handleRewound(): Promise<void>;
  handleForked(newId: string): void;
  handleStartWithExpert(agent: AgentEntry, meta?: { expertId?: string; source?: string }): void;
  handleLaunchDiscover(prompt: string, agent?: AgentEntry): Promise<void>;
  handleStartProject(project: ProjectMeta): Promise<void>;
  handleStartProjectConversation(projectId: string, message?: string): Promise<void>;
  handleSelectEmailFromSearch(accountId: string, threadId: string): void;
  handleSelectKnowledgeFromSearch(entryId: string, url?: string): void;

  // 模型刷新
  refreshModels(): Promise<void>;

  // agent session 事件
  sessionEvents: AgentSessionEvents;
}

/** useShellKeyboardShortcuts hook 的选项 — 全局快捷键绑定。 */
export interface ShellKeyboardShortcutsOptions {
  onToggleShortcuts(): void;
  onToggleSearch(): void;
  onToggleSettings(): void;
  onToggleSidebarCollapse?(): void;
}
