/**
 * 消息队列 store —— 对齐 WorkBuddy `session:enqueueMessage/getMessageQueue/...`。
 *
 * agent 工作时仍可继续排队多条 prompt:编辑/重排/暂停/恢复/取消/立即发送。
 * 每条队列为「按会话隔离」的有序列表;完成一轮对话后由调用方(App)取下一条
 * active(非 paused)项继续 `piSend`,实现「回完一条自动发下一条」。
 *
 * MVP-9 — 持久化到 `storage:renderer-{read,write,remove}` 网关,以
 * namespace `message-queue.v1` + key = sessionId 整体持久化。
 * 内存仍是 live source of truth;每次 mutation 后 fire-and-forget
 * 写一份快照到磁盘。启动时 `hydrateMessageQueue()` 一次性回填。
 */
import { create } from "zustand";
import {
  rendererStorageList,
  rendererStorageRead,
  rendererStorageRemove,
  rendererStorageWrite,
} from "@/lib/agent/pi-client";

export interface QueueItem {
  /** 稳定 id(用于 React key 与操作寻址)。 */
  id: string;
  /** 排队的 prompt 文本。 */
  text: string;
  /** 是否暂停:active = !paused。 */
  paused: boolean;
  /** 入队时间戳(ms)。 */
  createdAt: number;
}

/** sessionId → 有序队列。 */
type QueueMap = Record<string, QueueItem[]>;

interface QueueState {
  queues: QueueMap;
  /** 入队一条(追加到末尾,默认 active)。返回新 item 的 id。 */
  enqueue: (sessionId: string, text: string) => string;
  /** 编辑某条文本。 */
  update: (sessionId: string, id: string, text: string) => void;
  /** 删除某条。 */
  remove: (sessionId: string, id: string) => void;
  /** 移动某条到新位置(0-based)。越界则 clamp。 */
  reorder: (sessionId: string, from: number, to: number) => void;
  /** 暂停(true) / 恢复(false)。 */
  setPaused: (sessionId: string, id: string, paused: boolean) => void;
  /** 取下一条 active(非 paused)项并从队列移除;无则返回 null。 */
  shiftNext: (sessionId: string) => QueueItem | null;
  /** 清空某会话的整个队列。 */
  clear: (sessionId: string) => void;
  /** 读取某会话的队列(只读视图)。 */
  getQueue: (sessionId: string) => QueueItem[];
}

