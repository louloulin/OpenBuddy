import { readFile } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import type { SqliteDriver } from "./driver";
import { closeStorage, openStorage, type OpenStorageResult } from "./open-storage";
import { isMissingSource, legacySourceError } from "../adapters/legacy-errors";

export interface TeamCatalogMember {
  id: string;
  role: string;
  model?: string;
  status: string;
  output?: string;
  startedAt?: number;
  endedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface TeamCatalogRecord {
  id: string;
  goal: string;
  size: string;
  status: string;
  createdAt: number;
  members: TeamCatalogMember[];
}

interface TeamRow { team_id: string; goal: string; size: string; status: string; created_at: string }
interface MemberRow { member_id: string; role: string; model: string | null; status: string; output: string | null; started_at: string | null; ended_at: string | null; metadata_json: string }

export class TeamCatalog {
  private storage?: Promise<OpenStorageResult>;
  private importedLegacy = false;

  constructor(private readonly options: { databasePath: string; legacyPath?: string; appVersion?: string }) { }

  async list(): Promise<TeamCatalogRecord[]> {
    const driver = await this.driver();
    await this.importLegacyIfEmpty(driver);
    const rows = driver.database.prepare(`SELECT team_id, goal, size, status, created_at FROM teams ORDER BY created_at DESC, team_id ASC`).all() as unknown as TeamRow[];
    return rows.map((row) => this.readRecord(driver, row));
  }

  async get(teamId: string): Promise<TeamCatalogRecord | undefined> {
    const driver = await this.driver();
    await this.importLegacyIfEmpty(driver);
    const row = driver.database.prepare(`SELECT team_id, goal, size, status, created_at FROM teams WHERE team_id = ?`).get(teamId) as TeamRow | undefined;
    return row ? this.readRecord(driver, row) : undefined;
  }

  async upsert(record: TeamCatalogRecord): Promise<void> {
    const driver = await this.driver();
    await driver.transaction(async () => {
      driver.database.prepare(`INSERT INTO teams(team_id, goal, size, status, created_at, metadata_json) VALUES (?, ?, ?, ?, ?, '{}') ON CONFLICT(team_id) DO UPDATE SET goal = excluded.goal, size = excluded.size, status = excluded.status, created_at = excluded.created_at`).run(record.id, record.goal, record.size, record.status, new Date(record.createdAt).toISOString());
      driver.database.prepare(`DELETE FROM team_members WHERE team_id = ?`).run(record.id);
      for (const member of record.members) {
        driver.database.prepare(`INSERT INTO team_members(team_id, member_id, role, model, status, output, started_at, ended_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(record.id, member.id, member.role, member.model ?? null, member.status, member.output ?? null, member.startedAt === undefined ? null : new Date(member.startedAt).toISOString(), member.endedAt === undefined ? null : new Date(member.endedAt).toISOString(), JSON.stringify(member.metadata ?? {}));
      }
    });
  }

  async close(): Promise<void> {
    const storage = this.storage;
    this.storage = undefined;
    if (!storage) return;
    await closeStorage(storage);
  }

  private async driver(): Promise<SqliteDriver> {
    return (await (this.storage ??= openStorage({ filePath: this.options.databasePath, appVersion: this.options.appVersion ?? "openbuddy-team" }))).driver;
  }

  private readRecord(driver: SqliteDriver, row: TeamRow): TeamCatalogRecord {
    const members = driver.database.prepare(`SELECT member_id, role, model, status, output, started_at, ended_at, metadata_json FROM team_members WHERE team_id = ? ORDER BY member_id`).all(row.team_id) as unknown as MemberRow[];
    return {
      id: row.team_id, goal: row.goal, size: row.size, status: row.status, createdAt: Date.parse(row.created_at),
      members: members.map((member) => {
        let metadata: Record<string, unknown> | undefined;
        try { const value = JSON.parse(member.metadata_json) as unknown; if (value && typeof value === "object" && !Array.isArray(value)) metadata = value as Record<string, unknown>; } catch { }
        return { id: member.member_id, role: member.role, ...(member.model ? { model: member.model } : {}), status: member.status, ...(member.output === null ? {} : { output: member.output }), ...(member.started_at === null ? {} : { startedAt: Date.parse(member.started_at) }), ...(member.ended_at === null ? {} : { endedAt: Date.parse(member.ended_at) }), ...(metadata ? { metadata } : {}) };
      }),
    };
  }

  private async importLegacyIfEmpty(driver: SqliteDriver): Promise<void> {
    if (this.importedLegacy || !this.options.legacyPath) return;
    const count = driver.database.prepare(`SELECT COUNT(*) AS count FROM teams`).get() as { count: number };
    if (count.count > 0) { this.importedLegacy = true; return; }
    let legacy: Record<string, TeamCatalogRecord>;
    try {
      const parsed = JSON.parse(await readFile(this.options.legacyPath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("team legacy document must be an object");
      legacy = parsed as Record<string, TeamCatalogRecord>;
    } catch (error) {
      if (isMissingSource(error)) { this.importedLegacy = true; return; }
      throw legacySourceError("team", this.options.legacyPath, error);
    }
    await driver.runExclusive((database) => {
      for (const record of Object.values(legacy)) {
        if (record && typeof record.id === "string" && Array.isArray(record.members)) this.write(database, record);
      }
    });
    this.importedLegacy = true;
  }

  private write(database: DatabaseSync, record: TeamCatalogRecord): void {
    database.prepare(`INSERT INTO teams(team_id, goal, size, status, created_at, metadata_json) VALUES (?, ?, ?, ?, ?, '{}') ON CONFLICT(team_id) DO UPDATE SET goal = excluded.goal, size = excluded.size, status = excluded.status, created_at = excluded.created_at`).run(record.id, record.goal, record.size, record.status, new Date(record.createdAt).toISOString());
    database.prepare(`DELETE FROM team_members WHERE team_id = ?`).run(record.id);
    for (const member of record.members) {
      database.prepare(`INSERT INTO team_members(team_id, member_id, role, model, status, output, started_at, ended_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(record.id, member.id, member.role, member.model ?? null, member.status, member.output ?? null, member.startedAt === undefined ? null : new Date(member.startedAt).toISOString(), member.endedAt === undefined ? null : new Date(member.endedAt).toISOString(), JSON.stringify(member.metadata ?? {}));
    }
  }
}
