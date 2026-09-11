export interface ReplayDispatch {
  sequence: number;
  dispatch: () => void;
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
