import { appendFile, mkdir, open, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PiSessionEventBridge, type SessionEventLogQuery, type SessionEventRecord } from "../agent/pi-event-bridge";

export type { SessionEventLogQuery, SessionEventRecord };

interface SessionEventLogConstructorOptions {
  databasePath?: string;
  legacyPath?: string;
  maxEntries?: number;
  /** Size at which the JSONL file is rewritten down to the retained window. */
  maxFileBytes?: number;
}

/** Rotation threshold. The real file reached 172MB / 754K lines because
 *  nothing ever trimmed it, so every boot read the whole thing back. */
const DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024;
/** How much of the tail the first backward read grabs before doubling. */
const INITIAL_TAIL_BYTES = 1024 * 1024;

function resolveFilePath(filePathOrOptions: string | SessionEventLogConstructorOptions | undefined): string | undefined {
  if (typeof filePathOrOptions === "string") return filePathOrOptions;
  if (filePathOrOptions?.legacyPath) return filePathOrOptions.legacyPath;
  if (filePathOrOptions?.databasePath) return filePathOrOptions.databasePath;
  return undefined;
}

function resolveMaxEntries(filePathOrOptions: string | SessionEventLogConstructorOptions | undefined, maxEntriesArg?: number): number {
  if (typeof filePathOrOptions === "object" && filePathOrOptions !== null && typeof filePathOrOptions.maxEntries === "number") {
    return filePathOrOptions.maxEntries;
  }
  if (typeof maxEntriesArg === "number") return maxEntriesArg;
  return 2000;
}

function resolveMaxFileBytes(filePathOrOptions: string | SessionEventLogConstructorOptions | undefined): number {
  if (typeof filePathOrOptions === "object" && filePathOrOptions !== null && typeof filePathOrOptions.maxFileBytes === "number") {
    return Math.max(0, filePathOrOptions.maxFileBytes);
  }
  return DEFAULT_MAX_FILE_BYTES;
}

function parseLines(lines: readonly string[]): SessionEventRecord[] {
  const records: SessionEventRecord[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as SessionEventRecord;
      if (typeof parsed?.sequence === "number") records.push(parsed);
    } catch {
      // Skip malformed lines so a partially written file does not poison
      // the entire log.
    }
  }
  return records;
}

/** Injectable handle surface, so tests can count the bytes a read touches. */
export interface TailReadHandle {
  stat(): Promise<{ size: number }>;
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * Recover the newest `maxEntries` records from a JSONL file by reading backwards
 * from EOF, doubling the window until enough records are found or the start of
 * the file is reached. Returns the records plus the file's total size.
 *
 * Reading the whole file instead costs startup time proportional to a log that
 * grows for months (the real one reached 172MB / 754K lines) to fill a buffer
 * that holds 2000 entries.
 */
export async function readTailRecords(
  filePath: string,
  maxEntries: number,
  openHandle: (path: string) => Promise<TailReadHandle> = (path) => open(path, "r") as Promise<never>,
): Promise<{ records: SessionEventRecord[]; size: number }> {
  const handle = await openHandle(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!handle) return { records: [], size: 0 };
  try {
    const { size } = await handle.stat();
    let window = Math.min(size, INITIAL_TAIL_BYTES);
    for (;;) {
      const position = size - window;
      const buffer = Buffer.alloc(window);
      if (window > 0) await handle.read(buffer, 0, window, position);
      const lines = buffer.toString("utf8").split(/\r?\n/);
      // Only the first line can be a fragment, and only when we did not
      // start at offset 0.
      if (position > 0) lines.shift();
      const records = parseLines(lines);
      if (records.length >= maxEntries || position === 0) {
        return { records: records.slice(-maxEntries), size };
      }
      window = Math.min(size, window * 2);
    }
  } finally {
    await handle.close();
  }
}

/**
 * Session event log with an optional JSONL file backing store.
 *
 * - When constructed with a file path (legacy `(file, max)` signature) or with
 *   `{ legacyPath }`, `append()` writes one JSON object per line and `load()`
 *   hydrates the in-memory ring buffer from disk. This keeps the harness
 *   server replay contract (records persist across `new SessionEventLog(...)`)
 *   working as designed by the test suite.
 * - When constructed without a path, falls back to the parent's in-memory ring
 *   buffer so the rest of the agent host (which only consumes the bridge API)
 *   keeps working unchanged.
 *
 * `load()` reads backwards from EOF rather than reading the file whole, and the
 * file is rotated once it passes `maxFileBytes`. Rotation discards only records
 * the ring buffer had already evicted — `snapshot()` cannot reach them, so the
 * rewrite is lossless from every caller's point of view.
 */
export class SessionEventLog extends PiSessionEventBridge {
  private readonly filePath: string | undefined;
  private readonly maxFileBytes: number;
  private readonly retainedCount: number;
  private writeQueue: Promise<void> = Promise.resolve();
  private bytesOnDisk = 0;

