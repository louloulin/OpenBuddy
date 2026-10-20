import { create } from "zustand";
import { getElectronBridgeStatus } from "@/lib/platform/electron-api";

/** host-core(Rust sidecar)存活状态,由主进程经 electron-bridge-status 心跳带回。 */
export interface HostCoreStatus {
  mode: "ok" | "degraded" | "unavailable";
  crashes: number;
  lastReason?: string;
}

interface BridgeHealthState {
  available: boolean;
  reason?: string;
  apiVersion?: number;
  lastCheckedAt: number;
  /** 缺失表示主进程还没广播过(老版本主进程 / 启动 30s 内),UI 退回到只看 `available`。 */
  hostCore?: HostCoreStatus;
  /** Mutated after every status probe so subscribers can react. */
  set: (next: { available: boolean; reason?: string; apiVersion?: number; hostCore?: HostCoreStatus }) => void;
  /** Re-read window.api right now and update the store. Cheap; safe to call
   *  on a timer or after vite reconnects. */
  refresh: () => void;
  /** Re-establish the agent runtime after the main process comes back.
   *  Disposes the existing agent session and re-initializes with the same cwd.
   *  Backoff schedule: 1s → 2s → 5s → 10s (capped). Returns true on success. */
  reconnect: (cwd?: string) => Promise<boolean>;
}

const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000] as const;

export const useBridgeHealthStore = create<BridgeHealthState>((set, get) => {
  const initial = getElectronBridgeStatus();
  return {
    available: initial.available,
    reason: initial.reason,
    apiVersion: initial.apiVersion,
    hostCore: initial.hostCore,
    lastCheckedAt: Date.now(),
    set: (next) => set({ ...next, lastCheckedAt: Date.now() }),
    refresh: () => {
      const status = getElectronBridgeStatus();
      set({ ...status, lastCheckedAt: Date.now() });
    },
    reconnect: async (cwd?: string) => {
      const api = (typeof window !== "undefined" ? (window as { api?: { agent?: { dispose: () => Promise<unknown>; init: (cwd?: string) => Promise<unknown> } } }).api : undefined);
      if (!api?.agent) {
        set({ available: false, reason: "bridge api missing", lastCheckedAt: Date.now() });
        return false;
      }
      for (let attempt = 0; attempt < RECONNECT_BACKOFF_MS.length; attempt += 1) {
        try {
          await api.agent.dispose().catch(() => undefined);
          await api.agent.init(cwd);
          const status = getElectronBridgeStatus();
          set({ ...status, lastCheckedAt: Date.now(), reason: status.available ? undefined : "reconnect-succeeded-but-bridge-flags-unavailable" });
          if (status.available) return true;
        } catch (error) {
          set({ available: false, reason: `reconnect attempt ${attempt + 1} failed: ${String(error)}`, lastCheckedAt: Date.now() });
        }
        const delay = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)];
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      return false;
    },
  };
});

export const BRIDGE_RECONNECT_BACKOFF_MS = RECONNECT_BACKOFF_MS;