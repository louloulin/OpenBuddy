/**
 * @openbuddy/ui-theme — 统一对外入口
 *
 * 主题层。承载暗/亮主题、Tailwind 主题令牌、动效曲线、字体栈、间距尺度等设计系统变量。
 *
 * 公共 API 分类:
 *   - 公共类型 (Types)        → 跨包消费的类型契约,运行时无副作用
 *   - 公共组件 (Components)   → 可直接在 React 树中渲染
 *   - 公共工具 (Utilities)    → 函数 / 常量 / hooks,无 JSX 输出
 *   - 槽位声明合并 (Slots)    → 通过 declare module 扩展 @openbuddy/ui-slots
 *
 * 子路径:
 *   - ./client        → apply() 槽位注册入口(由 ui-runtime 在 SlotProvider 挂载时调用)
 *   - ./invariant     → 不变式同伴(debug 模式下激活)
 *
 * @see packages/ui/AGENTS.md 了解 ui-* 包协作约定
 */
import type { SlotMap } from "@openbuddy/ui-slots";
export type Theme = "light" | "dark" | "system";

export interface ThemeService {
  /** Current effective theme (resolved through system if theme==="system"). */
  current(): Exclude<Theme, "system">;
  /** Return the user's preferred theme (may be "system"). */
  preference(): Theme;
  /** Subscribe to theme changes (preference and effective). */
  subscribe(fn: () => void): () => void;
  /** Persist a new preference. */
  setPreference(theme: Theme): void;
  /** Convenience alias for setPreference("light" | "dark"). */
  setTheme(theme: Exclude<Theme, "system">): void;
  /** Toggle between light and dark (system preference preserved). */
  toggle(): void;
  /** Source of truth for "system prefers dark" (subscribe-able). */
  systemPrefersDark(): boolean;
}

declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    /** Host-rendered region for the theme settings row (light/dark/system). */
    "settings.appearance.theme": {
      kind: "single";
      scope: "root";
      owner: { currentTheme: Theme };
    };
  }
  interface GlobalStandardProps {
    useTheme(): ThemeService;
  }
}

declare module "@openbuddy/cordis" {
  interface Context {
    theme: ThemeService;
  }
}
