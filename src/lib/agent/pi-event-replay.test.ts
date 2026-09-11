import { describe, expect, it } from "vitest";
import { createPiEventReplayCoordinator, eventSequence } from "./pi-event-replay";

describe("pi event replay coordinator", () => {
  it("merges replay and live events in sequence order and de-duplicates", () => {
    const coordinator = createPiEventReplayCoordinator(10);
    const applied: string[] = [];
    coordinator.begin();

    coordinator.acceptLive({ sequence: 13 }, () => applied.push("live-13"));
    coordinator.acceptLive({ sequence: 12 }, () => applied.push("live-12"));
    coordinator.acceptLive({ sequence: 14 }, () => applied.push("live-14"));

    coordinator.finish([
      { sequence: 11, dispatch: () => applied.push("replay-11") },
      { sequence: 13, dispatch: () => applied.push("replay-13") },
    ]);

    expect(applied).toEqual(["replay-11", "live-12", "replay-13", "live-14"]);
    expect(coordinator.cursor()).toBe(14);
  });

  it("drains queued live events when replay fails", () => {
    const coordinator = createPiEventReplayCoordinator();
    const applied: number[] = [];
    coordinator.begin();
    coordinator.acceptLive({ sequence: 2 }, () => applied.push(2));
    coordinator.acceptLive({ sequence: 1 }, () => applied.push(1));

    coordinator.fail();

    expect(applied).toEqual([1, 2]);
    expect(coordinator.cursor()).toBe(2);
  });

  it("dispatches unsequenced events immediately", () => {
    const coordinator = createPiEventReplayCoordinator(5);
    const applied: string[] = [];
    coordinator.begin();
    coordinator.acceptLive({ sessionId: "s1" }, () => applied.push("permission"));

    expect(applied).toEqual(["permission"]);
    expect(eventSequence({ sequence: 6 })).toBe(6);
    expect(eventSequence({ sequence: 1.5 })).toBeUndefined();
    expect(eventSequence({})).toBeUndefined();
  });
});
