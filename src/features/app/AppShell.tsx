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

import { lazy, memo, Suspense } from "react";
import { GlobalConfirmHost } from "@/components/GlobalConfirmHost";
import { TitleBar } from "@openbuddy/ui-shell";
import { TopbarActions, TopbarTitle, KeyboardShortcutsDialog } from "@openbuddy/ui-shell";
import { Sidebar } from "@openbuddy/ui-sidebar";
import { ChatView } from "@openbuddy/ui-conversation";
import { PlaceholderPage } from "@/components/shared/PlaceholderPage";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toast } from "@openbuddy/ui-primitives";
import { ThumbImg } from "@openbuddy/ui-experts";
import { TruncationBanner } from "@/components/TruncationBanner";
import { APP_VERSION } from "@/lib/platform/app-version";
import { IS_MACOS } from "@/lib/platform/platform";
import {
  CollapsedTopbarFloat,
  InitNotice,
  MainTopbarActions,
  MainTopbarToolsSlot,
} from "./chrome";
import { RoutePending } from "./RoutePending";
import { useSlotComponent } from "./slot-bridge";
import type { AppShellRuntime } from "./types";

// ---- Lazy overlays ----------------------------------------------------------
const HomePage = lazy(() =>
  import("@openbuddy/ui-settings").then((m) => ({ default: m.HomePage })),
);
const SettingsPanel = lazy(() =>
  import("@openbuddy/ui-settings").then((m) => ({ default: m.SettingsPanel })),
);
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
}) {
  return (
    <header className="main-topbar" data-openbuddy-drag>
      <div className="main-topbar__left">
        <MainTopbarActions
          sidebarCollapsed={sidebarCollapsed}
          onExpandSidebar={onExpandSidebar}
          onNewSession={onNewSession}
        />
        <TopbarTitle title={title} appVersion={appVersion} onRename={onRename} />
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
  return <Component {...props} />;
}

/** 搜索面板：内核 `overlay.search` slot 优先。 */
function SearchSurface(props: React.ComponentProps<typeof SearchOverlay>) {
  const Component = useSlotComponent("overlay.search", SearchOverlay);
  return <Component {...props} />;
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
          onOpenSettings={openSettings}
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
          onOpenSettings={openSettings}
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
          onOpenSettings={openSettings}
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
    shortcutsOpen,
    searchOpen,
    aboutOpen,
    trustRequest,
    placeholderView,
    setSettingsOpen,
    setSearchOpen,
    setAboutOpen,
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
            onOpenSettings={openSettings}
            onOpenAccount={openAccountSettings}
            accountLabel={
              casdoorSession?.status === "signed_in" && casdoorSession.identity
                ? casdoorSession.identity.displayName ?? casdoorSession.identity.email ?? casdoorSession.identity.subject
                : undefined
            }
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
            />
          ) : (
            <CollapsedTopbarFloat
              sidebarCollapsed={sidebarCollapsed}
              onExpandSidebar={() => setSidebarCollapsed(false)}
              onNewSession={handleNewSession}
            />
          )}
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
          initialSection="model"
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
      </Suspense>
      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <GlobalConfirmHost />
    </div>
  );
});
