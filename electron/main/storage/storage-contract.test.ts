import { describe, expect, it } from "vitest";
import { StorageGateway, type StorageDriver, type StorageEventEnvelope, type StorageTransaction, redactStorageValue } from "@openbuddy/storage";

function fakeDriver(): { driver: StorageDriver; events: StorageEventEnvelope[]; results: Map<string, unknown> } {
  const events: StorageEventEnvelope[] = [];
  const results = new Map<string, unknown>();
  const transaction: StorageTransaction = {
    findIdempotentResult: async (key) => results.has(key) ? { found: true, value: results.get(key) } : { found: false, value: undefined },
    appendEvent: async (event) => { events.push(event); },
    saveIdempotentResult: async (key, result) => { results.set(key, result); },
    applyProjection: async () => undefined,
  };
  return {
    events,
    results,
    driver: {
      migrate: async () => ({ applied: 0, finalVersion: 0, history: [] }),
      transaction: async (callback) => callback(transaction),
      integrityCheck: async () => ({ ok: true }),
      backup: async (path) => ({ path, schemaVersion: 1 }),
      close: () => undefined,
    },
  };
}

describe("storage contract", () => {
  it("redacts secret-shaped keys and strings", () => {
    expect(redactStorageValue({ apiKey: "secret", text: "Bearer abc123" })).toEqual({ apiKey: "[redacted]", text: "Bearer [redacted]" });
  });

  it("appends once and returns the original result for an idempotent retry", async () => {
    const state = fakeDriver();
    const notifications: StorageEventEnvelope[] = [];
    const gateway = new StorageGateway(state.driver, { now: () => new Date("2026-08-30T00:00:00.000Z"), notifyCommitted: (event) => notifications.push(event) });
    const command = {
      id: "event-1", stream: "session-1", streamSequence: 1, type: "session/renamed", actor: "user", idempotencyKey: "rename-1", payload: { name: "Demo" },
      apply: async () => ({ ok: true }),
    };
    await expect(gateway.execute(command)).resolves.toEqual({ ok: true });
    await expect(gateway.execute(command)).resolves.toEqual({ ok: true });
    expect(state.events).toHaveLength(1);
    expect(notifications).toHaveLength(1);
  });
});
