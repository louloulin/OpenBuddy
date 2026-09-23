//! OpenBuddy host-core SQLite schema + migrations.
//!
//! Owns the `host.sqlite` file under `<data_dir>/host.sqlite`. The TS main
//! process opens a separate `openbuddy.sqlite` for its own tables — they are
//! distinct schemas so no WAL coordination is required.

pub mod schema {
    /// Schema version stamped into `pragma user_version`.
    pub const SCHEMA_VERSION: i64 = 1;

    /// One-shot bootstrap. Idempotent; safe to call on every startup.
    pub fn bootstrap(conn: &rusqlite::Connection) -> anyhow::Result<()> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                cwd TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                mode TEXT NOT NULL DEFAULT 'agent',
                title TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
                ON sessions(updated_at DESC);

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_messages_session_created
                ON messages(session_id, created_at);

            -- FTS5 virtual table backed by `messages`. CJK / non-ASCII queries
            -- fall back to a literal `LIKE` scan through the `messages_contains`
            -- scalar function registered by `session_search::contains`.
            CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
                USING fts5(content, content='messages', content_rowid='id');

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS secret_meta (
                ref TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                backend TEXT NOT NULL,
                label TEXT,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                at INTEGER NOT NULL,
                kind TEXT NOT NULL,
                outcome TEXT NOT NULL,
                subject TEXT,
                tenant_id TEXT,
                resource TEXT,
                action TEXT NOT NULL,
                reason TEXT,
                code TEXT,
                provider TEXT,
                target TEXT,
                payload_hash TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at DESC);
            CREATE INDEX IF NOT EXISTS idx_audit_kind ON audit(kind, at DESC);
            "#,
        )?;

        // Stamp the schema version on first run.
        let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if current < SCHEMA_VERSION {
            conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_is_idempotent() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        schema::bootstrap(&conn).unwrap();
        schema::bootstrap(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type IN ('table', 'index', 'view', 'trigger')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(count > 0, "schema should expose tables / indexes after bootstrap");

        let user_version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap();
        assert_eq!(user_version, schema::SCHEMA_VERSION);
    }
}
