import { describe, expect, it } from "vitest";
import { createStorageEvent, redactStorageValue, StorageGateway, type StorageDriver, type StorageEventEnvelope, type StorageTransaction } from "../index";

function fakeDriver() {
  const notifications: StorageEventEnvelope[] = [];
  const events: StorageEventEnvelope[] = [];
  const results = new Map<string, unknown>();
  const transaction: StorageTransaction = {
    findIdempotentResult: async (key) => results.has(key) ? { found: true, value: results.get(key) } : { found: false, value: undefined },
    appendEvent: async (event) => { events.push(event); },
    saveIdempotentResult: async (key, result) => { results.set(key, result); },
    applyProjection: async () => undefined,
  };
  return {
    notifications, events, results,
    driver: {
      migrate: async () => ({ applied: 0, finalVersion: 0, history: [] }),
      transaction: async (callback) => callback(transaction),
      integrityCheck: async () => ({ ok: true }),
      backup: async (path) => ({ path, schemaVersion: 1 }),
      close: () => undefined,
    } satisfies StorageDriver,
  };
}

describe("StorageGateway contract", () => {
  it("redacts secret-shaped keys and strings", () => {
    expect(redactStorageValue({ apiKey: "secret", text: "Bearer abc123" }))
      .toEqual({ apiKey: "[redacted]", text: "Bearer [redacted]" });
  });

  it("appends once and returns the original result for an idempotent retry", async () => {
    const state = fakeDriver();
    const gateway = new StorageGateway(state.driver, {
      now: () => new Date("2026-08-30T00:00:00.000Z"),
      notifyCommitted: (event) => state.notifications.push(event),
    });
    const command = {
      id: "event-1", stream: "session-1", streamSequence: 1, type: "session/renamed",
      actor: "user", idempotencyKey: "rename-1", payload: { name: "Demo" },
      apply: async () => ({ ok: true }),
    };
    await expect(gateway.execute(command)).resolves.toEqual({ ok: true });
    await expect(gateway.execute(command)).resolves.toEqual({ ok: true });
    expect(state.events).toHaveLength(1);
    expect(state.notifications).toHaveLength(1);
  });

  it("hashes the redacted payload via createStorageEvent", () => {
    const event = createStorageEvent({
      id: "e1", stream: "s", streamSequence: 1, type: "t", actor: "u",
      idempotencyKey: "k", payload: { apiKey: "secret", text: "hi" },
    }, new Date("2026-08-30T10:00:00.000Z"));
    expect(event.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(event.payload).toEqual({ apiKey: "[redacted]", text: "hi" });
  });

  it("treats an undefined result as a durable idempotent completion", async () => {
    const state = fakeDriver();
    const gateway = new StorageGateway(state.driver);
    let executions = 0;
    const command = {
      id: "event-undefined", stream: "session-1", streamSequence: 2, type: "session/cleared",
      actor: "user", idempotencyKey: "clear-1", payload: { cleared: true },
      apply: async () => { executions += 1; return undefined; },
    };
    await expect(gateway.execute(command)).resolves.toBeUndefined();
    await expect(gateway.execute(command)).resolves.toBeUndefined();
    expect(executions).toBe(1);
    expect(state.events).toHaveLength(1);
  });
});
