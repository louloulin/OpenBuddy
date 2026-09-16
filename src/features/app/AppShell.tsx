/**
 * src/features/app/AppShell.tsx
 *
 * Phase 1 — 微内核激活（核心 JSX 容器）
 * 整个 app 的可视外壳。所有 UI 状态与业务回调都通过 `runtime: AppShellRuntime`
 * 传入；本组件不订阅任何 store、不持有任何 useState / useEffect。
 *
 * 渲染层级：
 *   <div className="app">
 *     <TitleBar /> (Linux/Windows 自绘, macOS 由系统接管)
 *     <div className="app__body">
 *       <Sidebar />
 *       <main className="app__main">
 *         <Topbar />  (对话页可见 / 折叠时浮动)
 *         <MainContent />  (init notice / placeholder / chat / home)
 *       </main>
 *     </div>
 *     <Toast entries />
 *     <Suspense>
 *       <SearchOverlay /> <SettingsPanel /> <AboutDialog /> ...
 *     </Suspense>
 *     <KeyboardShortcutsDialog />
 *   </div>
 *
 * 参考 PI-Desktop `apps/desktop/src/features/app/AppShell.tsx` 的结构。
 */

import { lazy, memo, Suspense, useMemo, type ComponentType } from "react";
import { GlobalConfirmHost } from "@/components/GlobalConfirmHost";
import { TitleBar } from "@openbuddy/ui-shell";
import { TopbarActions, TopbarTitle, KeyboardShortcutsDialog } from "@openbuddy/ui-shell";
import { Sidebar } from "@openbuddy/ui-sidebar";
import { ChatView } from "@openbuddy/ui-conversation";
import { PlaceholderPage } from "@/components/shared/PlaceholderPage";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toast } from "@openbuddy/ui-primitives";
import { Resizable } from "@openbuddy/ui-primitives";
import { ThumbImg } from "@openbuddy/ui-experts";
import { TruncationBanner } from "@/components/TruncationBanner";
import { APP_VERSION } from "@/lib/platform/app-version";
import { IS_MACOS } from "@/lib/platform/platform";
import {
  CollapsedTopbarFloat,
  InitNotice,
  MainTopbarActions,
  MainTopbarCenter,
  MainTopbarToolsSlot,
} from "./chrome";
import { RoutePending } from "./RoutePending";
import { FeedbackGate } from "./FeedbackGate";
import { DataDirGate } from "./DataDirGate";
import { WhatsNewGate } from "./WhatsNewGate";
import type { PluginCommandPayload } from "@openbuddy/ui-workbench";
import { useSlotComponent, useSlotPayloadValues } from "./slot-bridge";
import { AppStatusBar } from "./AppStatusBar";
import type { AppShellRuntime, SettingsSection } from "./types";

// ---- Lazy overlays ----------------------------------------------------------
const HomePage = lazy(() =>
  import("@openbuddy/ui-settings").then((m) => ({ default: m.HomePage })),
);
const SettingsPanel = lazy(() =>
  import("@openbuddy/ui-settings").then((m) => ({ default: m.SettingsPanel })),
);
const OnboardingWizard = lazy(() =>
  import("@openbuddy/ui-onboarding").then((m) => ({ default: m.OnboardingWizard })),
);
// 配置(主题 / 模型服务 / 数据目录)放在设置里随时可改,这里只负责介绍和起步。
const DEFAULT_ONBOARDING_STEPS = [
  { id: "welcome", title: "欢迎来到 OpenBuddy", description: "本地优先的 AI 工作台：会话、文件、产物都在你自己的机器上。" },
  { id: "first-task", title: "交办第一个任务", description: "在输入框里描述你想完成的事，OpenBuddy 会拆解成步骤并给出产物。" },
  { id: "done", title: "准备就绪", description: "主题、模型服务、数据目录都可以在设置里随时调整。" },
];

const SearchOverlay = lazy(() =>
  import("@openbuddy/ui-workbench").then((m) => ({ default: m.SearchOverlay })),
);
const AboutDialog = lazy(() =>
  import("@openbuddy/ui-dialogs").then((m) => ({ default: m.AboutDialog })),
);
const FolderTrustDialog = lazy(() =>
  import("@openbuddy/ui-dialogs").then((m) => ({ default: m.FolderTrustDialog })),
);
const TasksPanel = lazy(() =>
  import("@openbuddy/ui-automation").then((m) => ({ default: m.TasksPanel })),
);

