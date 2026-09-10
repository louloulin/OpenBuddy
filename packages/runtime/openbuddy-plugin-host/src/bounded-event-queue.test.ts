import { describe, expect, it } from "vitest";
import { BoundedEventQueue, type BoundedEvent } from "./bounded-event-queue";

const event = (id: string, delivery: BoundedEvent["delivery"], sequence = Number(id)): BoundedEvent => ({ id, kind: delivery, delivery, taskId: "task", sequence, payload: id });

describe("BoundedEventQueue", () => {
  it("coalesces deltas and remains bounded", () => {
    const queue = new BoundedEventQueue({ capacity: 2 });
    expect(queue.enqueue(event("1", "delta"))).toMatchObject({ accepted: true });
    expect(queue.enqueue(event("2", "delta"))).toMatchObject({ accepted: true, coalesced: true });
    expect(queue.size).toBe(1);
    expect(queue.drain().map((item) => item.id)).toEqual(["2"]);
  });

  it("evicts progress before dropping critical events", () => {
    const queue = new BoundedEventQueue({ capacity: 2 });
    queue.enqueue(event("1", "progress"));
    queue.enqueue(event("2", "lifecycle"));
    expect(queue.enqueue(event("3", "final"))).toMatchObject({ accepted: true });
    expect(queue.dropped).toBe(1);
    expect(queue.drain().map((item) => item.id)).toEqual(["2", "3"]);
  });

  it("reports backpressure when all queued events are critical", () => {
    const queue = new BoundedEventQueue({ capacity: 1 });
    queue.enqueue(event("1", "approval"));
    expect(() => queue.enqueue(event("2", "error"))).toThrow("full of non-droppable");
    expect(queue.dropped).toBe(0);
  });

  it("closes deterministically and rejects future events", () => {
    const queue = new BoundedEventQueue({ capacity: 1 });
    queue.enqueue(event("1", "progress"));
    queue.close();
    expect(queue.size).toBe(0);
    expect(queue.enqueue(event("2", "final"))).toMatchObject({ accepted: false, dropped: true });
  });
});
