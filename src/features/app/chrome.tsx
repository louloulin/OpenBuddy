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
import { NewTaskIcon, SidebarToggleIcon } from "@openbuddy/ui-primitives/icons";

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
  if (!sidebarCollapsed) return null;
  return (
    <>
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
    </>
  );
});

/** 主区域顶栏右侧（ChatView 通过 createPortal 注入工具图标）。 */
export const MainTopbarToolsSlot = memo(function MainTopbarToolsSlot() {
  return <div className="main-topbar__right" id="ob-topbar-tools" />;
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
