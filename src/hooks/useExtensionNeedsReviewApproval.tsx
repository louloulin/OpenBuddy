import { useCallback, useEffect, useRef, useState } from "react";

import {
  agentApproveNeedsReview,
  agentNeedsReviewState,
  agentOnPluginEvent,
  agentPluginEvents,
  agentRejectNeedsReview,
  type NeedsReviewPendingEntry,
  type NeedsReviewStateSummary,
  type OpenBuddyPluginEvent,
} from "../lib/agent/pi-client";

/**
 * useExtensionNeedsReviewApproval — React hook that surfaces the
 * `pi/extension-needs-review-pending` event stream from the agent
 * host (plan4.5 §B) and exposes Approve / Reject mutators that round-
 * trip through `extension:approve-needs-review` /
 * `extension:reject-needs-review`.
 *
 * The hook owns a single summary object for the lifetime of the
 * component; live events from the plugin-event bus mutate the
 * summary in place so the modal can re-render in real time.
 *
 * Ordering note: the hook installs the live subscription FIRST
 * (before the on-mount snapshot read) so a synchronous event
 * dispatched during `agentOnPluginEvent` cannot race with the
 * catch-up read.
 */
export interface UseExtensionNeedsReviewApprovalResult extends NeedsReviewStateSummary {
  approve: (id: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
}

const EMPTY_SUMMARY: NeedsReviewStateSummary = Object.freeze({
  pending: [] as NeedsReviewPendingEntry[],
  pendingCount: 0,
  approvedCount: 0,
  rejectedCount: 0,
});

function isPendingEvent(event: OpenBuddyPluginEvent): event is OpenBuddyPluginEvent & { payload: NeedsReviewStateSummary } {
  if (event.type !== "pi/extension-needs-review-pending") return false;
  const payload = event.payload;
  if (!payload || typeof payload !== "object") return false;
  return typeof (payload as { pendingCount?: unknown }).pendingCount === "number";
}

export function useExtensionNeedsReviewApproval(): UseExtensionNeedsReviewApprovalResult {
  const [summary, setSummary] = useState<NeedsReviewStateSummary>(() => ({ ...EMPTY_SUMMARY }));
  const latestRef = useRef<NeedsReviewStateSummary>(summary);
  latestRef.current = summary;

  const applySummary = useCallback((next: NeedsReviewStateSummary) => {
    setSummary({
      pending: [...next.pending],
      pendingCount: next.pendingCount,
      approvedCount: next.approvedCount,
      rejectedCount: next.rejectedCount,
    });
  }, []);

  // User-interaction flag — flipped by approve/reject. The mount-time
  // snapshot read checks this flag before applying its result, so a
  // slow IPC roundtrip cannot race a user click and overwrite the
  // freshly mutated summary.
  const userTouchedRef = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    // Track whether ANY event has been observed (live or cached). Once
    // true, the mount-time snapshot read is skipped — otherwise a slow
    // `agentNeedsReviewState()` roundtrip can race a user click and
    // overwrite the freshly approved/rejected summary with stale data.
    let sawAnyEvent = false;
    // 1. Install live subscription FIRST so synchronous dispatchers
    //    (and tests that don't `await` after `render`) still see a
    //    handler.
    (async () => {
      try {
        const dispose = await agentOnPluginEvent((event: OpenBuddyPluginEvent) => {
          if (isPendingEvent(event)) {
            sawAnyEvent = true;
            applySummary(event.payload);
          }
        });
        if (cancelled) {
          dispose();
          return;
        }
        unlisten = dispose;
      } catch {
        return;
      }
      // 2. Hydrate from the cached event ring buffer (catches
      //    pending summaries emitted before the modal mounted).
      try {
        const cached = await agentPluginEvents();
        if (cancelled) return;
        for (const event of cached) {
          if (isPendingEvent(event)) {
            sawAnyEvent = true;
            applySummary(event.payload);
          }
        }
      } catch {
        // Bridge down — non-fatal. The live subscription still
        // works once the bridge recovers.
      }
      // 3. Fresh IPC snapshot ONLY if no event has reached us yet AND
      //    the user has not already mutated state. This is the
      //    catch-up path for the case where main emitted the pending
      //    summary before the renderer's plugin-event ring buffer
      //    had it (cold start) — but we must not overwrite a state
      //    the user has already mutated.
      if (sawAnyEvent || userTouchedRef.current) return;
      try {
        const snapshot = await agentNeedsReviewState();
        if (cancelled) return;
        applySummary(snapshot);
      } catch {
        // Non-fatal — the modal can start with an empty summary.
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [applySummary]);

  const approve = useCallback(
    async (id: string) => {
      if (typeof id !== "string" || id.length === 0) return;
      userTouchedRef.current = true;
      const result = await agentApproveNeedsReview(id);
      applySummary(result.summary);
    },
    [applySummary],
  );

  const reject = useCallback(
    async (id: string) => {
      if (typeof id !== "string" || id.length === 0) return;
      userTouchedRef.current = true;
      const result = await agentRejectNeedsReview(id);
      applySummary(result.summary);
    },
    [applySummary],
  );

  return {
    pending: summary.pending,
    pendingCount: summary.pendingCount,
    approvedCount: summary.approvedCount,
    rejectedCount: summary.rejectedCount,
    approve,
    reject,
  };
}
