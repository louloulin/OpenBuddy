export interface ReplayDispatch {
  sequence: number;
  dispatch: () => void;
}

export interface ReplayCursor {
  earliestSequence: number;
  latestSequence: number;
  generation: number;
  available: number;
}

export interface ReplayGapInfo {
  /** The cursor the renderer held before asking for replay. */
  requestedFromSequence: number;
  /** First sequence still available in the bridge ring buffer. */
  earliestSequence: number;
  /** `requestedFromSequence > earliestSequence` means eviction happened. */
  gap: boolean;
  /** How many sequence numbers are missing from the renderer's view. */
  missing: number;
}

export interface PiEventReplayCoordinator {
  readonly cursor: () => number;
  begin(): void;
  acceptLive(payload: unknown, dispatch: () => void): void;
  finish(replayed: readonly ReplayDispatch[]): void;
  fail(): void;
}

function isFiniteSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function eventSequence(payload: unknown): number | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const sequence = (payload as { sequence?: unknown }).sequence;
  return isFiniteSequence(sequence) ? sequence : undefined;
}

export function detectReplayGap(
  fromSequence: number,
  cursor: ReplayCursor | undefined,
): ReplayGapInfo {
  const earliest = cursor?.earliestSequence ?? 0;
  const hasCursor = cursor !== undefined;
  // When the renderer has not seen any events yet, `fromSequence === 0` is
  // not a gap — only positive cursors that precede the bridge's earliest
  // available sequence signal eviction.
  const gap = hasCursor && fromSequence > 0 && fromSequence > earliest;
  const missing = gap ? Math.max(0, fromSequence - earliest) : 0;
  return {
    requestedFromSequence: fromSequence,
    earliestSequence: earliest,
    gap,
    missing,
  };
}

/**
 * Coordinates a live subscription with a cursor-based replay.
 *
 * Live events are queued while replay is in flight. `finish()` merges both
 * streams by global sequence, preferring replay for an equal sequence, and
 * advances the cursor before dispatch so a handler failure cannot cause the
 * same event to be delivered repeatedly on the next reconnect.
 */
export function createPiEventReplayCoordinator(initialCursor = 0): PiEventReplayCoordinator {
  let lastSequence = isFiniteSequence(initialCursor) ? initialCursor : 0;
  let replaying = false;
  let pending: ReplayDispatch[] = [];

  const dispatchOrdered = (events: readonly ReplayDispatch[]): void => {
    const seen = new Set<number>();
    const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
    for (const event of ordered) {
      if (event.sequence <= lastSequence || seen.has(event.sequence)) continue;
      seen.add(event.sequence);
      lastSequence = event.sequence;
      try {
        event.dispatch();
      } catch {
        // A renderer handler must not break cursor advancement or replay drain.
      }
    }
  };

  return {
    cursor: () => lastSequence,
    begin() {
      replaying = true;
      pending = [];
    },
    acceptLive(payload, dispatch) {
      const sequence = eventSequence(payload);
      if (sequence === undefined) {
        dispatch();
        return;
      }
      if (sequence <= lastSequence) return;
      if (replaying) {
        if (!pending.some((event) => event.sequence === sequence)) {
          pending.push({ sequence, dispatch });
        }
        return;
      }
      dispatchOrdered([{ sequence, dispatch }]);
    },
    finish(replayed) {
      const live = pending;
      pending = [];
      replaying = false;
      dispatchOrdered([...replayed, ...live]);
    },
    fail() {
      const live = pending;
      pending = [];
      replaying = false;
      dispatchOrdered(live);
    },
  };
}
