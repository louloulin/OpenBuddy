/**
 * email-store — 全局邮件状态(zustand slice)。
 *
 * 设计:跨路由保留选中线程、视图、账户、撤销 entry。
 * 不引入新依赖 — 直接用 React Context + useSyncExternalStore。
 *
 * 关键不变量:
 *   - 选中线程 ID 由 store 单一来源维护 — 路由变化不丢。
 *   - undoEntry 是带 createdAt 时间戳的快照 — 跨路由依然有效(只要 30s 内)。
 *   - 订阅使用 useSyncExternalStore → React 18 一致性。
 */
import { useSyncExternalStore } from "react";
import type { AiActionReceipt } from "./types";

export type RailView = "today" | "later" | "done";
export type RailFolder = "inbox" | "sent" | "drafts" | "scheduled" | "snoozed" | "starred" | "important" | "archive" | "trash" | "spam";

export interface EmailStoreState {
  accountId: string;
  selectedThreadId: string | null;
  view: RailView;
  folder: RailFolder;
  commandOpen: boolean;
  /** 上一份 receipt — ReceiptToast 跨路由可见。 */
  lastReceipt: { receipts: AiActionReceipt[]; createdAt: number } | null;
}

const initialState: EmailStoreState = {
  accountId: "all",
  selectedThreadId: null,
  view: "today",
  folder: "inbox",
  commandOpen: false,
  lastReceipt: null,
};

type Listener = () => void;
const listeners = new Set<Listener>();
let state: EmailStoreState = initialState;

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(patch: Partial<EmailStoreState>): void {
  state = { ...state, ...patch };
  notify();
}

export const emailStore = {
  getState(): EmailStoreState { return state; },
  subscribe,
  setAccount(accountId: string): void { setState({ accountId }); },
  setSelectedThread(threadId: string | null): void { setState({ selectedThreadId: threadId }); },
  setView(view: RailView): void { setState({ view }); },
  setFolder(folder: RailFolder): void { setState({ folder }); },
  openCommand(): void { setState({ commandOpen: true }); },
  closeCommand(): void { setState({ commandOpen: false }); },
  /** 设置 receipt — UI 自动消费 lastReceipt 渲染 ReceiptToast。 */
  setReceipt(receipts: AiActionReceipt[]): void {
    if (receipts.length === 0) return;
    setState({ lastReceipt: { receipts, createdAt: Date.now() } });
  },
  clearReceipt(): void { setState({ lastReceipt: null }); },
  /** 测试 / Storybook:重置全部状态。 */
  reset(): void { state = initialState; notify(); },
};

export function useEmailStore<T>(selector: (s: EmailStoreState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(initialState),
  );
}
