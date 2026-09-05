/**
 * noticeReducer.ts — Phase R3.0 (pi-web-alignment).
 *
 * Bounded notification shelf that surfaces transient pi-side events
 * (model retries, folder-trust requests, MCP status changes, queue
 * arrivals, etc.) to the user without overwhelming the chat header.
 *
 * Pattern mirrors pi-web `hooks/useAgentSession.ts:95-229` exactly:
 *
 *   - `visible` list shows at most `MAX_NOTICES=5` chips at any time.
 *   - New notices that arrive when the shelf is full go into `pending`.
 *   - When a visible notice exits, the oldest pending one is promoted.
 *   - `exiting` flag drives the CSS exit animation (180ms) — the actual
 *     `remove` action runs after the animation completes.
 *
 * The reducer is **pure** (no React, no Zustand) so it can be reused
 * from any host (hook, store, saga) and unit-tested in isolation.
 *
 * Note: existing OpenBuddy callsites use `notificationAppend(...)` to
 * push notifications into `notify-channels.ts`. Phase R3.1 will redirect
 * the most visible ones (permission, plan_mode, session_complete,
 * summary, models_update, task_update) through this reducer for
 * consistent UX. Other channels (browser, OS-level) keep their own path.
 */

export type NoticeType = "info" | "success" | "warning" | "error";

export interface NoticeItem {
  id: string;
  message: string;
  type: NoticeType;
  /** True while the exit animation runs. The reducer then drops the row. */
  exiting?: boolean;
}

export interface NoticeState {
  visible: NoticeItem[];
  pending: NoticeItem[];
}

export type NoticeAction =
  | { type: "add"; notice: NoticeItem }
  | { type: "mark_oldest_exiting" }
  | { type: "remove"; id: string };

/** Max concurrent notices shown in the shelf (pi-web parity). */
export const MAX_NOTICES = 5;
/** Auto-dismiss after this many ms (pi-web parity). */
export const NOTICE_VISIBLE_MS = 5_000;
/** Exit-animation duration (pi-web parity). */
export const NOTICE_EXIT_ANIMATION_MS = 180;

/** Build a unique id (prefer `crypto.randomUUID`). */
export function createNoticeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Find the oldest non-exiting visible notice and mark it as exiting.
 * Returns the same array reference when no candidate exists, so React
 * subscribers can use `Object.is` to skip re-renders.
 */
export function markOldestNoticeExiting(notices: NoticeItem[]): NoticeItem[] {
  const index = notices.findIndex((notice) => !notice.exiting);
  if (index === -1) return notices;
  return notices.map((notice, i) =>
    i === index ? { ...notice, exiting: true } : notice,
  );
}

/**
 * Promote pending notices into `visible` until the shelf is full.
 * If `pending` still has items AND no visible item is currently exiting,
 * mark the oldest visible as exiting so the next promotion has room.
 */
export function fillPendingNotices(
  visible: NoticeItem[],
  pending: NoticeItem[],
): NoticeState {
  let nextVisible = visible;
  let nextPending = pending;
  while (nextPending.length > 0 && nextVisible.length < MAX_NOTICES) {
    const [next, ...rest] = nextPending;
    nextVisible = [...nextVisible, next];
    nextPending = rest;
  }
  if (nextPending.length > 0 && !nextVisible.some((notice) => notice.exiting)) {
    nextVisible = markOldestNoticeExiting(nextVisible);
  }
  return { visible: nextVisible, pending: nextPending };
}

export function noticeReducer(state: NoticeState, action: NoticeAction): NoticeState {
  switch (action.type) {
    case "add": {
      // Shelf is full (or already animating one out) → queue as pending.
      if (state.visible.some((notice) => notice.exiting) || state.visible.length >= MAX_NOTICES) {
        const visible = state.visible.some((notice) => notice.exiting)
          ? state.visible
          : markOldestNoticeExiting(state.visible);
        return { visible, pending: [...state.pending, action.notice] };
      }
      return { ...state, visible: [...state.visible, action.notice] };
    }
    case "mark_oldest_exiting": {
      // No-op when all visible rows are already exiting — preserves the
      // outer state reference so React subscribers can use Object.is and
      // skip re-renders.
      const visible = markOldestNoticeExiting(state.visible);
      return visible === state.visible ? state : { ...state, visible };
    }
    case "remove": {
      const visible = state.visible.filter((notice) => notice.id !== action.id);
      return fillPendingNotices(visible, state.pending);
    }
    default:
      return state;
  }
}

/**
 * Convenience: create a fully-formed NoticeItem. Useful from call sites
 * that already have the message + type and just need the id + lifecycle.
 */
export function makeNotice(message: string, type: NoticeType = "info"): NoticeItem {
  return { id: createNoticeId(), message, type };
}

/** Initial state — empty shelf. */
export const INITIAL_NOTICE_STATE: NoticeState = { visible: [], pending: [] };