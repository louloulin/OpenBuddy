import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { redactStorageValue } from "../driver/redact";
import type { SqliteDriver } from "../sqlite/driver";
import { MemoryIndex } from "../sqlite/memory";

export interface LegacyImportReport {
  sourcePath: string;
  sourceStatus: "read" | "missing" | "error";
  sourceHash?: string;
  imported: number;
  skipped: number;
  parseErrors: number;
  issues: readonly string[];
}

export interface LegacyTeamMember {
  id: string;
  role: string;
  model?: string;
  status: string;
  output?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface LegacyTeamRecord {
  id: string;
  goal: string;
  size: string;
  status: string;
  createdAt: number;
  members: LegacyTeamMember[];
}

interface LegacyEvent {
  id?: unknown;
  sequence?: unknown;
  type?: unknown;
  timestamp?: unknown;
  occurredAt?: unknown;
  actor?: unknown;
  payload?: unknown;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sourceHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function readSource(path: string): Promise<{ raw?: string; report: LegacyImportReport }> {
  try {
    const raw = await readFile(path, "utf8");
    return { raw, report: { sourcePath: path, sourceStatus: "read", sourceHash: sourceHash(raw), imported: 0, skipped: 0, parseErrors: 0, issues: [] } };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : undefined;
    return {
      report: {
        sourcePath: path,
        sourceStatus: code === "ENOENT" ? "missing" : "error",
        imported: 0,
        skipped: 0,
        parseErrors: 0,
        issues: [`read: ${String(error)}`],
      },
    };
  }
}

export class LegacyFilesAdapter {
  constructor(private readonly driver: SqliteDriver, private readonly now: () => string = () => new Date().toISOString()) {}

  async importSettings(path: string, namespace: string): Promise<LegacyImportReport> {
    const source = await readSource(path);
    if (source.raw === undefined) return source.report;
    try {
      const value = object(JSON.parse(source.raw));
      if (!value) return { ...source.report, parseErrors: 1, issues: ["settings root is not an object"] };
      this.driver.runExclusiveSync((database) => {
        for (const [key, entry] of Object.entries(value)) {
          database.prepare(`
            INSERT INTO settings(namespace, setting_key, value_json, version, updated_at)
            VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(namespace, setting_key) DO UPDATE SET value_json = excluded.value_json, version = excluded.version, updated_at = excluded.updated_at
          `).run(namespace, key, JSON.stringify(redactStorageValue(entry, key)), this.now());
        }
      });
      return { ...source.report, imported: Object.keys(value).length };
    } catch (error) {
      return { ...source.report, parseErrors: 1, issues: [`parse: ${String(error)}`] };
    }
  }

  async importEventLog(path: string, stream: string, actor = "legacy-import"): Promise<LegacyImportReport> {
    const source = await readSource(path);
    if (source.raw === undefined) return source.report;
    const report = { ...source.report, issues: [...source.report.issues] };
    let sequence = 0;
    const events: Array<{ line: string; value: LegacyEvent; sequence: number }> = [];
    for (const line of source.raw.split(/\r?\n/).filter(Boolean)) {
      let value: LegacyEvent | undefined;
      try { value = object(JSON.parse(line)) as LegacyEvent | undefined; } catch { report.parseErrors += 1; continue; }
      if (!value) { report.parseErrors += 1; continue; }
      const eventSequence = typeof value.sequence === "number" && Number.isInteger(value.sequence) && value.sequence > 0 ? value.sequence : sequence + 1;
      sequence = Math.max(sequence, eventSequence);
      const id = text(value.id) ?? createHash("sha256").update(`${source.report.sourceHash}:${eventSequence}:${line}`).digest("hex");
      const type = text(value.type) ?? "legacy/event";
      const occurredAt = text(value.occurredAt) ?? text(value.timestamp) ?? this.now();
      events.push({ line, value: { ...value, id, type, occurredAt, actor: text(value.actor) ?? actor }, sequence: eventSequence });
    }
    try {
      this.driver.runExclusiveSync((database) => {
        for (const event of events) {
          const inserted = database.prepare(`
            INSERT INTO events(id, stream, stream_seq, type, occurred_at, actor, payload_json, payload_hash, idempotency_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(id) DO NOTHING
          `).run(String(event.value.id), stream, event.sequence, String(event.value.type), String(event.value.occurredAt), String(event.value.actor), JSON.stringify(redactStorageValue(event.value.payload ?? event.value)), createHash("sha256").update(event.line).digest("hex"));
          if (Number(inserted.changes) > 0) report.imported += 1;
          else report.skipped += 1;
        }
      });
    } catch (error) {
      report.skipped += events.length;
      report.issues.push(`event import: ${String(error)}`);
    }
    return report;
  }

