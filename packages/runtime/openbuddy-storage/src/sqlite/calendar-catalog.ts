import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { closeStorage, openStorage, type OpenStorageResult } from "./open-storage";
import type { SqliteDriver } from "./driver";

export type CalendarEventStatus = "confirmed" | "tentative" | "cancelled";

export interface CalendarCatalogEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  timeZone?: string;
  allDay: boolean;
  status: CalendarEventStatus;
  roomId: string;
  contextRefs: string[];
  description?: string;
  location?: string;
  attendees: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CalendarCatalogOptions {
  databasePath: string;
  legacyPath?: string;
  mirrorPath?: string;
  now?: () => string;
}

export interface CalendarCatalogQuery {
  from?: string;
  to?: string;
  roomId?: string;
  contextRef?: string;
}

interface CalendarDocument { events: CalendarCatalogEvent[] }

function emptyDocument(): CalendarDocument { return { events: [] }; }

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0))] : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeEvent(value: unknown): CalendarCatalogEvent | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Partial<CalendarCatalogEvent>;
  if (typeof source.id !== "string" || typeof source.title !== "string" || typeof source.start !== "string" || typeof source.end !== "string" || typeof source.roomId !== "string") return undefined;
  const status = source.status === "tentative" || source.status === "cancelled" ? source.status : "confirmed";
  return {
    id: source.id,
    title: source.title,
    start: source.start,
    end: source.end,
    ...(optionalString(source.timeZone) ? { timeZone: source.timeZone } : {}),
    allDay: source.allDay === true,
    status,
    roomId: source.roomId,
    contextRefs: stringArray(source.contextRefs),
    ...(optionalString(source.description) ? { description: source.description } : {}),
    ...(optionalString(source.location) ? { location: source.location } : {}),
    attendees: stringArray(source.attendees),
    createdAt: typeof source.createdAt === "string" ? source.createdAt : new Date(0).toISOString(),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date(0).toISOString(),
  };
}

function normalizeDocument(value: unknown): CalendarDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("calendar legacy document must be an object");
  const source = value as Partial<CalendarDocument>;
  if (source.events !== undefined && !Array.isArray(source.events)) throw new Error("calendar legacy events must be an array");
  const events = (source.events ?? []).map((event) => {
    const normalized = normalizeEvent(event);
    if (!normalized) throw new Error("calendar legacy event has an invalid shape");
    return normalized;
  });
  return { events };
}

function parseArray(value: string): string[] {
  try { return stringArray(JSON.parse(value)); } catch { return []; }
}

function readDatabase(database: DatabaseSync, query: CalendarCatalogQuery = {}): CalendarCatalogEvent[] {
  const clauses = ["1 = 1"];
  const values: string[] = [];
  if (query.from) { clauses.push("end_at > ?"); values.push(query.from); }
  if (query.to) { clauses.push("start_at < ?"); values.push(query.to); }
  if (query.roomId) { clauses.push("room_id = ?"); values.push(query.roomId); }
  const rows = database.prepare(`SELECT event_id AS id, title, start_at AS start, end_at AS end, time_zone AS timeZone, all_day AS allDay, status, room_id AS roomId, context_refs_json AS contextRefs, description, location, attendees_json AS attendees, created_at AS createdAt, updated_at AS updatedAt FROM calendar_events WHERE ${clauses.join(" AND ")} ORDER BY start_at, event_id`).all(...values) as unknown as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id), title: String(row.title), start: String(row.start), end: String(row.end),
    ...(typeof row.timeZone === "string" ? { timeZone: row.timeZone } : {}), allDay: row.allDay === 1,
    status: row.status as CalendarEventStatus, roomId: String(row.roomId), contextRefs: parseArray(String(row.contextRefs)),
    ...(typeof row.description === "string" ? { description: row.description } : {}),
    ...(typeof row.location === "string" ? { location: row.location } : {}), attendees: parseArray(String(row.attendees)),
    createdAt: String(row.createdAt), updatedAt: String(row.updatedAt),
  }));
}

export class CalendarCatalog {
  private storage: Promise<OpenStorageResult> | undefined;
  private readonly now: () => string;
  private importedLegacy = false;

