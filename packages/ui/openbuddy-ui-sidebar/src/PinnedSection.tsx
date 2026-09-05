import { useCallback, useMemo } from "react";
import { WbPinIcon, WbUnpinIcon } from "@openbuddy/ui-primitives/icons";
import { useT } from "@/lib/platform/i18n";
import { useSessionsStore } from "@/stores/sessions-store";
import { piSetSessionPinned } from "@/lib/agent/pi-client";
import type { SessionSummary } from "@openbuddy/shared-types";

/**
 * Renders the pinned section at the top of the conversation list. Pulls
 * every session from both `independent` (cwd-less) and `workspaceSessions[cwd]`
 * groups, filters by `pinned === true`, and lets the user unpin a row inline.
 *
 * Click → switch the active session. Right-click → future context menu
 * (kept as a no-op here to preserve the existing row layout).
 *
 * The previous implementation used a hard-coded mock array and a `useState`
 * array — this rewrite routes through `useSessionsStore` so the section
 * reflects the same state as the main sidebar and persists across renders.
 */
export function PinnedSection() {
  const titleLabel = useT("conversation.pinnedSection");
  const unpinLabel = useT("conversation.unpin");
  const emptyLabel = useT("conversation.pinnedSection.empty");

  const independent = useSessionsStore((s) => s.independent);
  const workspaceSessions = useSessionsStore((s) => s.workspaceSessions);
  const upsert = useSessionsStore((s) => s.upsert);
  const setCurrent = useSessionsStore((s) => s.setCurrent);

  // Flat view across both groups. Re-derives only when the underlying
  // group references change (the store keeps stable references for
  // unchanged groups).
  const pinned = useMemo<SessionSummary[]>(() => {
    const all = [...independent, ...Object.values(workspaceSessions).flat()];
    return all
      .filter((s) => s.pinned === true && s.archived !== true)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }, [independent, workspaceSessions]);

  const handleUnpin = useCallback(
    async (sessionId: string) => {
      // Optimistic local update so the row leaves the list immediately;
      // the round-trip to pi (which writes to ~/.pi/openbuddy-state.json)
      // re-affirms via SessionSummaryEvent on success.
      upsert({ sessionId, pinned: false });
      try {
        await piSetSessionPinned(sessionId, false);
      } catch (error) {
        // Roll back on failure so the row reappears.
        upsert({ sessionId, pinned: true });
        // eslint-disable-next-line no-console -- user-visible recovery hint.
        console.error("[openbuddy] failed to unpin session", sessionId, error);
      }
    },
    [upsert],
  );

  const handleSelect = useCallback(
    (sessionId: string) => {
      setCurrent(sessionId);
    },
    [setCurrent],
  );

  return (
    <div className="pinned-section">
      <div className="pinned-section__header">
        <WbPinIcon size={14} />
        <span className="pinned-section__title">{titleLabel}</span>
        {pinned.length > 0 ? (
          <span className="pinned-section__count" aria-label={`${pinned.length} pinned`}>
            {pinned.length}
          </span>
        ) : null}
      </div>
      <div className="pinned-section__list" role="list">
        {pinned.length === 0 ? (
          <div className="pinned-section__empty">{emptyLabel}</div>
        ) : (
          pinned.map((session) => (
            <div
              key={session.sessionId}
              role="listitem"
              className="pinned-session"
              data-session-id={session.sessionId}
            >
              <button
                type="button"
                className="pinned-session__content"
                onClick={() => handleSelect(session.sessionId)}
                title={session.title || session.sessionId}
              >
                <span className="pinned-session__icon" aria-hidden="true">📌</span>
                <span className="pinned-session__title">
                  {session.title || session.sessionId}
                </span>
              </button>
              <button
                type="button"
                className="pinned-session__unpin"
                onClick={() => handleUnpin(session.sessionId)}
                title={unpinLabel}
                aria-label={unpinLabel}
              >
                <WbUnpinIcon size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