const newId = () =>
  `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** 安全读写:返回队列的可变副本,缺省为空数组。 */
function queueOf(map: QueueMap, sessionId: string): QueueItem[] {
  return map[sessionId] ?? [];
}

/** MVP-9 — durable queue storage namespace + key strategy.
 *  Each session's full queue is persisted as one JSON blob under
 *  `message-queue.v1/{sessionId}` so atomic writes cost O(1) regardless
 *  of queue length and a stale read returns either the full snapshot or
 *  nothing — never a half-updated queue. */
export const MESSAGE_QUEUE_NAMESPACE = "message-queue.v1";
const queueKey = (sessionId: string) => sessionId;

/** MVP-9 — fire-and-forget persist helper. Errors are swallowed because
 *  the in-memory store is the live source of truth; the on-disk copy is
 *  only consulted on next launch. */
function persistQueue(sessionId: string, queue: QueueItem[]): void {
  if (queue.length === 0) {
    void rendererStorageRemove(MESSAGE_QUEUE_NAMESPACE, queueKey(sessionId)).catch(() => undefined);
    return;
  }
  void rendererStorageWrite(MESSAGE_QUEUE_NAMESPACE, queueKey(sessionId), queue).catch(
    () => undefined,
  );
}

export const useMessageQueueStore = create<QueueState>((set, get) => ({
  queues: {},
  enqueue: (sessionId, text) => {
    const id = newId();
    const item: QueueItem = { id, text, paused: false, createdAt: Date.now() };
    set((s) => {
      const next = [...queueOf(s.queues, sessionId), item];
      persistQueue(sessionId, next);
      return { queues: { ...s.queues, [sessionId]: next } };
    });
    return id;
  },
  update: (sessionId, id, text) =>
    set((s) => {
      const q = queueOf(s.queues, sessionId);
      if (!q.some((it) => it.id === id)) return s;
      const next = q.map((it) => (it.id === id ? { ...it, text } : it));
      persistQueue(sessionId, next);
      return { queues: { ...s.queues, [sessionId]: next } };
    }),
  remove: (sessionId, id) =>
    set((s) => {
      const q = queueOf(s.queues, sessionId);
      if (!q.some((it) => it.id === id)) return s;
      const next = q.filter((it) => it.id !== id);
      const queues = { ...s.queues };
      if (next.length === 0) delete queues[sessionId];
      else queues[sessionId] = next;
      persistQueue(sessionId, next);
      return { queues };
    }),
  reorder: (sessionId, from, to) =>
    set((s) => {
      const q = queueOf(s.queues, sessionId);
      if (from < 0 || from >= q.length || q.length === 0) return s;
      const clampedTo = Math.max(0, Math.min(to, q.length - 1));
      if (from === clampedTo) return s;
      const next = [...q];
      const [moved] = next.splice(from, 1);
      next.splice(clampedTo, 0, moved);
      persistQueue(sessionId, next);
      return { queues: { ...s.queues, [sessionId]: next } };
    }),
  setPaused: (sessionId, id, paused) =>
    set((s) => {
      const q = queueOf(s.queues, sessionId);
      if (!q.some((it) => it.id === id)) return s;
      const next = q.map((it) => (it.id === id ? { ...it, paused } : it));
      persistQueue(sessionId, next);
      return { queues: { ...s.queues, [sessionId]: next } };
    }),
  shiftNext: (sessionId) => {
    const q = queueOf(get().queues, sessionId);
    const idx = q.findIndex((it) => !it.paused);
    if (idx === -1) return null;
    const [item] = q.splice(idx, 1);
    const queues = { ...get().queues };
    if (q.length === 0) delete queues[sessionId];
    else queues[sessionId] = q;
    persistQueue(sessionId, q);
    set({ queues });
    return item;
  },
  clear: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.queues)) return s;
      const queues = { ...s.queues };
      delete queues[sessionId];
      persistQueue(sessionId, []);
      return { queues };
    }),
  getQueue: (sessionId) => queueOf(get().queues, sessionId),
}));

/** MVP-9 — hydrate all persisted queues into the in-memory store.
 *  Safe to call multiple times (later calls win on conflict). Returns
 *  the number of sessions whose queues were rehydrated. The actual state
 *  write is deferred to the next microtask to avoid the React "setState
 *  during render" warning when callers invoke this from a layout effect. */
export async function hydrateMessageQueue(): Promise<number> {
  const res = await rendererStorageList<QueueItem[]>(MESSAGE_QUEUE_NAMESPACE);
  if (!res.ok) return 0;
  const incoming: QueueMap = {};
  let count = 0;
  for (const entry of res.values) {
    if (Array.isArray(entry.value) && entry.value.length > 0) {
      incoming[entry.key] = entry.value;
      count += 1;
    }
  }
  if (count > 0) {
    queueMicrotask(() => {
      useMessageQueueStore.setState((prev) => ({ queues: { ...prev.queues, ...incoming } }));
    });
  }
  return count;
}

/** MVP-9 — single-session hydrate helper for tests and explicit re-reads. */
export async function loadPersistedQueue(sessionId: string): Promise<QueueItem[] | null> {
  const res = await rendererStorageRead<QueueItem[]>(
    MESSAGE_QUEUE_NAMESPACE,
    queueKey(sessionId),
  );
  if (!res.ok || !res.value) return null;
  return Array.isArray(res.value) ? res.value : null;
}

/** 是否存在任意 active(非 paused)项 —— App 判定「回完一条是否自动续发」。 */
export function hasActiveItems(q: QueueItem[]): boolean {
  return q.some((it) => !it.paused);
}