// ---- Topbar chrome ---------------------------------------------------------
const Topbar = memo(function Topbar({
  sidebarCollapsed,
  onExpandSidebar,
  onNewSession,
  title,
  appVersion,
  onRename,
  sessionId,
  pinned,
  onSessionsChanged,
  expertBadge,
  onOpenSearch,
}: {
  sidebarCollapsed: boolean;
  onExpandSidebar(): void;
  onNewSession(): void;
  title: string;
  appVersion: string;
  onRename(newTitle: string): Promise<void>;
  sessionId: string | undefined;
  pinned?: boolean;
  onSessionsChanged(patch?: { pinned?: boolean; title?: string }): void;
  expertBadge?: { name: string; avatarLocal?: string };
  onOpenSearch: () => void;
}) {
  return (
    <header className="main-topbar" data-openbuddy-drag>
      <div className="main-topbar__left">
        <MainTopbarActions
          sidebarCollapsed={sidebarCollapsed}
          onExpandSidebar={onExpandSidebar}
          onNewSession={onNewSession}
        />
        <TopbarTitle title={title} appVersion={appVersion} onRename={onRename} editable={Boolean(sessionId)} />
        {expertBadge && (
          <span className="expert-badge" data-tip={`专家：${expertBadge.name}`}>
            <ThumbImg name={expertBadge.name} local={expertBadge.avatarLocal} size={18} shape="circle" />
            {expertBadge.name}
          </span>
        )}
        {sessionId && (
          <TopbarActions
            sessionId={sessionId}
            title={title}
            pinned={pinned}
            onSessionsChanged={onSessionsChanged}
          />
        )}
      </div>
      <MainTopbarCenter onOpenSearch={onOpenSearch} />
      <MainTopbarToolsSlot />
    </header>
  );
});

// ---- Slot surfaces ---------------------------------------------------------
//
// 结构位置（侧栏 / 会话区 / 首页）不再硬绑到某个具体组件，而是先问微内核
// 「这个 slot 现在由谁提供」，内核里没有才回落到内置组件。这样：
//   - 第三方插件可以用更高 priority 注册 "conversation" 整体替换会话区
//   - 内置实现仍然在核心里作为底座，卸载插件即自动恢复
// 参考 PI-Desktop 的 AppFrame slot 组合模式。

/** 会话区：内核 `conversation` slot 优先，回落到 ui-conversation 的 ChatView。 */
function ConversationSurface(props: React.ComponentProps<typeof ChatView>) {
  const Component = useSlotComponent("conversation", ChatView);
  return <Component {...props} />;
}

/** 首页：内核 `home` slot 优先，回落到 ui-settings 的 HomePage。 */
function HomeSurface(props: React.ComponentProps<typeof HomePage>) {
  const Component = useSlotComponent("home", HomePage);
  return <Component {...props} />;
}

/** 侧栏：内核 `sidebar` slot 优先，回落到 ui-sidebar 的 Sidebar。 */
function SidebarSurface(props: React.ComponentProps<typeof Sidebar>) {
  const Component = useSlotComponent("sidebar", Sidebar);
  // Wrap the sidebar in a Resizable so the user can drag its right edge
  // (240–480px clamp, persisted under `openbuddy.sidebar.width`). The
  // wrapper owns the pixel width, so the sidebar's own CSS (which reads
  // `100%` under `.app__sidebar-shell`) tracks the drag without a JS hop.
  // Collapsed state still hides the sidebar via `.app__body--collapsed .sidebar`.
  // `handleClassName` exists because `.sidebar` carries `z-index: 20` (so the
  // 「更多」flyout can overflow into the main pane), which otherwise paints over
  // the handle and leaves only a 2px sliver draggable.
  return (
    <Resizable
      edge="right"
      min={260}
      max={480}
      defaultWidth={320}
      storageKey="openbuddy.sidebar.width"
      className="app__sidebar-shell"
      handleClassName="app__sidebar-handle"
      handleLabel="调整侧栏宽度"
    >
      <Component {...props} />
    </Resizable>
  );
}

/**
 * 搜索面板：内核 `overlay.search` slot 优先。
 *
 * 插件命令也在这里注入:⌘K 面板要列出第三方插件通过 Plugin SDK 注册的命令
 * (`plugin.command` 是数据型槽,插件只贡献 { id, label, onExecute })。
 * 放在这层薄容器而不是 AppShell 里读,是为了让 AppShell 继续「不订阅 store」。
 */
function SearchSurface(props: React.ComponentProps<typeof SearchOverlay>) {
  const Component = useSlotComponent("overlay.search", SearchOverlay);
  const pluginCommands = useSlotPayloadValues<PluginCommandPayload>("plugin.command");
  return <Component {...props} pluginCommands={pluginCommands} />;
}

