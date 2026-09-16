/**
 * @openbuddy/ui-shell — 统一对外入口
 *
 * 外层 Shell 层。承载应用窗口外壳、托盘菜单、关于页、调试入口等操作系统集成。
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
export type { SlotMap };

export { TitleBar } from "./TitleBar";
export { TopbarActions } from "./TopbarActions";
export { TopbarTitle } from "./TopbarTitle";
export { WorkspacePicker } from "./WorkspacePicker";
export { AssistantTopTabs } from "./AssistantTopTabs";
export { AssistantWorkbenchNav } from "./AssistantWorkbenchNav";
export {
  assistantPluginTabsFromContributions,
  ASSISTANT_TAB_SECTIONS,
  ASSISTANT_TAB_ROUTE_BY_SECTION,
} from "./AssistantTopTabs";
export type { AssistantTopTabItem } from "./AssistantTopTabs";
export { SessionControls } from "./SessionControls";
export { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
export type { ShortcutEntry } from "./KeyboardShortcutsDialog";
export { PlanModeBanner } from "./PlanModeBanner";

export { useShortcut } from "./useShortcut";
export type { ShortcutOptions } from "./useShortcut";
export { StartupSplash } from "./StartupSplash";
export type { StartupSplashProps } from "./StartupSplash";
export { OnboardingChecklist } from "./OnboardingChecklist";
export type { OnboardingChecklistProps } from "./OnboardingChecklist";
export { StatusBar } from "./StatusBar";
export type { StatusBarProps, StatusItem } from "./StatusBar";

// ── Phase B: 顶栏升级（状态胶囊 / 快捷键提示 / 更新弹窗 / 主题入口） ──────────
/** 顶栏状态胶囊：ready / working / paused / offline / error 五态 + 颜色点。 */
export { TopbarStatusChip } from "./TopbarStatusChip";
export type { TopbarStatusChipProps, TopbarStatusTone } from "./TopbarStatusChip";
/** 平台自适应快捷键 glyph；`formatShortcut` 是可单测的纯函数。 */
export { ShortcutHint, formatShortcut, detectShortcutPlatform } from "./ShortcutHint";
export type {
  ShortcutHintProps,
  ShortcutChord,
  ShortcutChordSpec,
  ShortcutPlatform,
} from "./ShortcutHint";
/** 应用更新弹窗（纯展示）：idle / downloading / ready / error 四态。 */
export { UpdateDialog } from "./UpdateDialog";
export type { UpdateDialogProps, UpdateDialogState, UpdateNotes } from "./UpdateDialog";
/** 顶栏主题入口：复用 ui-theme 的 ThemePicker，缺失 ThemeProvider 时降级。 */
export { ThemeMenuButton } from "./ThemeMenuButton";
export type { ThemeMenuButtonProps } from "./ThemeMenuButton";
/** 主题容错边界（壳层内部可选项用）。 */
export { ThemeBoundary } from "./ThemeBoundary";
export type { ThemeBoundaryProps } from "./ThemeBoundary";
/** 顶栏动作菜单展示用的快捷键和弦（宿主注册监听时引用同一份常量）。 */
export { TOPBAR_ACTION_SHORTCUTS } from "./topbar-shortcuts";
export type { TopbarActionShortcut } from "./topbar-shortcuts";

declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    /** Bottom status strip. Host-owned; plugins may replace it. */
    "shell.statusbar": {
      kind: "single";
      scope: "root";
      owner: Record<string, never>;
    };
  }
}
