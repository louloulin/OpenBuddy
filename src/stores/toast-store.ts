/**
 * Toast queue store — R2.3 全局 Toast 队列。
 *
 * Why a store instead of local useState (原本 App.tsx 的 `toast`):
 *   - 支持多 toast 同时显示(原本 `setToast(message)` 会覆盖,用户错过前面那条)
 *   - 队列容量 8(超过时 FIFO 淘汰最旧的非持久 toast)
 *   - 单条 TTL 5s(可被同 id 刷新覆盖,实现 "去重 toast")
 *   - 模块级 setToast 入口,不依赖 React 上下文,Electron bridge 等
 *     非组件位置也能用(`agent-died` 监听器)。
 */
import { create } from "zustand";

const MAX_QUEUE = 8;
/**
 * R7.3 — `ttlMs: 0` 表示"不自动消失"的持久 toast,只有以 `p:` 开头的 id 才允许。
 * 其他 id 想要 ttlMs:0 会被自动纠正成 DEFAULT_TTL_MS,避免某条普通 toast
 * 卡死队列(典型 bug:某个失败 promise 反复把同一错误以 ttlMs:0 push,
 * 后续所有 toast 都被 FIFO 淘汰)。
 */
const PERSISTENT_TOAST_PREFIX = "p:";
function clampTtlMs(id: string, ttlMs: number): number {
  if (ttlMs === 0 && !id.startsWith(PERSISTENT_TOAST_PREFIX)) {
    if (typeof import.meta !== "undefined" && (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) {
      console.warn(`[toast-store] ttlMs:0 requires id with "p:" prefix; got "${id}". Falling back to ${DEFAULT_TTL_MS}ms.`);
    }
    return DEFAULT_TTL_MS;
  }
  return ttlMs;
}
const DEFAULT_TTL_MS = 5000;
/**
 * 文本窗口去重:自动生成 id 的调用方(重试循环、多处 catch 等)在窗口内重复
 * 推同一文案时刷新原条目而不是追加,避免同一错误堆叠成 toast 风暴
 * (bridge 初始化失败曾同文案堆 5 条)。
 */
const TEXT_DEDUPE_WINDOW_MS = 3000;

export type ToastKind = "info" | "warning" | "error";

/** Optional inline action button on a toast — used for Retry / Open settings / etc. */
export interface ToastAction {
  label: string;
  /** Invoked when the user clicks the button. Toast auto-dismisses after. */
  onClick: () => void;
  /** Optional keyboard hint to render next to the label, e.g. "↵". */
  hint?: string;
}

export interface ToastEntry {
  /** Stable identity — same id 刷新覆盖而不是新建一条。 */
  id: string;
  message: string;
  kind: ToastKind;
  createdAt: number;
  /** 自动 dismiss 的 ms;0 表示不自动消失(错误/重要提示)。 */
  ttlMs: number;
  /** Optional action button (Retry, Open, etc.). */
  action?: ToastAction;
}

interface ToastState {
  queue: ToastEntry[];
  push: (entry: Omit<ToastEntry, "createdAt"> & { ttlMs?: number }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

let toastCounter = 0;
const newToastId = (): string => `t-${Date.now()}-${++toastCounter}`;

/**
 * Module-level helper — convenient call site that mirrors the legacy
 * `setToast(message)` API. Pushes an info toast and returns its id so
 * callers can dismiss it programmatically.
 */
export function setToast(
  message: string,
  opts: { kind?: ToastKind; id?: string; ttlMs?: number; action?: ToastAction } = {},
): string {
  return useToastStore.getState().push({
    id: opts.id ?? newToastId(),
    message,
    kind: opts.kind ?? "info",
    ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS,
    action: opts.action,
  });
}

export const useToastStore = create<ToastState>((set) => ({
  queue: [],
  push: (entry) => {
    const id = entry.id;
    const createdAt = Date.now();
    const rawTtlMs = entry.ttlMs ?? DEFAULT_TTL_MS;
    const ttlMs = clampTtlMs(id, rawTtlMs);
    let resultId = id;
    set((s) => {
      // 同 id 覆盖:刷新同一条 toast(常见于 bridge 反复失败)。
      const existing = s.queue.find((t) => t.id === id);
      if (existing) {
        return {
          queue: s.queue.map((t) =>
            t.id === id ? { ...t, message: entry.message, kind: entry.kind, createdAt, ttlMs, action: entry.action } : t,
          ),
        };
      }
      // 文本窗口去重:窗口内同文案刷新原条目(含 kind/action/ttl),返回原 id。
      const dup = s.queue.find(
        (t) => t.message === entry.message && createdAt - t.createdAt < TEXT_DEDUPE_WINDOW_MS,
      );
      if (dup) {
        resultId = dup.id;
        return {
          queue: s.queue.map((t) =>
            t.id === dup.id ? { ...t, kind: entry.kind, createdAt, ttlMs, action: entry.action } : t,
          ),
        };
      }
      const next = [...s.queue, { id, message: entry.message, kind: entry.kind, createdAt, ttlMs, action: entry.action }];
      // 容量上限:FIFO 淘汰最旧的非持久化(toastId 不以 "p:" 开头)条目。
      // R7.3 — 持久 toast(`p:` 前缀)永远不淘汰,普通 toast 才参与 FIFO。
      while (next.length > MAX_QUEUE) {
        const evictIdx = next.findIndex((t) => !t.id.startsWith(PERSISTENT_TOAST_PREFIX));
        if (evictIdx === -1) break; // 队列已满且全是持久 toast,放弃新增。
        next.splice(evictIdx, 1);
      }
      return { queue: next };
    });
    return resultId;
  },
  dismiss: (id) =>
    set((s) => ({ queue: s.queue.filter((t) => t.id !== id) })),
  clear: () => set({ queue: [] }),
}));

/**
 * Convenience selectors — use with `useToastStore` directly:
 *   const entries = useToastStore(s => s.queue);
 */
export const selectToasts = (s: ToastState): ToastEntry[] => s.queue;