/** 设置面板：内核 `overlay.settings` slot 优先。 */
function SettingsSurface(props: React.ComponentProps<typeof SettingsPanel>) {
  const Component = useSlotComponent("overlay.settings", SettingsPanel);
  return <Component {...props} />;
}

/** 关于对话框：内核 `overlay.about` slot 优先。 */
function AboutSurface(props: React.ComponentProps<typeof AboutDialog>) {
  const Component = useSlotComponent("overlay.about", AboutDialog);
  return <Component {...props} />;
}

/** 目录信任对话框：内核 `overlay.folder-trust` slot 优先。 */
function TrustSurface(props: React.ComponentProps<typeof FolderTrustDialog>) {
  const Component = useSlotComponent("overlay.folder-trust", FolderTrustDialog);
  return <Component {...props} />;
}

/**
 * 首启引导：内核 `onboarding.wizard` slot 优先（自带 localStorage 门控：
 * 已完成 / 已跳过就不再出现），回落用内置步骤直接渲染。
 */
function OnboardingSurface() {
  const Fallback = useMemo(
    () =>
      function OnboardingWizardFallback() {
        return <OnboardingWizard steps={DEFAULT_ONBOARDING_STEPS} />;
      },
    [],
  );
  const Component = useSlotComponent<ComponentType<Record<string, unknown>>>(
    "onboarding.wizard",
    Fallback as unknown as ComponentType<Record<string, unknown>>,
  );
  return <Component />;
}

/** 产品漫游：内核 `onboarding.tour` slot 优先，未注册则不渲染。 */
function TourSurface() {
  const Component = useSlotComponent<ComponentType<Record<string, unknown>> | null>(
    "onboarding.tour",
    null,
  );
  if (!Component) return null;
  return <Component />;
}

/** 任务面板：内核 `overlay.tasks` slot 优先。 */
function TasksSurface(props: React.ComponentProps<typeof TasksPanel>) {
  const Component = useSlotComponent("overlay.tasks", TasksPanel);
  return <Component {...props} />;
}

