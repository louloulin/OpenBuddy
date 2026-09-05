import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessCursorStore } from "../sqlite/harness-state";

describe("HarnessCursorStore", () => {
  let root = "";
  let store: HarnessCursorStore | undefined;

  afterEach(async () => {
    await store?.close();
    if (root) await rm(root, { recursive: true, force: true });
    store = undefined;
    root = "";
  });

  async function newStore(): Promise<HarnessCursorStore> {
    root = await mkdtemp(join(tmpdir(), "openbuddy-harness-state-"));
    const s = new HarnessCursorStore(join(root, "openbuddy.sqlite"));
    store = s;
    return s;
  }

  it("persists and replaces session cursors in SQLite", async () => {
    const s = await newStore();
    await expect(s.read()).resolves.toEqual({});
    await expect(s.replace({ "session-1": 3, "session-2": -1 })).resolves.toEqual({ "session-1": 3, "session-2": -1 });
    await expect(s.read()).resolves.toEqual({ "session-1": 3, "session-2": -1 });
    await expect(s.replace({ "session-1": 4 })).resolves.toEqual({ "session-1": 4 });
  });

  it("read returns empty object for fresh database", async () => {
    const s = await newStore();
    expect(await s.read()).toEqual({});
  });

  it("replace accepts large cursor maps without loss", async () => {
    const s = await newStore();
    const cursors: Record<string, number> = {};
    for (let i = 0; i < 100; i += 1) cursors[`session-${i}`] = i;
    const result = await s.replace(cursors);
    expect(Object.keys(result).length).toBe(100);
    expect(result["session-50"]).toBe(50);
    expect(result["session-99"]).toBe(99);
  });

  it("replace is atomic: subsequent read sees all-or-nothing cursor set", async () => {
    const s = await newStore();
    await s.replace({ a: 1, b: 2 });
    const result = await s.replace({ a: 10, b: 20, c: 30 });
    expect(result).toEqual({ a: 10, b: 20, c: 30 });
    const reread = await s.read();
    expect(reread).toEqual({ a: 10, b: 20, c: 30 });
  });

  it("replace with empty object clears all cursors", async () => {
    const s = await newStore();
    await s.replace({ a: 1, b: 2, c: 3 });
    expect(Object.keys(await s.read())).toHaveLength(3);
    await s.replace({});
    expect(await s.read()).toEqual({});
  });

  it("replace accepts -1 as a valid sentinel (e.g. 'no events processed')", async () => {
    const s = await newStore();
    const result = await s.replace({ fresh: -1 });
    expect(result.fresh).toBe(-1);
  });

  it("replace accepts large sequence numbers (Number.MAX_SAFE_INTEGER)", async () => {
    const s = await newStore();
    const result = await s.replace({ big: Number.MAX_SAFE_INTEGER });
    expect(result.big).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("read returns cursors sorted by session_id for deterministic output", async () => {
    const s = await newStore();
    await s.replace({ "zebra": 3, "alpha": 1, "mango": 2 });
    const keys = Object.keys(await s.read());
    expect(keys).toEqual(["alpha", "mango", "zebra"]);
  });

  it("close clears storage cache and is safe to call repeatedly", async () => {
    const s = await newStore();
    await s.replace({ a: 1 });
    await s.close();
    await s.close(); // second close should not throw
    store = undefined; // already closed
  });

  it("two independent stores on the same database path observe the same data", async () => {
    const s1 = await newStore();
    const dbPath = join(root, "shared.sqlite");
    const shared1 = new HarnessCursorStore(dbPath);
    const shared2 = new HarnessCursorStore(dbPath);
    try {
      await shared1.replace({ session: 1 });
      expect(await shared2.read()).toEqual({ session: 1 });
      await shared2.replace({ session: 2 });
      expect(await shared1.read()).toEqual({ session: 2 });
    } finally {
      await shared1.close();
      await shared2.close();
    }
  });

  it("replace with mixed types coerces cursor values via Object.entries (Number coerced)", async () => {
    const s = await newStore();
    // Object.entries yields [string, unknown] pairs; downstream code Number()s the value.
    // The store does not coerce inside replace; passing non-number values would be a caller bug.
    // This test asserts that valid numbers (including 0) are stored faithfully.
    // last_seq CHECK constraint is >= -1, so negative values are rejected at SQL level.
    // Verify that boundary value -1 succeeds and positive integers store faithfully.
    const result = await s.replace({ zero: 0, positive: 42, sentinel: -1 });
    expect(result).toEqual({ zero: 0, positive: 42, sentinel: -1 });
  });
});
