/**
 * src/features/app/chrome.tsx
 *
 * Phase 1 — 微内核激活
 * 纯展示层 chrome 组件。不订阅 store，不持有副作用，只接受 props 渲染。
 * AppShell 直接 import 这些组件以避免在主渲染函数里堆叠 inline JSX。
 *
 * 设计原则：
 *   - 只接受原始 React props，不耦合 AppShellRuntime 类型
 *   - 不使用 zustand selector / useContext
 *   - 允许就地传入 theme、aria-label 等简单属性
 */

import type { ReactNode } from "react";
import { memo } from "react";
import { NewTaskIcon, SearchIcon, SidebarToggleIcon } from "@openbuddy/ui-primitives/icons";
import { ThemeMenuButton } from "@openbuddy/ui-shell";

/** 启动时 / 路由 lazy 时的占位 loading 视图。 */
export const RoutePending = memo(function RoutePending({
  label = "加载中",
}: {
  label?: string;
}) {
  return (
    <div
      className="route-pending"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="route-pending__dot" aria-hidden />
      <span className="route-pending__label">{label}</span>
    </div>
  );
});

/** 主区域顶栏左侧：展开按钮 + 新建任务按钮 + 会话标题。 */
export interface MainTopbarActionsProps {
  sidebarCollapsed: boolean;
  onExpandSidebar(): void;
  onNewSession(): void;
}

export const MainTopbarActions = memo(function MainTopbarActions({
  sidebarCollapsed,
  onExpandSidebar,
  onNewSession,
}: MainTopbarActionsProps) {
  // R10.1 — 「新建任务」始终显示,不再仅在侧栏折叠时挂载。
  // 理由:首页/占位页顶栏需要这个入口触发新会话;原行为要求用户先
  // 收起侧栏才能看到顶栏按钮,体验割裂。
  return (
    <>
      {sidebarCollapsed && (
        <button
          className="main-topbar__btn"
          aria-label="展开侧边栏"
          data-tip="展开侧边栏"
          onClick={onExpandSidebar}
        >
          <SidebarToggleIcon size="md" />
        </button>
      )}
      <button
        className="main-topbar__btn"
        aria-label="新建任务"
        data-tip="新建任务"
        onClick={onNewSession}
      >
        <NewTaskIcon size="md" />
      </button>
    </>
  );
});

/**
 * 主区域顶栏中心区域：搜索触发器 + 可选上下文信息。
 *
 * Phase B 扩展 —— 顶栏左右两侧（main-topbar__left / main-topbar__right）
 * 之间有 ~700px 空白，加一个轻量搜索按钮让用户随时呼出全局 SearchOverlay。
 * 这里不订阅 store，搜索回调完全由 AppShell 通过 prop 注入。
 */
export interface MainTopbarCenterProps {
  onOpenSearch(): void;
}

export const MainTopbarCenter = memo(function MainTopbarCenter({
  onOpenSearch,
}: MainTopbarCenterProps) {
  return (
    <div className="main-topbar__center" aria-label="全局工具">
      <button
        type="button"
        className="main-topbar__search"
        aria-label="搜索 会话/文件/命令"
        data-tip="搜索 会话/文件/命令  (Ctrl/Cmd+K)"
        onClick={onOpenSearch}
      >
        <SearchIcon size="sm" />
        <span className="main-topbar__search-label">搜索 会话 / 文件 / 命令</span>
        <kbd className="main-topbar__search-kbd" aria-hidden="true">⌘K</kbd>
      </button>
    </div>
  );
});

/**
 * 主区域顶栏右侧（ChatView 通过 createPortal 注入工具图标）。
 *
 * Phase B：在 portal 宿主左侧固定挂一枚主题入口 —— 顶栏常驻的
 * `@openbuddy/ui-shell` ThemeMenuButton（内部复用 ui-theme 的 ThemePicker，
 * 自带弹层 / Esc / 外部点击关闭；宿主没有 ThemeProvider 时会自动降级）。
 * ChatView 的 portal 图标仍追加在同一容器内、排在主题按钮之后。
 */
export const MainTopbarToolsSlot = memo(function MainTopbarToolsSlot() {
  return (
    <div className="main-topbar__right" id="ob-topbar-tools">
      <ThemeMenuButton />
    </div>
  );
});

/** 侧栏折叠时的悬浮展开按钮（非对话页）。 */
export const CollapsedTopbarFloat = memo(function CollapsedTopbarFloat({
  sidebarCollapsed,
  onExpandSidebar,
  onNewSession,
}: MainTopbarActionsProps) {
  if (!sidebarCollapsed) return null;
  return (
    <div className="main-topbar-float">
      <button
        className="main-topbar__btn"
        aria-label="展开侧边栏"
        data-tip="展开侧边栏"
        onClick={onExpandSidebar}
      >
        <SidebarToggleIcon size="md" />
      </button>
      <button
        className="main-topbar__btn"
        aria-label="新建任务"
        data-tip="新建任务"
        onClick={onNewSession}
      >
        <NewTaskIcon size="md" />
      </button>
    </div>
  );
});

/** macOS 标题栏替代展示：仅承载 Electron 系统拖拽区，不渲染自定义菜单。 */
export const MacOSTitleBarPlaceholder = memo(function MacOSTitleBarPlaceholder({
  children,
}: {
  children?: ReactNode;
}) {
  return <div className="app-titlebar app-titlebar--macos">{children}</div>;
});

/** 全局启动/错误横幅：用于 initError / apiReady=false / 桥不可用场景。 */
export interface InitNoticeProps {
  tone: "info" | "error";
  message: string;
  hint?: string;
}

export const InitNotice = memo(function InitNotice({ tone, message, hint }: InitNoticeProps) {
  return (
    <div className={`app__notice app__notice--${tone}`} role="status">
      {message}
      {hint && (
        <>
          <br />
          {hint}
        </>
      )}
    </div>
  );
});
