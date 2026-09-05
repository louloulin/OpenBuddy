/**
 * NoticeList — Phase R3.0 (pi-web-alignment).
 *
 * The chat-header notice shelf. Renders up to MAX_NOTICES chips, animates
 * them out after NOTICE_VISIBLE_MS, and consumes the canonical reducer at
 * `src/lib/stream/notices/noticeReducer.ts`.
 *
 * Architecture:
 *
 *     <NoticeListProvider>          ← optional, wraps App.tsx
 *       <NoticeList />              ← presentational, subscribes to store
 *     </NoticeListProvider>
 *
 * State lives in a dedicated Zustand store (notice-store) keyed by the
 * reducer. The store exposes:
 *   - `state: NoticeState`              — current visible + pending
 *   - `push(message, type)`             — append a new notice
 *   - `markOldestExiting()`             — trigger the exit animation
 *   - `remove(id)`                      — drop a notice after the animation
 *
 * Timing is owned by this component: each row sets a NOTICE_VISIBLE_MS
 * timer on mount, fires `markOldestExiting` on expiry, then a second
 * NOTICE_EXIT_ANIMATION_MS timer fires `remove`. This mirrors pi-web's
 * ChatWindow `NoticeShelf` lifecycle exactly.
 *
 * Tests live in `__tests__/NoticeList.test.tsx`.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import {
  INITIAL_NOTICE_STATE,
  makeNotice,
  NOTICE_EXIT_ANIMATION_MS,
  NOTICE_VISIBLE_MS,
  noticeReducer,
  type NoticeItem,
  type NoticeState,
  type NoticeType,
} from "@/lib/stream/notices/noticeReducer";

/**
 * Standalone store hook so callers that don't want a Provider can still
 * drive the reducer. Pattern mirrors `useAgentSession` — the hook owns
 * the reducer lifecycle; the UI is a presentational child.
 */
export interface NoticeStore {
  state: NoticeState;
  push: (message: string, type?: NoticeType) => NoticeItem;
  markOldestExiting: () => void;
  remove: (id: string) => void;
}

const NoticeStoreContext = createContext<NoticeStore | null>(null);

export function NoticeStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(noticeReducer, INITIAL_NOTICE_STATE);
  const store = useMemo<NoticeStore>(
    () => ({
      state,
      push: (message, type = "info") => {
        const notice = makeNotice(message, type);
        dispatch({ type: "add", notice });
        return notice;
      },
      markOldestExiting: () => dispatch({ type: "mark_oldest_exiting" }),
      remove: (id) => dispatch({ type: "remove", id }),
    }),
    [state],
  );
  return (
    <NoticeStoreContext.Provider value={store}>
      {children}
    </NoticeStoreContext.Provider>
  );
}

export function useNoticeStore(): NoticeStore {
  const ctx = useContext(NoticeStoreContext);
  if (ctx) return ctx;
  // Fallback: a fresh hook-local store so tests + non-provider mount-sites
  // still get a working shelf.
  const [state, dispatch] = useReducer(noticeReducer, INITIAL_NOTICE_STATE);
  return useMemo<NoticeStore>(
    () => ({
      state,
      push: (message, type = "info") => {
        const notice = makeNotice(message, type);
        dispatch({ type: "add", notice });
        return notice;
      },
      markOldestExiting: () => dispatch({ type: "mark_oldest_exiting" }),
      remove: (id) => dispatch({ type: "remove", id }),
    }),
    [state],
  );
}

/**
 * Visual shelf. Subscribes to a NoticeStore and animates entries out
 * after NOTICE_VISIBLE_MS. Each visible row registers two timers:
 *   - visible timer → markOldestExiting (exits one chip)
 *   - exit timer    → remove (clears from state)
 * Timers are scoped to the row id so re-renders or pending promotions
 * never restart an in-flight exit.
 */
export function NoticeList({ className }: { className?: string }) {
  const { state, markOldestExiting, remove } = useNoticeStore();

  // Drive timers per visible row. `state.visible` may shift on every
  // tick (pending → visible) so we key the effect on the row id list,
  // not the state object reference.
  const visibleIds = state.visible.map((n) => n.id).join("|");
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    state.visible.forEach((notice) => {
      timers.push(
        setTimeout(() => {
          markOldestExiting();
        }, NOTICE_VISIBLE_MS),
      );
      if (notice.exiting) {
        timers.push(
          setTimeout(() => {
            remove(notice.id);
          }, NOTICE_VISIBLE_MS + NOTICE_EXIT_ANIMATION_MS),
        );
      }
    });
    return () => timers.forEach(clearTimeout);
    // We intentionally depend on visibleIds (stable string of ids) rather
    // than the array reference, so reordering pending promotions doesn't
    // re-arm timers for stable rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIds]);

  if (state.visible.length === 0) return null;

  return (
    <div
      className={`notice-shelf${className ? ` ${className}` : ""}`}
      role="status"
      aria-live="polite"
      data-testid="notice-shelf"
    >
      {state.visible.map((notice) => (
        <NoticeChip key={notice.id} notice={notice} />
      ))}
    </div>
  );
}

function NoticeChip({ notice }: { notice: NoticeItem }) {
  return (
    <span
      className={`notice-chip notice-chip--${notice.type}${notice.exiting ? " notice-chip--exiting" : ""}`}
      data-testid={`notice-${notice.type}`}
      role="alert"
      aria-live={notice.type === "error" ? "assertive" : "polite"}
    >
      {notice.message}
    </span>
  );
}