  async importMarkdown(path: string, documentId = basename(path)): Promise<LegacyImportReport> {
    const source = await readSource(path);
    if (source.raw === undefined) return source.report;
    const title = source.raw.split(/\r?\n/).find((line) => /^#\s+/u.test(line))?.replace(/^#\s+/u, "");
    new MemoryIndex(this.driver, this.now).upsert({
      documentId,
      sourcePath: path,
      contentHash: source.report.sourceHash ?? sourceHash(source.raw),
      title,
      content: source.raw,
      metadata: { source: "legacy-markdown" },
    });
    return { ...source.report, imported: 1 };
  }

  async importTeams(path: string): Promise<LegacyImportReport> {
    const source = await readSource(path);
    if (source.raw === undefined) return source.report;
    const report = { ...source.report, issues: [...source.report.issues] };
    try {
      const teams = object(JSON.parse(source.raw));
      if (!teams) return { ...report, parseErrors: 1, issues: [...report.issues, "teams root is not an object"] };
      this.driver.runExclusiveSync((database) => {
        for (const [key, rawTeam] of Object.entries(teams)) {
        const team = object(rawTeam) as Partial<LegacyTeamRecord> | undefined;
        if (!team || typeof team.goal !== "string" || !Array.isArray(team.members)) {
          report.skipped += 1;
          report.issues.push(`team ${key}: invalid shape`);
          continue;
        }
        const teamId = typeof team.id === "string" ? team.id : key;
        database.prepare(`
          INSERT INTO teams(team_id, goal, size, status, created_at, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(team_id) DO UPDATE SET goal = excluded.goal, size = excluded.size,
            status = excluded.status, created_at = excluded.created_at, metadata_json = excluded.metadata_json
        `).run(teamId, team.goal, typeof team.size === "string" ? team.size : "small", typeof team.status === "string" ? team.status : "active", new Date(typeof team.createdAt === "number" ? team.createdAt : Date.now()).toISOString(), JSON.stringify({ source: path }));
        for (const rawMember of team.members) {
          const member = object(rawMember) as Partial<LegacyTeamMember> | undefined;
          if (!member || typeof member.id !== "string" || typeof member.role !== "string") continue;
          database.prepare(`
            INSERT INTO team_members(team_id, member_id, role, model, status, output, started_at, ended_at, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(team_id, member_id) DO UPDATE SET role = excluded.role, model = excluded.model,
              status = excluded.status, output = excluded.output, started_at = excluded.started_at,
              ended_at = excluded.ended_at, metadata_json = excluded.metadata_json
          `).run(teamId, member.id, member.role, member.model ?? null, member.status ?? "idle", member.output ?? null,
            typeof member.startedAt === "number" ? new Date(member.startedAt).toISOString() : null,
            typeof member.endedAt === "number" ? new Date(member.endedAt).toISOString() : null,
            JSON.stringify({ source: path }));
        }
        report.imported += 1;
        }
      });
    } catch (error) {
      report.parseErrors += 1;
      report.issues.push(`parse: ${String(error)}`);
    }
    return report;
  }
}
