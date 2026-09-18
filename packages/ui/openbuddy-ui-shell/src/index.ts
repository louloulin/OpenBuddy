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
import type { ReactNode } from "react";
import type { SlotMap } from "@openbuddy/ui-slots";
import type { StatusItem } from "./StatusBar";
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
/** 右侧「助理」导轨：hover 浮出专家/助理列表，一键开启对话。 */
export { SecondarySidebar } from "./SecondarySidebar";
export type { SecondarySidebarProps } from "./SecondarySidebar";

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
    /**
     * Bottom status strip.
     *
     * 宿主(ui-shell 的 StatusBar)是默认实现;插件注册同名单例槽即可整体替换。
     * 替换实现会拿到与内置实现**同一份 props**(items 由宿主从 live state 计算),
     * 所以只需关心怎么画,不用自己找数据。
     */
    "shell.statusbar": {
      kind: "single";
      scope: "root";
      owner: {
        left?: StatusItem[];
        right?: StatusItem[];
        renderLeft?(): ReactNode;
        renderRight?(): ReactNode;
        className?: string;
      };
    };

    /**
     * 右侧「助理」导轨(SecondarySidebar)—— 会话激活时贴在窗口右缘的竖直
     * 触发条 + hover 浮层,列出 `<agentHome>/agents/*.md` 里的专家(agentHome
     * 默认 `~/.openbuddy/agent`),点一下就开新会话。
     *
     * 为什么声明权在本包而不是 ui-layout:
     *   本包是**注册方**(`client.tsx` 把 SecondarySidebar 注册进来),ui-layout
     *   的 AppFrame 只是消费者之一。之前声明写在 ui-layout 里、注释写着
     *   "Owned by ui-workbench",owner 形状是 `{open,width}` —— 与真实注册的
     *   组件 props 完全对不上,宿主也就一直没接过线(R23 之后 AppFrame 变成
     *   参考实现,这条槽就彻底没人消费了)。
     *
     * 组件自身是 `position: fixed` 贴右缘的导轨,所以宿主只需提供"是否可见 +
     * 两个回调",不需要给它划一列宽度。
     */
    "details": {
      kind: "single";
      scope: "session-maybe";
      owner: {
        /** 只在会话激活时为 true;false 时组件自己返回 null。 */
        visible?: boolean;
        onSelectExpert?: (agent: {
          name: string;
          description?: string;
          scope?: string;
          modelTags?: string[];
        }) => void;
        onToast?: (message: string) => void;
        /** 导轨为空(全新安装下 `<agentHome>/agents/` 一个都没有)时的出口。 */
        onOpenExperts?: () => void;
      };
    };
  }
}
