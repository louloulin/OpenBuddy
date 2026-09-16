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
import { AppShell } from "@/features/app/AppShell";
import { useAppShellRuntime } from "@/features/app/useAppShellRuntime";

/** provider 内部组件 — hook 必须在 provider 内调用 */
function ShellWithRuntime() {
  const runtime = useAppShellRuntime();
  return <AppShell runtime={runtime} />;
}

export default function App() {
  return (
    <SlotProvider>
      <ThemeInitializer />
      <ShellWithRuntime />
    </SlotProvider>
  );
}
