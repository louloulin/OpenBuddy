/**
 * src/features/app/AppStatusBar.tsx
 *
 * Thin container that feeds live state into `<StatusBar>` (owned by
 * @openbuddy/ui-shell). Kept as a separate component so AppShell itself
 * stays a pure, store-free container (see AppShell.tsx header).
 *
 * Left  — bridge health, agent init state
 * Right — app version, active theme
 */
import { useEffect, type ComponentType } from "react";
import { StatusBar, type StatusItem, type StatusBarProps } from "@openbuddy/ui-shell";
import { useSlotComponent } from "./slot-bridge";
import { useThemeSnapshotV2 } from "@openbuddy/ui-theme/client";
import { useBridgeHealthStore } from "@/stores/bridge-health-store";
import { APP_VERSION } from "@/lib/platform/app-version";
import type { AppShellRuntime } from "./types";

export function AppStatusBar({ runtime }: { runtime: AppShellRuntime }) {
  const bridgeAvailable = useBridgeHealthStore((s) => s.available);
  const bridgeReason = useBridgeHealthStore((s) => s.reason);
  const refresh = useBridgeHealthStore((s) => s.refresh);
  const themeSnap = useThemeSnapshotV2();

  // Periodic health probe so the status dot reflects the live bridge, not
  // just the mount-time snapshot.
  useEffect(() => {
    const id = window.setInterval(() => refresh(), 5_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const init = runtime.init;
  const initError = runtime.initError;
  const initState = initError ? "error" : init ? "ready" : "idle";

  const left: StatusItem[] = [
    {
      key: "bridge",
      tone: bridgeAvailable ? "ok" : "error",
      label: bridgeAvailable ? "本地内核已连接" : `内核离线${bridgeReason ? `（${bridgeReason}）` : ""}`,
      title: bridgeAvailable ? "Electron bridge available" : bridgeReason ?? "bridge unavailable",
      onClick: refresh,
    },
    {
      key: "agent",
      tone: initState === "ready" ? "ok" : initState === "error" ? "error" : "busy",
      label:
        initState === "ready"
          ? "Agent 就绪"
          : initState === "error"
            ? "Agent 初始化失败"
            : "Agent 启动中",
      title: initError ?? "Pi AgentSession",
    },
  ];

  const right: StatusItem[] = [
    { key: "theme", glyph: "🎨", label: themeSnap.currentName, title: `主题：${themeSnap.currentName}` },
    { key: "version", glyph: "◆", label: `v${APP_VERSION}`, title: "OpenBuddy 版本" },
  ];

  // 内核 `shell.statusbar` slot 优先:插件注册同名单例槽即可整体替换状态栏,
  // 拿到的是与内置实现同一份 props。内核里没有实现时回落到内置 StatusBar。
  const Component = useSlotComponent<ComponentType<StatusBarProps>>(
    "shell.statusbar",
    StatusBar as unknown as ComponentType<StatusBarProps>,
  );
  return <Component left={left} right={right} />;
}