// ---- Main content (one of: notice / placeholder / chat / home) -------------
function MainContent({ runtime }: { runtime: AppShellRuntime }) {
  const {
    init,
    initError,
    apiReady,
    placeholderView,
    currentSessionId,
    currentTitle,
    currentModelId,
    models,
    workspaces,
    streaming,
    extensionText,
    extensionTextNonce,
    extensionUiBySession,
    handlePlaceholder,
    handleNavigate,
    handleGoHome,
    handleStartWithExpert,
    showToast,
    handleSelectWorkspace,
    handleLaunchDiscover,
    handleSendNew,
    handleSendContent,
    openSettings,
    handleModelChange,
    handleStartProject,
    handleStartProjectConversation,
    handleSendCurrent,
    handleCancel,
    handleRewound,
    handleForked,
    handleSelectSession,
    handleRenameTitle,
    setPlaceholderView,
    setSearchOpen,
  } = runtime;

  if (initError) {
    return (
      <InitNotice
        tone="error"
        message={`初始化失败：${initError}`}
        hint={
          String(initError).toLowerCase().includes("bridge unavailable")
            ? "Electron preload bridge 未加载或版本不兼容，请完全退出并重新启动 OpenBuddy；若仍失败请使用 View → Toggle Developer Tools 查看 preload 诊断。"
            : "请在「设置 → 模型」配置 Pi provider 的 API Key，或检查 provider endpoint 后重试。"
        }
      />
    );
  }
  if (!init) return <InitNotice tone="info" message="正在本地初始化 agent…" />;
  if (!init.ok) {
    return (
      <InitNotice
        tone="error"
        message={`pi 未就绪：${init.auth.reason ?? "未知原因"}`}
        hint="请在「设置 → 模型」配置 Pi provider 的 API Key。"
      />
    );
  }
  if (placeholderView) {
    return (
      <ErrorBoundary compact title="工作台视图出现错误">
        <PlaceholderPage
          label={placeholderView}
          onPlaceholder={handlePlaceholder}
          onNavigate={handleNavigate}
          onGoHome={handleGoHome}
          onStartWithExpert={handleStartWithExpert}
          onToast={showToast}
          cwd={runtime.init?.cwd ?? ""}
          onSelectWorkspace={handleSelectWorkspace}
          sessionId={currentSessionId}
          onLaunch={handleLaunchDiscover}
          onSend={handleSendNew}
          onSendContent={handleSendContent}
          streaming={streaming}
          apiReady={apiReady}
          onOpenSettings={() => openSettings()}
          modelId={currentModelId}
          models={models}
          onModelChange={handleModelChange}
          onStartProject={handleStartProject}
          onStartProjectConversation={handleStartProjectConversation}
        />
      </ErrorBoundary>
    );
  }
  if (currentSessionId) {
    const truncation = runtime.sessionEvents.truncations.get(currentSessionId);
    return (
      <ErrorBoundary compact title="对话视图出现错误">
        {truncation && (
          <TruncationBanner
            truncation={truncation}
            onDismiss={runtime.sessionEvents.dismissTruncation}
            onRestore={runtime.sessionEvents.restoreTruncation}
          />
        )}
        <ConversationSurface
          onSend={handleSendCurrent}
          onSendContent={handleSendContent}
          onCancel={handleCancel}
          modelId={currentModelId}
          models={models}
          onModelChange={handleModelChange}
          cwd={runtime.init?.cwd ?? ""}
          workspaces={workspaces}
          onSelectWorkspace={handleSelectWorkspace}
          onRewound={handleRewound}
          onForked={handleForked}
          onOpenSession={handleSelectSession}
          onToast={showToast}
          onSelectExpert={handleStartWithExpert}
          onNavigateConnectors={() => setPlaceholderView("专家·技能·连接器")}
          onOpenSettings={() => openSettings()}
          extensionText={extensionText}
          extensionTextNonce={extensionTextNonce}
          extensionUi={extensionUiBySession[currentSessionId]}
        />
      </ErrorBoundary>
    );
  }
  return (
    <ErrorBoundary compact title="首页出现错误">
      <Suspense fallback={<RoutePending label="加载首页" />}>
        <HomeSurface
          onSend={handleSendNew}
          streaming={streaming}
          apiReady={apiReady}
          onOpenSettings={() => openSettings()}
          onPlaceholder={handlePlaceholder}
          modelId={currentModelId}
          models={models}
          onModelChange={handleModelChange}
          cwd={runtime.init?.cwd ?? ""}
          workspaces={workspaces}
          onSelectWorkspace={handleSelectWorkspace}
          onSelectExpert={handleStartWithExpert}
          onNavigateConnectors={() => setPlaceholderView("专家·技能·连接器")}
        />
      </Suspense>
    </ErrorBoundary>
  );
}

