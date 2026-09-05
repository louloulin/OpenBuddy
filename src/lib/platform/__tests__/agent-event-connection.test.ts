import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createAgentEventConnection,
  anyBusy,
  DEFAULT_IDLE_GRACE_MS,
  type AgentEventConnection,
} from "../agent-event-connection";

/**
 * pi-web-alignment — covers the bridge lifecycle abstraction. The
 * connection is the contract that replaces the historical "subscribe
 * once + manual resubscribe" pattern. Tests run real timers via
 * `vi.useFakeTimers()` so the 30s grace window is observable.
 */

describe("createAgentEventConnection", () => {
  let unlistens: Array<() => void>;
  let subscribed: number;
  let closedCount: number;
  let conn: AgentEventConnection;

  beforeEach(() => {
    vi.useFakeTimers();
    unlistens = [];
    subscribed = 0;
    closedCount = 0;
    conn = createAgentEventConnection({
      subscribe: async () => {
        subscribed += 1;
        const handle = () => {
          const idx = unlistens.indexOf(handle);
          if (idx !== -1) unlistens.splice(idx, 1);
        };
        unlistens.push(handle);
        return handle;
      },
      onClosed: () => {
        closedCount += 1;
      },
      idleGraceMs: 200,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    conn.close();
  });

  it("ensureConnected opens the bridge once and is idempotent", async () => {
    await conn.ensureConnected();
    await conn.ensureConnected();
    expect(subscribed).toBe(1);
    expect(conn.hasConnected).toBe(true);
    expect(unlistens.length).toBe(1);
  });

  it("markBusy keeps the channel warm and re-opens after grace", async () => {
    await conn.ensureConnected();
    expect(unlistens.length).toBe(1);
    conn.markIdle();
    vi.advanceTimersByTime(150);
    // not yet elapsed
    expect(unlistens.length).toBe(1);
    vi.advanceTimersByTime(100);
    // grace elapsed → closed
    expect(unlistens.length).toBe(0);
    expect(closedCount).toBe(1);
    conn.markBusy();
    // Should re-subscribe automatically
    expect(subscribed).toBe(2);
    await Promise.resolve();
    expect(unlistens.length).toBe(1);
  });

  it("markBusy cancels a pending grace window", async () => {
    await conn.ensureConnected();
    conn.markIdle();
    vi.advanceTimersByTime(100);
    expect(unlistens.length).toBe(1);
    conn.markBusy();
    vi.advanceTimersByTime(500);
    expect(unlistens.length).toBe(1);
    expect(closedCount).toBe(0);
  });

  it("close() tears down immediately and cancels grace without firing onClosed", async () => {
    await conn.ensureConnected();
    conn.markIdle();
    vi.advanceTimersByTime(100);
    conn.close();
    expect(unlistens.length).toBe(0);
    vi.advanceTimersByTime(500);
    expect(closedCount).toBe(0); // close() is direct — no onClosed
  });

  it("nextRunId allocates monotonically increasing ids", () => {
    expect(conn.nextRunId()).toBe(1);
    expect(conn.nextRunId()).toBe(2);
    expect(conn.nextRunId()).toBe(3);
  });

  it("re-subscribe after manual close works", async () => {
    await conn.ensureConnected();
    conn.close();
    await conn.ensureConnected();
    expect(subscribed).toBe(2);
  });

  it("markIdle when not connected is a no-op (no spurious grace timer)", () => {
    conn.markIdle();
    vi.advanceTimersByTime(500);
    expect(closedCount).toBe(0);
    expect(unlistens.length).toBe(0);
  });

  it("grace timer fires onClosed exactly once even after multiple markIdle cycles", async () => {
    await conn.ensureConnected();
    conn.markIdle();
    conn.markBusy();
    conn.markIdle();
    vi.advanceTimersByTime(250);
    expect(closedCount).toBe(1);
    conn.markIdle();
    vi.advanceTimersByTime(500);
    // Second markIdle had no unlisten to arm against, so no extra close.
    expect(closedCount).toBe(1);
  });
});

describe("anyBusy", () => {
  it("returns true if any signal is true", () => {
    expect(anyBusy(false, false, true)).toBe(true);
    expect(anyBusy(false, false, false)).toBe(false);
    expect(anyBusy()).toBe(false);
  });
});

describe("DEFAULT_IDLE_GRACE_MS", () => {
  it("matches pi-web's 30 second window", () => {
    expect(DEFAULT_IDLE_GRACE_MS).toBe(30_000);
  });
});
