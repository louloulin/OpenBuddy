import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PiSessionEventBridge, type SessionEventLogQuery, type SessionEventRecord } from "../agent/pi-event-bridge";

export type { SessionEventLogQuery, SessionEventRecord };

interface SessionEventLogConstructorOptions {
  databasePath?: string;
  legacyPath?: string;
  maxEntries?: number;
}

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
 */
export class SessionEventLog extends PiSessionEventBridge {
  private readonly filePath: string | undefined;
  private writeQueue: Promise<void> = Promise.resolve();
  private loaded = false;

  constructor(filePathOrOptions?: string | SessionEventLogConstructorOptions, maxEntries?: number) {
    super({ maxEntries: resolveMaxEntries(filePathOrOptions, maxEntries) });
    this.filePath = resolveFilePath(filePathOrOptions);
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

  /**
   * Hydrate the in-memory buffer from the JSONL backing file. Returns the
   * records that were loaded so callers can pipe them straight into the
   * harness agent without an extra `snapshot()` round-trip.
   */
  async load(): Promise<SessionEventRecord[]> {
    if (!this.filePath) return super.load();
    const text = await readFile(this.filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error?.code === "ENOENT") return "";
      throw error;
    });
    const records: SessionEventRecord[] = [];
    for (const line of text.split(/\r?\n/)) {
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
    this.loaded = true;
    for (const record of records) super.append(record);
    return records;
  }

  private enqueueWrite(record: SessionEventRecord): Promise<void> {
    return this.writeQueue.then(async () => {
      const payload = JSON.stringify(record);
      await mkdir(dirname(this.filePath!), { recursive: true }).catch(() => undefined);
      await appendFile(this.filePath!, `${payload}\n`, "utf8");
    });
  }
}
