/**
 * host-health.ts — host-core 存活状态追踪
 *
 * `HostSupervisor`（runtime/host-supervisor.ts）实现了完整的崩溃恢复 —— 60s 窗口内
 * 最多重启 3 次、超限置 degraded —— 但它要求调用方提供 `HostSpawner`（由它自己
 * spawn 子进程），而生产路径 `bootHostCore()` 走的是 `ElectronHostProcess`（构造
 * 时即 spawn），两者接口不匹配。结果是 `host/degraded` 事件从未真正发出过 ——
 * 崩溃恢复能力写了但没接线，界面上也看不到任何提示。
 *
 * 这里不引入 `HostSupervisor`：重启 host-core 需要重新握手并重建全部 bridge 句柄，
 * 而当前所有 bridge 都在 attach 时捕获句柄，重启语义要等 host 侧支持句柄重绑定
 * 后才能安全实现。本模块只做「观测 + 上报」这一半 —— 让崩溃对用户可见，
 * 能力降级由各 bridge 既有的静默 fallback 承担（权限/密钥/搜索都已有 TS 实现）。
 *
 * 状态通过 `send-safe.ts` 既有的 `electron-bridge-status` 通道广播给渲染层，
 * 不新增 IPC 通道。
 */

export type HostCoreMode = "ok" | "degraded" | "unavailable";

export interface HostCoreHealth {
  mode: HostCoreMode;
  /** 滚动窗口内的崩溃次数。 */
  crashes: number;
  /** 最近一次崩溃原因,供 UI 展示。 */
  lastReason?: string;
}

/** 与 HostSupervisor 的重启策略保持一致:60s 内超过 3 次即视为不可自愈。 */
const CRASH_WINDOW_MS = 60_000;
const MAX_CRASHES_IN_WINDOW = 3;

let crashTimestamps: number[] = [];
let degraded = false;
let lastReason: string | undefined;
let now: () => number = Date.now;

/** 测试注入口:替换时钟以便确定性地推进窗口。 */
export function __setHostHealthClock(next: () => number): void {
  now = next;
}

export function resetHostCoreHealth(): void {
  crashTimestamps = [];
  degraded = false;
  lastReason = undefined;
}

export function hostCoreHealth(): HostCoreHealth {
  return {
    mode: degraded ? "degraded" : "ok",
    crashes: crashTimestamps.length,
    ...(lastReason ? { lastReason } : {}),
  };
}

/**
 * 接到 `HostProcess.onExit` 上。
 *
 * `intentional` 为 true 时是主动 dispose（应用退出 / 协议不匹配），不计入崩溃 ——
 * 否则每次正常关闭应用都会被判成 host-core 故障。
 */
export function recordHostExit(info: { code: number | null; signal: NodeJS.Signals | null; intentional: boolean }): void {
  if (info.intentional) return;

  const at = now();
  crashTimestamps = [...crashTimestamps, at].filter((ts) => at - ts < CRASH_WINDOW_MS);
  lastReason = `exit code=${info.code ?? "null"} signal=${info.signal ?? "null"}`;

  if (crashTimestamps.length > MAX_CRASHES_IN_WINDOW) {
    degraded = true;
    // eslint-disable-next-line no-console
    console.error(
      `[openbuddy-host] host-core crashed ${crashTimestamps.length}x within ${CRASH_WINDOW_MS / 1000}s — marking degraded`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[openbuddy-host] host-core exited unexpectedly (${lastReason})`);
  }
}