  constructor(private readonly options: CalendarCatalogOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private storageResult(): Promise<OpenStorageResult> {
    return this.storage ??= openStorage({ filePath: this.options.databasePath, appVersion: "openbuddy-calendar" });
  }

  async list(query: CalendarCatalogQuery = {}): Promise<CalendarCatalogEvent[]> {
    const driver = (await this.storageResult()).driver;
    await this.importLegacyIfNeeded(driver);
    const events = readDatabase(driver.database, query);
    if (!query.contextRef) return events;
    return events.filter((event) => event.contextRefs.includes(query.contextRef!));
  }

  async get(id: string): Promise<CalendarCatalogEvent | null> {
    const events = await this.list();
    return events.find((event) => event.id === id) ?? null;
  }

  async upsert(event: CalendarCatalogEvent): Promise<void> {
    const driver = (await this.storageResult()).driver;
    await this.importLegacyIfNeeded(driver);
    await driver.runExclusive((database) => this.writeEvent(database, event));
    await this.writeMirrorIfConfigured(driver);
  }

  async remove(id: string, expectedRoomId?: string): Promise<boolean> {
    const driver = (await this.storageResult()).driver;
    await this.importLegacyIfNeeded(driver);
    const removed = await driver.runExclusive((database) => {
      const current = database.prepare(`SELECT room_id AS roomId FROM calendar_events WHERE event_id = ?`).get(id) as { roomId: string } | undefined;
      if (current && expectedRoomId !== undefined && current.roomId !== expectedRoomId) throw new Error("calendar event does not belong to the requested room");
      return Number(database.prepare(`DELETE FROM calendar_events WHERE event_id = ?`).run(id).changes ?? 0) > 0;
    });
    if (removed) await this.writeMirrorIfConfigured(driver);
    return removed;
  }

  async close(): Promise<void> {
    const storage = this.storage;
    this.storage = undefined;
    if (!storage) return;
    await closeStorage(storage);
  }

  private writeEvent(database: DatabaseSync, event: CalendarCatalogEvent): void {
    database.prepare(`
      INSERT INTO calendar_events(event_id, title, start_at, end_at, time_zone, all_day, status, room_id, context_refs_json, description, location, attendees_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET title = excluded.title, start_at = excluded.start_at, end_at = excluded.end_at, time_zone = excluded.time_zone, all_day = excluded.all_day, status = excluded.status, room_id = excluded.room_id, context_refs_json = excluded.context_refs_json, description = excluded.description, location = excluded.location, attendees_json = excluded.attendees_json, created_at = excluded.created_at, updated_at = excluded.updated_at
    `).run(event.id, event.title, event.start, event.end, event.timeZone ?? null, event.allDay ? 1 : 0, event.status, event.roomId, JSON.stringify(event.contextRefs), event.description ?? null, event.location ?? null, JSON.stringify(event.attendees), event.createdAt, event.updatedAt);
  }

  private async importLegacyIfNeeded(driver: SqliteDriver): Promise<void> {
    if (this.importedLegacy) return;
    const marker = driver.database.prepare(`SELECT legacy_imported AS legacyImported FROM calendar_state_meta WHERE state_id = 1`).get() as { legacyImported: number } | undefined;
    if (marker?.legacyImported) { this.importedLegacy = true; return; }
    let document = emptyDocument();
    if (this.options.legacyPath) {
      try {
        document = normalizeDocument(JSON.parse(await readFile(this.options.legacyPath, "utf8")));
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && String((error as { code?: unknown }).code) === "ENOENT") {
          document = emptyDocument();
        } else {
          throw new Error(`calendar legacy import failed: ${this.options.legacyPath}`, { cause: error });
        }
      }
    }
    await driver.runExclusive((database) => {
      const existing = database.prepare(`SELECT COUNT(*) AS count FROM calendar_events`).get() as { count: number };
      if (existing.count === 0) for (const event of document.events) this.writeEvent(database, event);
      database.prepare(`INSERT INTO calendar_state_meta(state_id, legacy_imported, updated_at) VALUES (1, 1, ?) ON CONFLICT(state_id) DO UPDATE SET legacy_imported = 1, updated_at = excluded.updated_at`).run(this.now());
    });
    this.importedLegacy = true;
    await this.writeMirrorIfConfigured(driver);
  }

  private async writeMirrorIfConfigured(driver: SqliteDriver): Promise<void> {
    if (!this.options.mirrorPath) return;
    await mkdir(dirname(this.options.mirrorPath), { recursive: true });
    const temporary = `${this.options.mirrorPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify({ events: readDatabase(driver.database) }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.options.mirrorPath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new Error(`calendar compatibility mirror failed: ${this.options.mirrorPath}`, { cause: error });
    }
  }
}
