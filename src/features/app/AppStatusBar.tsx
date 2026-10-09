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
  const hostCore = useBridgeHealthStore((s) => s.hostCore);
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

  // bridge 活着 ≠ 本地内核活着:host-core 连续崩溃时 IPC 通道依旧通畅,
  // 但权限 / 密钥 / 搜索都已退到 TS 兜底实现。此时要让用户看见,否则「一切正常」
  // 的假象会掩盖真实的降级。
  const hostCoreDegraded = hostCore?.mode === "degraded" || hostCore?.mode === "unavailable";
  const bridgeItem: StatusItem = hostCoreDegraded
    ? {
        key: "bridge",
        tone: "error",
        label: `本地内核降级（崩溃 ${hostCore?.crashes ?? 0} 次）`,
        title: `host-core ${hostCore?.mode ?? "unavailable"}${hostCore?.lastReason ? `：${hostCore.lastReason}` : ""} —— 相关能力已降级到内置实现`,
        onClick: refresh,
      }
    : {
        key: "bridge",
        tone: bridgeAvailable ? "ok" : "error",
        label: bridgeAvailable ? "本地内核已连接" : `内核离线${bridgeReason ? `（${bridgeReason}）` : ""}`,
        title: bridgeAvailable ? "Electron bridge available" : bridgeReason ?? "bridge unavailable",
        onClick: refresh,
      };

  const left: StatusItem[] = [
    bridgeItem,
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
