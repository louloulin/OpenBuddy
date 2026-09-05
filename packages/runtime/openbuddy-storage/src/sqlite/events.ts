import type { SqliteDriver } from "./driver";
import type { StorageEventEnvelope } from "../driver/contract";

export interface StoredEventRow {
  id: string;
  stream: string;
  stream_seq: number;
  type: string;
  occurred_at: string;
  actor: string;
  payload_json: string;
  payload_hash: string;
  idempotency_key: string | null;
}

export interface EventConsumerCursor {
  consumer: string;
  stream: string;
  lastSeq: number;
  updatedAt: string;
}

export interface EventReplayOptions {
  stream?: string;
  sinceSeq?: number;
  batchSize?: number;
}

export interface EventReplaySummary {
  events: number;
  streams: number;
  lastSeqByStream: Record<string, number>;
}

export type EventProjector = (event: StoredEventRow) => void | Promise<void>;

export class EventStore {
  constructor(private readonly driver: SqliteDriver) {}

  lastSequence(stream: string): number {
    const row = this.driver.database
      .prepare(`SELECT COALESCE(MAX(stream_seq), 0) AS sequence FROM events WHERE stream = ?`)
      .get(stream) as { sequence?: number } | undefined;
    return Number(row?.sequence ?? 0);
  }

  append(event: StorageEventEnvelope): boolean {
    return this.driver.runExclusiveSync((database) => {
      const result = database.prepare(
        `INSERT INTO events(id, stream, stream_seq, type, occurred_at, actor, payload_json, payload_hash, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      ).run(
        event.id, event.stream, event.streamSequence, event.type, event.occurredAt, event.actor,
        JSON.stringify(event.payload), event.payloadHash, event.idempotencyKey ?? null,
      );
      if (Number(result.changes) === 0) {
        const existing = database.prepare(`SELECT stream, stream_seq, type, occurred_at, actor, payload_hash, idempotency_key FROM events WHERE id = ?`).get(event.id) as {
          stream: string; stream_seq: number; type: string; occurred_at: string; actor: string; payload_hash: string; idempotency_key: string | null;
        } | undefined;
        const same = existing
          && existing.stream === event.stream
          && existing.stream_seq === event.streamSequence
          && existing.type === event.type
          && existing.occurred_at === event.occurredAt
          && existing.actor === event.actor
          && existing.payload_hash === event.payloadHash
          && existing.idempotency_key === (event.idempotencyKey ?? null);
        if (!same) throw new Error(`event id collision: ${event.id}`);
      }
      return Number(result.changes) > 0;
    });
  }

  replay(stream: string, sinceSeq = 0, limit = 1000): StoredEventRow[] {
    const stmt = this.driver.database.prepare(
      `SELECT id, stream, stream_seq, type, occurred_at, actor, payload_json, payload_hash, idempotency_key
       FROM events
       WHERE stream = ? AND stream_seq > ?
       ORDER BY stream_seq ASC
       LIMIT ?`,
    );
    return stmt.all(stream, sinceSeq, limit) as unknown as StoredEventRow[];
  }

  async replayInto(consumer: string, projector: EventProjector, options: EventReplayOptions = {}): Promise<EventReplaySummary> {
    const summary: EventReplaySummary = { events: 0, streams: 0, lastSeqByStream: {} };
    const streams = options.stream ? [options.stream] : this.streams();
    const batchSize = normalizeBatchSize(options.batchSize);
    for (const stream of streams) {
      const cursor = options.sinceSeq ?? this.cursor(consumer, stream)?.lastSeq ?? 0;
      let sinceSeq = cursor;
      let streamEvents = 0;
      while (true) {
        const rows = this.replay(stream, sinceSeq, batchSize);
        if (rows.length === 0) break;
        for (const row of rows) {
          await projector(row);
          await this.setCursorAsync(consumer, stream, row.stream_seq);
          sinceSeq = row.stream_seq;
          streamEvents += 1;
          summary.events += 1;
        }
        if (rows.length < batchSize) break;
      }
      if (streamEvents > 0) summary.lastSeqByStream[stream] = sinceSeq;
      if (streamEvents > 0) summary.streams += 1;
    }
    return summary;
  }

  setCursor(consumer: string, stream: string, lastSeq: number): void {
    this.driver.runExclusiveSync((database) => {
      database.prepare(
        `INSERT INTO event_consumers(consumer, stream, last_seq, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(consumer, stream) DO UPDATE SET last_seq = MAX(event_consumers.last_seq, excluded.last_seq), updated_at = excluded.updated_at`,
      ).run(consumer, stream, lastSeq, new Date().toISOString());
    });
  }

  private async setCursorAsync(consumer: string, stream: string, lastSeq: number): Promise<void> {
    await this.driver.runExclusive((database) => {
      database.prepare(
        `INSERT INTO event_consumers(consumer, stream, last_seq, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(consumer, stream) DO UPDATE SET last_seq = MAX(event_consumers.last_seq, excluded.last_seq), updated_at = excluded.updated_at`,
      ).run(consumer, stream, lastSeq, new Date().toISOString());
    });
  }

  cursor(consumer: string, stream: string): EventConsumerCursor | undefined {
    const row = this.driver.database.prepare(
      `SELECT consumer, stream, last_seq, updated_at FROM event_consumers WHERE consumer = ? AND stream = ?`,
    ).get(consumer, stream) as { consumer: string; stream: string; last_seq: number; updated_at: string } | undefined;
    if (!row) return undefined;
    return { consumer: row.consumer, stream: row.stream, lastSeq: row.last_seq, updatedAt: row.updated_at };
  }

  async rebuild(projector?: EventProjector, options: Omit<EventReplayOptions, "sinceSeq"> = {}): Promise<EventReplaySummary> {
    const summary: EventReplaySummary = { events: 0, streams: 0, lastSeqByStream: {} };
    const streams = options.stream ? [options.stream] : this.streams();
    const batchSize = normalizeBatchSize(options.batchSize);
    for (const stream of streams) {
      let sinceSeq = 0;
      let streamEvents = 0;
      while (true) {
        const rows = this.replay(stream, sinceSeq, batchSize);
        if (rows.length === 0) break;
        for (const row of rows) {
          if (projector) await projector(row);
          sinceSeq = row.stream_seq;
          streamEvents += 1;
          summary.events += 1;
        }
        if (rows.length < batchSize) break;
      }
      if (streamEvents > 0) {
        summary.streams += 1;
        summary.lastSeqByStream[stream] = sinceSeq;
      }
    }
    return summary;
  }

  private streams(): string[] {
    const rows = this.driver.database.prepare(`SELECT DISTINCT stream FROM events ORDER BY stream ASC`).all() as unknown as Array<{ stream: string }>;
    return rows.map((row) => row.stream);
  }
}

function normalizeBatchSize(value: number | undefined): number {
  if (value === undefined) return 1000;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("batchSize must be a positive safe integer");
  return value;
}
