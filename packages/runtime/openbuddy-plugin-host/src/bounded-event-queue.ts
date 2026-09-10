/**
 * Bounded event queue for the Pi -> Main -> renderer event path.
 *
 * Progress events are reconstructable and may be coalesced/dropped when the
 * queue is full. Lifecycle, approval, error and final events are never
 * silently dropped: they evict the oldest progress event instead.
 */
export type EventDeliveryClass = "progress" | "delta" | "lifecycle" | "approval" | "error" | "final";

export interface BoundedEvent {
  readonly id: string;
  readonly kind: string;
  readonly delivery: EventDeliveryClass;
  readonly taskId?: string;
  readonly sequence: number;
  readonly payload: unknown;
}

export interface EnqueueResult {
  readonly accepted: boolean;
  readonly coalesced: boolean;
  readonly dropped: boolean;
}

export interface BoundedEventQueueOptions {
  readonly capacity: number;
  /** Return a stable key for events that can replace an older event. */
  readonly coalesceKey?: (event: BoundedEvent) => string | undefined;
}

const nonDroppable = new Set<EventDeliveryClass>(["lifecycle", "approval", "error", "final"]);

export class BoundedEventQueue {
  private readonly events: BoundedEvent[] = [];
  private readonly coalesced = new Map<string, BoundedEvent>();
  private readonly capacity: number;
  private readonly keyFor: (event: BoundedEvent) => string | undefined;
  private droppedCount = 0;
  private closed = false;

  constructor(options: BoundedEventQueueOptions) {
    if (!Number.isSafeInteger(options.capacity) || options.capacity < 1) {
      throw new Error("event queue capacity must be a positive integer");
    }
    this.capacity = options.capacity;
    this.keyFor = options.coalesceKey ?? ((event) => event.delivery === "delta" ? `${event.taskId ?? ""}:${event.kind}` : undefined);
  }

  get size(): number { return this.events.length; }
  get dropped(): number { return this.droppedCount; }
  get isClosed(): boolean { return this.closed; }

  enqueue(event: BoundedEvent): EnqueueResult {
    if (this.closed) return { accepted: false, coalesced: false, dropped: true };
    const key = this.keyFor(event);
    if (key !== undefined) {
      const index = this.events.findIndex((queued) => this.keyFor(queued) === key);
      if (index >= 0) {
        this.events[index] = event;
        this.coalesced.set(key, event);
        return { accepted: true, coalesced: true, dropped: false };
      }
    }
    if (this.events.length < this.capacity) {
      this.events.push(event);
      if (key !== undefined) this.coalesced.set(key, event);
      return { accepted: true, coalesced: false, dropped: false };
    }

    const evictIndex = this.events.findIndex((queued) => !nonDroppable.has(queued.delivery));
    if (evictIndex >= 0) {
      const evicted = this.events.splice(evictIndex, 1)[0];
      const evictedKey = this.keyFor(evicted);
      if (evictedKey !== undefined) this.coalesced.delete(evictedKey);
      this.droppedCount += 1;
      this.events.push(event);
      if (key !== undefined) this.coalesced.set(key, event);
      return { accepted: true, coalesced: false, dropped: false };
    }

    // A full queue containing only non-droppable events cannot accept another
    // event without violating delivery guarantees. Surface backpressure to
    // the caller rather than silently losing a critical event.
    if (nonDroppable.has(event.delivery)) {
      throw new Error("event queue is full of non-droppable events");
    }
    this.droppedCount += 1;
    return { accepted: false, coalesced: false, dropped: true };
  }

  drain(): BoundedEvent[] {
    const drained = this.events.splice(0);
    this.coalesced.clear();
    return drained;
  }

  close(): void {
    this.closed = true;
    this.drain();
  }
}
