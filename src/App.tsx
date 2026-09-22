/**
 * src/App.tsx
 *
 * Entry point (Phase K.3 micro-kernel wiring).
 *   1. Mount the @openbuddy/ui-runtime `<SlotProvider>` (which in turn
 *      registers all 21 built-in ui-* packages and wraps the tree in
 *      ThemeProvider + I18nProvider + PluginHost).
 *   2. Inside the provider, call useAppShellRuntime() (depends on the
 *      Theme / Runtime contexts).
 *   3. Render <AppShell />.
 *   4. <ThemeInitializer /> is mounted as the first child of SlotProvider
 *      so the v2 store re-applies documentElement styles as soon as the
 *      React tree is up — preventing the white-flash that cabinet's old
 *      `next-themes` setup suffered.
 *
 * Historical baggage: this file used to also mount a `BuiltinUiPlugins`
 * component that called `registerAllBuiltinUis()` a second time. That
 * caused single-slot entries to double up and list-slot entries with the
 * same id to silently overwrite (shell.overlay lost 5 entries). The
 * component has been deleted.
 */

import { SlotProvider } from "@openbuddy/ui-runtime/client";
import { ThemeInitializer } from "@openbuddy/ui-theme/client";
import { ChatShortcutOverlay } from "@openbuddy/ui-conversation";
import { ComposerPortal } from "@/components/ComposerPortal";
import { AppShell } from "@/features/app/AppShell";
import { useSlotComponent } from "@/features/app/slot-bridge";
import { useAppShellRuntime } from "@/features/app/useAppShellRuntime";

/** provider 内部组件 — hook 必须在 provider 内调用 */
function ShellWithRuntime() {
  const runtime = useAppShellRuntime();
  return <AppShell runtime={runtime} />;
}

/**
 * R23 — 「整壳替换」的落点。
 *
 * `root` 槽是本产品唯一一个**包住整个应用**的扩展点:插件(或第三方发行版)
 * 用更高优先级注册它,就能整体替换 AppShell —— 侧栏 / 顶栏 / 主区 / 全部浮层
 * 一起换掉,而不是逐块接管。默认实现是内置 AppShell(fallback),所以零注册时
 * 渲染结果与改造前完全一致;`@openbuddy/ui-layout` 的 `AppFrame` 是同一位置的
 * **参考实现**(它的 apply() 有意不注册,免得内置包自己把产品外壳顶掉)。
 */
function RootSurface() {
  const Component = useSlotComponent("root", ShellWithRuntime);
  return <Component />;
}

export default function App() {
  return (
    <SlotProvider>
      <ThemeInitializer />
      <RootSurface />
      {/* 第 4-5 周(P1-A):全局 ComposerPortal 监听 composer-store,
          让任意面板都能从顶层打开预填好的 EmailComposer。 */}
      <ComposerPortal />
      {/* Plan5 Phase B.6 — 全局快捷键发现面板。
          监听 Shift+/("?") 与 Ctrl/Cmd+/(mac/win 自动适配),按"?" 在任意焦点位置触发;
          与 Topbar 的 `KeyboardShortcutsDialog` 并存但触发路径不同。 */}
      <ChatShortcutOverlay />
    </SlotProvider>
  );
}
