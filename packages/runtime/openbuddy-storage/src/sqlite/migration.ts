import type { DatabaseSync } from "node:sqlite";
import type { SqliteDriver } from "./driver";

export interface MigrationStep {
  version: number;
  description: string;
  up: (driver: SqliteDriver) => Promise<void> | void;
}

export interface MigrationResult {
  applied: number;
  finalVersion: number;
  history: readonly { version: number; status: "applied" | "failed"; detail?: string }[];
}

export class MigrationRunner {
  private readonly sortedSteps: readonly MigrationStep[];
  private readonly appVersion: string;

  constructor(options: { steps: readonly MigrationStep[]; appVersion?: string }) {
    this.sortedSteps = [...options.steps].sort((a, b) => a.version - b.version);
    this.appVersion = options.appVersion ?? "openbuddy";
  }

  async run(driver: SqliteDriver, targetVersion = Number.POSITIVE_INFINITY): Promise<MigrationResult> {
    return driver.enqueue(async () => this.runUnlocked(driver, targetVersion));
  }

  private async runUnlocked(driver: SqliteDriver, targetVersion: number): Promise<MigrationResult> {
    ensureMetaTable(driver.database);
    const history: { version: number; status: "applied" | "failed"; detail?: string }[] = [];
    let current = readCurrentVersion(driver.database);
    let applied = 0;
    for (const step of this.sortedSteps) {
      if (step.version > targetVersion || step.version <= current) continue;
      try {
        driver.database.exec("BEGIN IMMEDIATE");
        await step.up(driver);
        recordMeta(driver.database, this.appVersion, step.version, "applied", current);
        driver.database.exec("COMMIT");
      } catch (error) {
        try { driver.database.exec("ROLLBACK"); } catch { }
        recordMeta(driver.database, this.appVersion, step.version, "failed", current, String(error));
        history.push({ version: step.version, status: "failed", detail: String(error) });
        throw error;
      }
      history.push({ version: step.version, status: "applied" });
      current = step.version;
      applied += 1;
    }
    return { applied, finalVersion: current, history };
  }

  runSync(driver: SqliteDriver, targetVersion = Number.POSITIVE_INFINITY): MigrationResult {
    return this.runInternal(driver, targetVersion);
  }

  private runInternal(driver: SqliteDriver, targetVersion: number): MigrationResult {
    ensureMetaTable(driver.database);
    const history: { version: number; status: "applied" | "failed"; detail?: string }[] = [];
    let current = readCurrentVersion(driver.database);
    let applied = 0;
    for (const step of this.sortedSteps) {
      if (step.version > targetVersion) break;
      if (step.version <= current) continue;
      try {
        driver.database.exec("BEGIN IMMEDIATE");
        const result = step.up(driver);
        if (result instanceof Promise) throw new Error(`Migration ${step.version} is asynchronous; use run()`);
        recordMeta(driver.database, this.appVersion, step.version, "applied", current);
        driver.database.exec("COMMIT");
      } catch (error) {
        try { driver.database.exec("ROLLBACK"); } catch { /* preserve migration error */ }
        recordMeta(driver.database, this.appVersion, step.version, "failed", current, String(error));
        history.push({ version: step.version, status: "failed", detail: String(error) });
        throw error;
      }
      history.push({ version: step.version, status: "applied" });
      current = step.version;
      applied += 1;
    }
    return { applied, finalVersion: current, history };
  }
}

function ensureMetaTable(raw: DatabaseSync): void {
  raw.exec(`CREATE TABLE IF NOT EXISTS schema_meta(version INTEGER NOT NULL, applied_at TEXT NOT NULL, app_version TEXT NOT NULL, status TEXT NOT NULL, previous INTEGER, detail TEXT);`);
}

