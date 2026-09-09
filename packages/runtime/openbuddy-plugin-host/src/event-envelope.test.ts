import { describe, expect, it } from "vitest";
import { createEventEnvelope, validateEventEnvelope } from "./event-envelope";

describe("event envelope", () => {
  it("creates the versioned, sequenced wire shape", () => {
    const event = createEventEnvelope({
      eventId: "evt-1",
      taskId: "task-1",
      sessionId: "session-1",
      generation: 3,
      sequence: 8,
      timestamp: "2026-09-09T16:00:00.000Z",
      kind: "task.progress",
      payload: { completed: 2, labels: ["safe"] },
    });

    expect(event).toMatchObject({ schemaVersion: 1, eventId: "evt-1", generation: 3, sequence: 8 });
    expect(() => validateEventEnvelope(event)).not.toThrow();
    expect(Object.isFrozen(event)).toBe(true);
  });

  it.each([
    ["negative generation", { generation: -1 }],
    ["fractional sequence", { sequence: 1.5 }],
    ["empty event id", { eventId: "" }],
    ["invalid timestamp", { timestamp: "not-a-date" }],
    ["non-json payload", { payload: new Date() }],
  ])("rejects %s", (_label, patch) => {
    const input = {
      eventId: "evt-1",
      generation: 0,
      sequence: 0,
      timestamp: "2026-09-09T16:00:00.000Z",
      kind: "test",
      payload: { ok: true },
      ...patch,
    };
    expect(() => createEventEnvelope(input as never)).toThrow();
  });

  it("rejects unsupported versions and cyclic payloads", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => createEventEnvelope({
      eventId: "evt-1", generation: 0, sequence: 0,
      timestamp: "2026-09-09T16:00:00.000Z", kind: "test", payload: cyclic as never,
    })).toThrow("payload");

    expect(() => validateEventEnvelope({
      schemaVersion: 2, eventId: "evt-1", generation: 0, sequence: 0,
      timestamp: "2026-09-09T16:00:00.000Z", kind: "test", payload: null,
    })).toThrow("schemaVersion");
  });
});