  constructor(filePathOrOptions?: string | SessionEventLogConstructorOptions, maxEntries?: number) {
    const retained = resolveMaxEntries(filePathOrOptions, maxEntries);
    super({ maxEntries: retained });
    this.retainedCount = retained;
    this.filePath = resolveFilePath(filePathOrOptions);
    this.maxFileBytes = resolveMaxFileBytes(filePathOrOptions);
  }

  /**
   * Append a record. When a backing file is configured, the record is queued
   * for atomic JSONL persistence so a subsequent `new SessionEventLog(path)` can
   * hydrate from the same file.
   */
  append(record: SessionEventRecord): void {
    super.append(record);
    if (!this.filePath) return;
    this.writeQueue = this.enqueueWrite(record);
  }

  /** Drain pending writes to the JSONL backing file. No-op without a path. */
  async flush(): Promise<void> {
    if (!this.filePath) return;
    await this.writeQueue;
  }

  /** Current on-disk size in bytes; 0 when there is no backing file. */
  fileSize(): number {
    return this.bytesOnDisk;
  }

  /**
   * Hydrate the in-memory buffer from the JSONL backing file. Returns the
   * records that were loaded so callers can pipe them straight into the
   * harness agent without an extra `snapshot()` round-trip.
   *
   * Only the tail is read: the file grows without bound otherwise, and reading
   * a 172MB log line-by-line on every boot costs seconds of main-process
   * startup to produce a buffer that keeps just the newest `maxEntries`.
   */
  async load(): Promise<SessionEventRecord[]> {
    if (!this.filePath) return super.load();
    const { records, size } = await this.readTail();
    this.bytesOnDisk = size;
    for (const record of records) super.append(record);
    if (size > this.maxFileBytes) {
      this.writeQueue = this.writeQueue.then(() => this.rotate());
    }
    return records;
  }

  /**
   * Read backwards from EOF, widening the window until `maxEntries` records
   * have been recovered or the start of the file is reached. A chunk boundary
   * that lands mid-line discards that one leading fragment.
   */
  private async readTail(): Promise<{ records: SessionEventRecord[]; size: number }> {
    return readTailRecords(this.filePath!, this.retainedCount);
  }

  private enqueueWrite(record: SessionEventRecord): Promise<void> {
    return this.writeQueue.then(async () => {
      const payload = JSON.stringify(record);
      await mkdir(dirname(this.filePath!), { recursive: true }).catch(() => undefined);
      await appendFile(this.filePath!, `${payload}\n`, "utf8");
      this.bytesOnDisk += Buffer.byteLength(payload) + 1;
      if (this.bytesOnDisk > this.maxFileBytes) await this.rotate();
    });
  }

  /**
   * Rewrite the backing file down to the records the ring buffer still holds,
   * newest first, dropping the oldest until the body fits the byte budget.
   *
   * Trimming to the entry count alone does not converge: 2000 retained records
   * can still exceed `maxFileBytes`, in which case the rewrite would leave the
   * file over budget and re-rotate on every subsequent boot forever.
   *
   * The temp-file + rename keeps a concurrent reader from observing a
   * half-written log, and the discarded prefix is by construction already
   * unreachable through `snapshot()`.
   */
  private async rotate(): Promise<void> {
    if (!this.filePath) return;
    const encoded = super.snapshot().map((entry) => `${JSON.stringify(entry)}\n`);
    let body = "";
    for (let index = encoded.length - 1; index >= 0; index -= 1) {
      const candidate = encoded[index] + body;
      // Always keep at least the newest record, otherwise a threshold smaller
      // than one line would truncate the log to nothing on every rotation.
      if (body && Buffer.byteLength(candidate) > this.maxFileBytes) break;
      body = candidate;
    }
    const temp = `${this.filePath}.rotate`;
    await mkdir(dirname(this.filePath), { recursive: true }).catch(() => undefined);
    await writeFile(temp, body, "utf8");
    await rename(temp, this.filePath);
    this.bytesOnDisk = Buffer.byteLength(body);
  }
}