function recordMeta(raw: DatabaseSync, appVersion: string, version: number, status: "applied" | "failed", previous: number, detail?: string): void {
  raw.prepare(`INSERT INTO schema_meta(version, applied_at, app_version, status, previous, detail) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(version, new Date().toISOString(), appVersion, status, previous, detail ?? null);
}

function readCurrentVersion(raw: DatabaseSync): number {
  const row = raw.prepare(`SELECT MAX(version) AS version FROM schema_meta WHERE status = 'applied'`).get() as { version: number | null } | undefined;
  return row?.version ?? 0;
}

export const DEFAULT_MIGRATIONS: readonly MigrationStep[] = [
  {
    version: 1,
    description: "create events, idempotency_results, event_consumers",
    up: (driver) => {
      driver.database.exec(`
        CREATE TABLE IF NOT EXISTS events(
          id TEXT PRIMARY KEY,
          stream TEXT NOT NULL,
          stream_seq INTEGER NOT NULL,
          type TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          actor TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          idempotency_key TEXT,
          UNIQUE(stream, stream_seq)
        );
        CREATE INDEX IF NOT EXISTS events_stream_idx ON events(stream, stream_seq);
        CREATE TABLE IF NOT EXISTS idempotency_results(
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          recorded_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS event_consumers(
          consumer TEXT NOT NULL,
          stream TEXT NOT NULL,
          last_seq INTEGER NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(consumer, stream)
        );
      `);
    },
  },
  {
    version: 2,
    description: "create catalog, settings, task, memory and object reference projections",
    up: (driver) => {
      driver.database.exec(`
        CREATE TABLE IF NOT EXISTS workspaces(
          workspace_cwd TEXT PRIMARY KEY,
          title TEXT,
          source_hash TEXT,
          updated_at TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS sessions(
          session_id TEXT PRIMARY KEY,
          workspace_cwd TEXT NOT NULL,
          source_path TEXT NOT NULL,
          source_hash TEXT NOT NULL,
          title TEXT,
          created_at TEXT,
          updated_at TEXT,
          message_count INTEGER NOT NULL DEFAULT 0,
          pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
          archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
          expert_id TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          FOREIGN KEY(workspace_cwd) REFERENCES workspaces(workspace_cwd) ON UPDATE CASCADE
        );
        CREATE INDEX IF NOT EXISTS sessions_workspace_idx ON sessions(workspace_cwd, archived, pinned, updated_at DESC);
        CREATE TABLE IF NOT EXISTS session_bindings(
          session_id TEXT NOT NULL,
          binding_type TEXT NOT NULL,
          binding_id TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL,
          PRIMARY KEY(session_id, binding_type),
          FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS settings(
          namespace TEXT NOT NULL,
          setting_key TEXT NOT NULL,
          value_json TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(namespace, setting_key)
        );
        CREATE TABLE IF NOT EXISTS plugin_registry(
          plugin_id TEXT PRIMARY KEY,
          version TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          manifest_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks(
          task_id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          title TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS teams(
          team_id TEXT PRIMARY KEY,
          goal TEXT NOT NULL,
          size TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS team_members(
          team_id TEXT NOT NULL,
          member_id TEXT NOT NULL,
          role TEXT NOT NULL,
          model TEXT,
          status TEXT NOT NULL,
          output TEXT,
          started_at TEXT,
          ended_at TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          PRIMARY KEY(team_id, member_id),
          FOREIGN KEY(team_id) REFERENCES teams(team_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS collaboration_rooms(
          room_id TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          title TEXT,
          status TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS team_status_idx ON teams(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS collaboration_rooms_status_idx ON collaboration_rooms(status, updated_at DESC);
        CREATE TABLE IF NOT EXISTS approvals(
          approval_id TEXT PRIMARY KEY,
          task_id TEXT,
          status TEXT NOT NULL,
          decision_json TEXT,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS schedules(
          schedule_id TEXT PRIMARY KEY,
          expression TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          payload_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS runs(
          run_id TEXT PRIMARY KEY,
          schedule_id TEXT,
          status TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          result_json TEXT,
          FOREIGN KEY(schedule_id) REFERENCES schedules(schedule_id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS memory_documents(
          document_id TEXT PRIMARY KEY,
          source_path TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          title TEXT,
          content TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(document_id UNINDEXED, title, content, tokenize='unicode61');
        CREATE TABLE IF NOT EXISTS object_refs(
          object_hash TEXT PRIMARY KEY,
          size_bytes INTEGER NOT NULL,
          media_type TEXT,
          relative_path TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS secret_refs(
          secret_ref TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          label TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS migration_issues(
          issue_id TEXT PRIMARY KEY,
          source_path TEXT,
          issue_type TEXT NOT NULL,
          detail TEXT NOT NULL,
          source_hash TEXT,
          created_at TEXT NOT NULL,
          resolved_at TEXT
        );
        CREATE TABLE IF NOT EXISTS backup_manifests(
          backup_id TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          integrity_ok INTEGER NOT NULL CHECK (integrity_ok IN (0, 1)),
          created_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 3,
    description: "create task, automation and notification projections",
    up: (driver) => {
      driver.database.exec(`
        CREATE TABLE IF NOT EXISTS session_tasks(
          session_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          task_order INTEGER NOT NULL,
          PRIMARY KEY(session_id, task_id)
        );
        CREATE INDEX IF NOT EXISTS session_tasks_order_idx ON session_tasks(session_id, task_order);
        CREATE TABLE IF NOT EXISTS session_task_snapshots(
          session_id TEXT PRIMARY KEY,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS automation_definitions(
          automation_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          prompt TEXT NOT NULL,
          status TEXT NOT NULL,
          schedule_type TEXT NOT NULL,
          schedule_json TEXT NOT NULL,
          cwd TEXT,
          client_json TEXT,
          model_id TEXT,
          permission_mode TEXT NOT NULL,
          valid_from_date TEXT,
          valid_until_date TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          next_run_at TEXT
        );
        CREATE INDEX IF NOT EXISTS automation_due_idx ON automation_definitions(status, next_run_at);
        CREATE TABLE IF NOT EXISTS automation_state(
          state_id INTEGER PRIMARY KEY CHECK (state_id = 1),
          initialized_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS automation_runs(
          run_id TEXT PRIMARY KEY,
          automation_id TEXT NOT NULL,
          automation_name TEXT NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          ok INTEGER,
          session_id TEXT,
          status TEXT NOT NULL,
          error TEXT,
          archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
          FOREIGN KEY(automation_id) REFERENCES automation_definitions(automation_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS automation_runs_started_idx ON automation_runs(started_at DESC);
        CREATE TABLE IF NOT EXISTS notifications(
          notification_id INTEGER PRIMARY KEY,
          kind TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT,
          session_id TEXT,
          severity TEXT NOT NULL,
          read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1))
        );
        CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications(read, occurred_at DESC);
        CREATE TABLE IF NOT EXISTS notification_state(
          state_id INTEGER PRIMARY KEY CHECK (state_id = 1),
          initialized_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 4,
    description: "create fenced writer leases and durable operations",
    up: (driver) => {
      driver.database.exec(`
        CREATE TABLE IF NOT EXISTS writer_leases(
          lease_name TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          fencing_token INTEGER NOT NULL,
          acquired_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS durable_operations(
          operation_id TEXT PRIMARY KEY,
          idempotency_key TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
          attempt INTEGER NOT NULL DEFAULT 0,
          fencing_token INTEGER,
          input_json TEXT NOT NULL DEFAULT '{}',
          result_json TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS durable_operations_status_idx ON durable_operations(status, updated_at);
      `);
    },
  },
  {
    version: 5,
    description: "create durable Harness session cursors",
    up: (driver) => {
      driver.database.exec(`
        CREATE TABLE IF NOT EXISTS harness_session_cursors(
          session_id TEXT PRIMARY KEY,
          last_seq INTEGER NOT NULL CHECK (last_seq >= -1),
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 6,
    description: "create collaboration contract and inbox cursor projections",
    up: (driver) => {
      driver.database.exec(`
        CREATE TABLE IF NOT EXISTS collaboration_task_contracts(
          task_id TEXT PRIMARY KEY,
          mode TEXT NOT NULL,
          contract_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS collaboration_task_contracts_mode_idx
          ON collaboration_task_contracts(mode, updated_at DESC);
        CREATE TABLE IF NOT EXISTS collaboration_inbox_cursors(
          principal_id TEXT PRIMARY KEY,
          cursor_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 7,
    description: "create structured email capability state projection",
    up: (driver) => {
      driver.database.exec(`
        CREATE TABLE IF NOT EXISTS email_state_records(
          domain TEXT NOT NULL,
          record_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(domain, record_id)
        );
        CREATE INDEX IF NOT EXISTS email_state_records_order_idx
          ON email_state_records(domain, position, updated_at DESC);
        CREATE TABLE IF NOT EXISTS email_state_meta(
          state_id INTEGER PRIMARY KEY CHECK (state_id = 1),
          legacy_imported INTEGER NOT NULL DEFAULT 0 CHECK (legacy_imported IN (0, 1)),
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 8,
    description: "create workspace catalog projection",
    up: (driver) => {
      driver.database.exec(`
        CREATE TABLE IF NOT EXISTS workspace_catalog(
          workspace_id TEXT PRIMARY KEY,
          workspace_path TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          session_ids_json TEXT NOT NULL DEFAULT '[]',
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS workspace_catalog_position_idx
          ON workspace_catalog(position, updated_at DESC);
        CREATE TABLE IF NOT EXISTS workspace_archived_sessions(
          session_id TEXT PRIMARY KEY,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 9,
    description: "create calendar event projection",
    up: (driver) => {
      driver.database.exec(`
        CREATE TABLE IF NOT EXISTS calendar_events(
          event_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          start_at TEXT NOT NULL,
          end_at TEXT NOT NULL,
          time_zone TEXT,
          all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
          status TEXT NOT NULL CHECK (status IN ('confirmed', 'tentative', 'cancelled')),
          room_id TEXT NOT NULL,
          context_refs_json TEXT NOT NULL DEFAULT '[]',
          description TEXT,
          location TEXT,
          attendees_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS calendar_events_time_idx
          ON calendar_events(start_at, end_at, room_id, status);
        CREATE INDEX IF NOT EXISTS calendar_events_room_idx
          ON calendar_events(room_id, start_at);
        CREATE TABLE IF NOT EXISTS calendar_state_meta(
          state_id INTEGER PRIMARY KEY CHECK (state_id = 1),
          legacy_imported INTEGER NOT NULL DEFAULT 0 CHECK (legacy_imported IN (0, 1)),
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 10,
    description: "backfill task snapshot markers for existing profiles",
    up: (driver) => {
      driver.database.exec(`
        CREATE TABLE IF NOT EXISTS session_task_snapshots(
          session_id TEXT PRIMARY KEY,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 11,
    description: "repair notification initialization marker for existing profiles",
    up: (driver) => {
      driver.database.exec(`
        CREATE TABLE IF NOT EXISTS notification_state(
          state_id INTEGER PRIMARY KEY CHECK (state_id = 1),
          initialized_at TEXT NOT NULL
        );
      `);
    },
  },
];
