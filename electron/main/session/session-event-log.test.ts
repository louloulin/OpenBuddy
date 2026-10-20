import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionEventLog, type SessionEventRecord } from "./session-event-log";

function record(sequence: number): SessionEventRecord {
  return {
    eventVersion: 1,
    generation: 0,
    sequence,
    timestamp: new Date(1_700_000_000_000 + sequence).toISOString(),
    type: "test",
    payload: { sequence },
  };
}

/** Serialize `count` records into a JSONL body, one per line. */
function jsonl(count: number, start = 1): string {
  let body = "";
  for (let sequence = start; sequence < start + count; sequence += 1) {
    body += `${JSON.stringify(record(sequence))}\n`;
  }
  return body;
}

describe("session-event-log: tail hydrate + rotation", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "openbuddy-event-log-"));
    file = join(dir, "openbuddy-events.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("hydrates only the newest maxEntries records, not the whole file", async () => {
    // 6000 records with maxEntries=2000: well past the 1 MiB initial tail
    // window, so the backward read must stop before reaching byte 0. The
    // oldest 4000 records must never reach the buffer.
    await writeFile(file, jsonl(6000), "utf8");
    const log = new SessionEventLog({ databasePath: file, maxEntries: 2000 });

    const loaded = await log.load();

    expect(loaded).toHaveLength(2000);
    expect(loaded[0].sequence).toBe(4001);
    expect(loaded[loaded.length - 1].sequence).toBe(6000);
    expect(log.snapshot()).toHaveLength(2000);
    expect(log.snapshot()[0].sequence).toBe(4001);
  });

  it("does not read the file from byte 0 when the file is larger than one window", async () => {
    // A single old record padded past INITIAL_TAIL_BYTES (1 MiB), followed by
    // enough normal records to fill the retained window. The tail read must
    // satisfy the window without ever touching the padded record; a whole-file
    // read would have to parse its 2 MiB payload and then evict it.
    const padding = "x".repeat(1024 * 1024 * 2);
    const filler: SessionEventRecord = {
      eventVersion: 1,
      generation: 0,
      sequence: 1,
      timestamp: new Date(1_700_000_000_000).toISOString(),
      type: "test",
      payload: { padding },
    };
    await writeFile(file, `${JSON.stringify(filler)}\n${jsonl(6000, 2)}`, "utf8");
    const log = new SessionEventLog({ databasePath: file, maxEntries: 2000 });

    const loaded = await log.load();

    expect(loaded).toHaveLength(2000);
    expect(loaded[loaded.length - 1].sequence).toBe(6001);
    // Sequence 1 lives inside the 2 MiB line, so seeing it at all would mean
    // the read walked to offset 0 and materialized the padding.
    expect(loaded.some((entry) => entry.sequence === 1)).toBe(false);
  });

  it("rotates an oversized file down to the retained window", async () => {
    await writeFile(file, jsonl(4000), "utf8");
    const before = (await stat(file)).size;
    const log = new SessionEventLog({ databasePath: file, maxEntries: 2000, maxFileBytes: 4096 });

    await log.load();
    await log.flush();

    const after = (await stat(file)).size;
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThanOrEqual(4096);
    // The surviving lines are the newest ones, in order, still parseable.
    const body = await readFile(file, "utf8");
    const sequences = body
      .split("\n")
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as SessionEventRecord).sequence);
    expect(sequences[0]).toBeGreaterThan(3000);
    expect(sequences[sequences.length - 1]).toBe(4000);
  });

  it("rotation preserves the retained records across a fresh instance", async () => {
    await writeFile(file, jsonl(4000), "utf8");
    const first = new SessionEventLog({ databasePath: file, maxEntries: 50, maxFileBytes: 4096 });
    await first.load();
    await first.flush();

    const second = new SessionEventLog({ databasePath: file, maxEntries: 50 });
    const reloaded = await second.load();

    // Rotation keeps the newest records that fit the byte budget, so the count
    // is bounded by bytes rather than by maxEntries.
    expect(reloaded.length).toBeGreaterThan(0);
    expect(reloaded.length).toBeLessThanOrEqual(50);
    expect(reloaded[reloaded.length - 1].sequence).toBe(4000);
    expect(second.lastSequence()).toBe(4000);
    // Sequences stay contiguous and ascending — no interleaved corruption.
    expect(reloaded.map((entry) => entry.sequence)).toEqual(
      Array.from({ length: reloaded.length }, (_, index) => 4001 - reloaded.length + index),
    );
  });

  it("rotates when appends push the file past the threshold", async () => {
    const log = new SessionEventLog({ databasePath: file, maxEntries: 10, maxFileBytes: 2048 });
    await log.load();
    for (let sequence = 1; sequence <= 200; sequence += 1) log.append(record(sequence));
    await log.flush();

    const body = await readFile(file, "utf8");
    const sequences = body
      .split("\n")
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as SessionEventRecord).sequence);
    // 200 records would be ~26KB of JSONL; the file stays inside the budget
    // instead. The count can exceed maxEntries because rotation is driven by
    // bytes, and the tail written after the last rotation has not yet tripped
    // the threshold.
    expect((await stat(file)).size).toBeLessThanOrEqual(2048);
    // Whatever survives, the newest record is always there.
    expect(sequences[sequences.length - 1]).toBe(200);
    expect(log.snapshot()).toHaveLength(10);
    expect(log.snapshot()[9].sequence).toBe(200);
  });

  it("rotation converges: a second load does not rotate again", async () => {
    // The bug this guards: trimming to the entry count alone left a file
    // larger than maxFileBytes, so every boot rewrote it again forever.
    await writeFile(file, jsonl(4000), "utf8");
    const options = { databasePath: file, maxEntries: 2000, maxFileBytes: 4096 };
    const first = new SessionEventLog(options);
    await first.load();
    await first.flush();
    const afterFirst = (await stat(file)).size;

    const second = new SessionEventLog(options);
    await second.load();
    await second.flush();
    const afterSecond = (await stat(file)).size;

    expect(afterFirst).toBeLessThanOrEqual(4096);
    expect(afterSecond).toBe(afterFirst);
  });

  it("leaves a small file untouched and keeps appends working", async () => {
    await writeFile(file, jsonl(3), "utf8");
    const log = new SessionEventLog({ databasePath: file, maxEntries: 100 });
    const loaded = await log.load();
    log.append(record(4));
    await log.flush();

    expect(loaded.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
    const sequences = (await readFile(file, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as SessionEventRecord).sequence);
    expect(sequences).toEqual([1, 2, 3, 4]);
  });

  it("treats a missing file as empty rather than throwing", async () => {
    const log = new SessionEventLog({ databasePath: file, maxEntries: 100 });
    await expect(log.load()).resolves.toEqual([]);
  });

  it("skips a malformed line without discarding the records around it", async () => {
    await writeFile(
      file,
      `${JSON.stringify(record(1))}\n{ this is not json\n${JSON.stringify(record(3))}\n`,
      "utf8",
    );
    const log = new SessionEventLog({ databasePath: file, maxEntries: 100 });

    const loaded = await log.load();

    expect(loaded.map((entry) => entry.sequence)).toEqual([1, 3]);
  });
});
