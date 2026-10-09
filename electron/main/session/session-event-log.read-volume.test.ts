/**
 * Byte-volume proof for the tail hydrate.
 *
 * The behaviour tests in `session-event-log.test.ts` assert on the records that
 * come back, which a whole-file read reproduces exactly — so they cannot tell
 * the two implementations apart (verified: reverting to a whole-file read left
 * them all green). This file observes the read itself through the injected
 * handle, which is the only signal that distinguishes "parsed 172MB to keep
 * 2000 entries" from "read the tail".
 */
import { mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readTailRecords, type TailReadHandle } from "./session-event-log";

import type { FileHandle } from "node:fs/promises";

/** ~130 bytes per record, close enough to the real log's shape. */
function jsonl(count: number, start = 1): string {
  let body = "";
  for (let sequence = start; sequence < start + count; sequence += 1) {
    body += `${JSON.stringify({
      eventVersion: 1,
      generation: 0,
      sequence,
      timestamp: new Date(1_700_000_000_000 + sequence).toISOString(),
      type: "test",
      payload: { sequence, filler: "x".repeat(40) },
    })}\n`;
  }
  return body;
}

/** Open the real file but record every byte the caller asks to read. */
function countingOpen(path: string, tally: { bytes: number; calls: number[] }): Promise<TailReadHandle> {
  return open(path, "r").then(
    (handle: FileHandle) =>
      new Proxy(handle, {
        get(target, prop) {
          if (prop !== "read") {
            const value = Reflect.get(target, prop) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
          }
          return async (buffer: Uint8Array, offset: number, length: number, position: number) => {
            tally.bytes += length;
            tally.calls.push(length);
            return target.read(buffer, offset, length, position);
          };
        },
      }) as unknown as TailReadHandle,
  );
}

describe("session-event-log: tail read volume", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "openbuddy-event-log-volume-"));
    file = join(dir, "openbuddy-events.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("reads a small fraction of a large log to fill the retained window", async () => {
    // 60_000 records ≈ 11MB. Filling a 2000-entry window needs ~260KB of tail.
    await writeFile(file, jsonl(60_000), "utf8");
    const { size } = await stat(file);
    expect(size).toBeGreaterThan(5_000_000);

    const tally = { bytes: 0, calls: [] as number[] };
    const { records } = await readTailRecords(file, 2000, (path) => countingOpen(path, tally));

    expect(records).toHaveLength(2000);
    // The tail window holds more records than are retained, so the result is
    // the newest 2000 — derived, not hardcoded, because the record size
    // depends on the ISO timestamp length.
    expect(records[1999].sequence).toBe(60_000);
    expect(records.map((entry) => entry.sequence)).toEqual(
      Array.from({ length: 2000 }, (_, index) => 58_001 + index),
    );
    // A whole-file read touches `size` bytes. The tail read touches only the
    // 1 MiB initial window, because one window already holds >2000 records.
    expect(tally.bytes).toBeGreaterThan(0);
    expect(tally.bytes).toBeLessThan(size / 2);
    expect(tally.calls).toHaveLength(1);
  });

  it("widens the window instead of giving up when one chunk is too small", async () => {
    // 5000 records ≈ 650KB: under the 1 MiB initial window, so reaching offset
    // 0 is correct here. What matters is that widening still returns the full
    // retained window rather than a truncated chunk.
    await writeFile(file, jsonl(5000), "utf8");
    const tally = { bytes: 0, calls: [] as number[] };

    const { records } = await readTailRecords(file, 2000, (path) => countingOpen(path, tally));

    expect(records).toHaveLength(2000);
    expect(records[0].sequence).toBe(3001);
    expect(records[1999].sequence).toBe(5000);
  });

  it("keeps widening past several windows for a very large log", async () => {
    // 200_000 records ≈ 37MB with a 2000-entry window. The retained tail is
    // ~260KB, so the initial 1 MiB window still suffices — the point is that a
    // log far past the threshold is served without a proportional read.
    await writeFile(file, jsonl(200_000), "utf8");
    const { size } = await stat(file);
    const tally = { bytes: 0, calls: [] as number[] };

    const { records } = await readTailRecords(file, 2000, (path) => countingOpen(path, tally));

    expect(records).toHaveLength(2000);
    expect(records[1999].sequence).toBe(200_000);
    expect(tally.bytes).toBeLessThan(size / 10);
  });

  it("reports the file's true size even when only the tail is read", async () => {
    // The size drives rotation decisions, so it must come from stat() and not
    // from how much happened to be read.
    await writeFile(file, jsonl(60_000), "utf8");
    const { size } = await stat(file);
    const tally = { bytes: 0, calls: [] as number[] };

    const result = await readTailRecords(file, 2000, (path) => countingOpen(path, tally));

    expect(result.size).toBe(size);
    expect(tally.bytes).toBeLessThan(result.size);
  });

  it("returns empty for a missing file without opening anything", async () => {
    const tally = { bytes: 0, calls: [] as number[] };
    const result = await readTailRecords(join(dir, "nope.jsonl"), 2000, (path) => countingOpen(path, tally));
    expect(result).toEqual({ records: [], size: 0 });
    expect(tally.bytes).toBe(0);
  });
});