// ---- AppShell 主组件 -------------------------------------------------------
export const AppShell = memo(function AppShell({ runtime }: { runtime: AppShellRuntime }) {
  const {
    settingsOpen,
    settingsSection,
    shortcutsOpen,
    searchOpen,
    aboutOpen,
    trustRequest,
    placeholderView,
    feedbackOpen,
    dataDirOpen,
    setSettingsOpen,
    setSearchOpen,
    setAboutOpen,
    setFeedbackOpen,
    setDataDirOpen,
    setShortcutsOpen,
    setTrustRequest,
    sidebarCollapsed,
    setSidebarCollapsed,
    currentSessionId,
    currentTitle,
    toastQueue,
    dismissToast,
    handleNewSession,
    handleSelectSession,
    handleNavigate,
    handleOpenProjectFromSidebar,
    handleToggleWorkspace,
    openSettings,
    openAccountSettings,
    handleLogin,
    handleLogout,
    showToast,
    handlePlaceholder,
    casdoorSession,
    handleSelectEmailFromSearch,
    handleSelectKnowledgeFromSearch,
    refreshModels,
    handleRenameTitle,
    handleStartProjectConversation,
  } = runtime;

  const activeNav = placeholderView ?? (currentSessionId ? "" : "新建任务");

  return (
    <div className={"app" + (IS_MACOS ? " app--macos" : "")}>
      {!IS_MACOS && (
        <TitleBar onPlaceholder={handlePlaceholder} onShowAbout={() => setAboutOpen(true)} />
      )}
      <div className={"app__body" + (sidebarCollapsed ? " app__body--collapsed" : "")}>
        <ErrorBoundary compact title="侧栏出现错误">
          <SidebarSurface
            onNewSession={handleNewSession}
            onSelect={handleSelectSession}
            onNavigate={handleNavigate}
            onOpenSettings={() => openSettings()}
            onOpenSettingsSection={(section: string) => openSettings(section as SettingsSection)}
            accountLabel={casdoorSession?.status === "signed_in" && casdoorSession.identity
              ? casdoorSession.identity.displayName ?? casdoorSession.identity.email ?? casdoorSession.identity.subject
              : undefined}
            accountStatus={casdoorSession?.status}
            onOpenAccount={openAccountSettings}
            onLogin={handleLogin}
            onLogout={handleLogout}
            onOpenFeedback={() => setFeedbackOpen(true)}
            onToggleCollapse={() => setSidebarCollapsed(true)}
            onToggleWorkspace={handleToggleWorkspace}
            onOpenSearch={() => setSearchOpen(true)}
            onPlaceholder={handlePlaceholder}
            onToast={showToast}
            onOpenProject={handleOpenProjectFromSidebar}
            onStartProjectConversation={handleStartProjectConversation}
            activeNav={activeNav}
          />
        </ErrorBoundary>
        <main id="main-content" className="app__main">
          {/* R10 — Topbar 任何时候都该渲染:对话页带会话标题/置顶,首页/占位页
              至少保留「折叠侧栏 / 新建任务 / 主题切换 / 全局工具」入口,避免
              侧栏展开时主区域顶上一片空白。CollapsedTopbarFloat 仍然只在
              sidebarCollapsed=true 时显示悬浮按钮。 */}
          {!placeholderView && currentSessionId ? (
            <Topbar
              sidebarCollapsed={sidebarCollapsed}
              onExpandSidebar={() => setSidebarCollapsed(false)}
              onNewSession={handleNewSession}
              title={currentTitle}
              appVersion={APP_VERSION}
              onRename={handleRenameTitle}
              sessionId={currentSessionId}
              pinned={false}
              onSessionsChanged={() => { /* 由 useSessionsStore 自动刷新 */ }}
              expertBadge={undefined}
              onOpenSearch={() => setSearchOpen(true)}
            />
          ) : (
            <Topbar
              sidebarCollapsed={sidebarCollapsed}
              onExpandSidebar={() => setSidebarCollapsed(false)}
              onNewSession={handleNewSession}
              title="OpenBuddy"
              appVersion={APP_VERSION}
              onRename={async () => { /* 首页无会话,无需改名 */ }}
              sessionId={undefined}
              pinned={false}
              onSessionsChanged={() => { /* 首页无会话 */ }}
              expertBadge={undefined}
              onOpenSearch={() => setSearchOpen(true)}
            />
          )}
          <CollapsedTopbarFloat
            sidebarCollapsed={sidebarCollapsed}
            onExpandSidebar={() => setSidebarCollapsed(false)}
            onNewSession={handleNewSession}
          />
          <MainContent runtime={runtime} />
        </main>
      </div>
      <Toast entries={toastQueue} onDismiss={dismissToast} />
      <Suspense fallback={null}>
        <SearchSurface
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onSelect={handleSelectSession}
          onSelectEmail={handleSelectEmailFromSearch}
          onSelectProject={handleOpenProjectFromSidebar}
          onSelectAssistant={() => handleNavigate("助理·收件箱")}
          onSelectKnowledge={handleSelectKnowledgeFromSearch}
          currentSessionId={currentSessionId}
          onSelectCalendar={() => handleNavigate("助理·日程")}
        />
        <SettingsSurface
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onModelsChanged={refreshModels}
          initialSection={settingsSection}
          onOpenDataDirPicker={() => setDataDirOpen(true)}
          onOpenEmailPlan={(planId) => {
            localStorage.setItem("openbuddy.email.processing-plan-target", planId);
            setSettingsOpen(false);
            handleNavigate("邮件");
          }}
        />
        <AboutSurface open={aboutOpen} onClose={() => setAboutOpen(false)} init={runtime.init} />
        <TrustSurface
          request={trustRequest}
          onResolve={() => setTrustRequest(null)}
          onToast={showToast}
        />
        <TasksSurface refreshSignal={runtime.taskRefreshSignal} onToast={showToast} />
        <OnboardingSurface />
        <TourSurface />
        {/* R23 — 「本次更新」摘要(升版本后一次性)+ 「发送反馈」卡。
            两者都走内核槽位(onboarding.whats-new / onboarding.feedback),
            插件可以用更高优先级替换任意一张卡。 */}
        <WhatsNewGate />
        <FeedbackGate
          open={feedbackOpen}
          onClose={() => setFeedbackOpen(false)}
          onToast={showToast}
        />
        <DataDirGate
          open={dataDirOpen}
          onClose={() => setDataDirOpen(false)}
          onToast={showToast}
        />
      </Suspense>
      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <GlobalConfirmHost />
      <AppStatusBar runtime={runtime} />
    </div>
  );
});
