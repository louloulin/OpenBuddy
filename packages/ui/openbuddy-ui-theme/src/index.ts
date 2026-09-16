/**
 * @openbuddy/ui-theme — 统一对外入口
 *
 * 主题层。承载 17 套 OKLCh 主题、Tailwind 主题令牌、动效曲线、字体栈、间距尺度等设计系统变量。
 *
 * 公共 API 分类:
 *   - 公共类型 (Types)        → 跨包消费的类型契约,运行时无副作用
 *   - 公共组件 (Components)   → 可直接在 React 树中渲染 (ThemePicker / ThemeInitializer)
 *   - 公共工具 (Utilities)    → 函数 / 常量 / hooks,无 JSX 输出
 *   - 槽位声明合并 (Slots)    → 通过 declare module 扩展 @openbuddy/ui-slots
 *
 * 子路径:
 *   - ./client        → apply() 槽位注册入口(由 ui-runtime 在 SlotProvider 挂载时调用)
 *   - ./invariant     → 不变式同伴(debug 模式下激活)
 *   - ./styles        → 全局基础 token CSS (import 一次即可)
 *
 * @see packages/ui/AGENTS.md 了解 ui-* 包协作约定
 */
import type { SlotMap } from "@openbuddy/ui-slots";
import type { ThemeName, ThemeDefinition, ThemeType } from "./themes";
import type { ThemeMode, ThemePreference, ThemeService } from "./theme-store";

export type { ThemeName, ThemeDefinition, ThemeType } from "./themes";
export { THEMES, getThemeByName, themesByType, resolveVars } from "./themes";
export type { ThemeMode, ThemePreference, ThemeService } from "./theme-store";
export {
  createThemeStore,
  getStoredThemeName,
  getStoredThemeMode,
  getStoredThemePair,
  loadThemeFonts,
  type ThemeStoreInternal,
} from "./theme-store";

// Back-compat: keep `Theme = "light" | "dark" | "system"` for the 26 existing
// ui-* packages that already import it. ThemeName is the new richer alias.
export type Theme = "light" | "dark" | "system";

export interface ThemeSettingsSnapshot {
  mode: ThemeMode;
  preference: ThemePreference;
  currentName: ThemeName;
  pair: { light: ThemeName; dark: ThemeName };
}

export { ThemePicker } from "./components/ThemePicker";
export { ThemeInitializer } from "./components/ThemeInitializer";
export { ThemeCard } from "./components/ThemeCard";
export {
  ThemeStudio,
  parseOklch,
  formatOklch,
  readCustomThemes,
  writeCustomThemes,
  applyCustomVars,
} from "./components/ThemeStudio";
export type { ThemeStudioProps, CustomTheme, OkLChValue } from "./components/ThemeStudio";

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
