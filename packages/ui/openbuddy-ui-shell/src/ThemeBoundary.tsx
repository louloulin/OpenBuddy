/**
 * @openbuddy/ui-shell/ThemeBoundary — 主题相关 UI 的容错边界。
 *
 * `@openbuddy/ui-theme` 的 `useTheme()` 在没有 `<ThemeProvider>` 的宿主里会抛错。
 * 顶栏是常驻 chrome,不应该因为主题上下文缺失整条崩掉 —— 这里把主题子树包成
 * 可降级节点:渲染失败时只替换主题按钮本身。
 *
 * 仅用于壳层内部的"可选项"(主题入口、主题菜单行);业务组件请勿复用。
 */
import { Component, type ReactNode } from "react";

export interface ThemeBoundaryProps {
  /** 主题子树渲染失败时展示的替代节点。 */
  fallback: ReactNode;
  children: ReactNode;
}

interface ThemeBoundaryState {
  failed: boolean;
}

export class ThemeBoundary extends Component<ThemeBoundaryProps, ThemeBoundaryState> {
  constructor(props: ThemeBoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): ThemeBoundaryState {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
