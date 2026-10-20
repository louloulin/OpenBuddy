//! OpenBuddy audit entry — shared serde model.
//!
//! Mirrors the schema consumed by `electron/main/casdoor-audit.ts` and the
//! planned `electron/main/agent-audit.ts`. The same JSON shape crosses the
//! Rust ↔ TypeScript boundary so a single contract file governs both sides.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Audit event category. Aligns with PI-Desktop `crates/host-core/src/audit.rs`
/// but trimmed to OpenBuddy's current scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditKind {
    /// Casdoor login / OAuth / refresh lifecycle.
    Auth,
    /// Permission decision (allow / deny / ask).
    Permission,
    /// Folder trust grant / revoke.
    FolderTrust,
    /// Tool execution blocked / sandbox-denied.
    Tool,
    /// Plugin install / upgrade / rollback / uninstall.
    Plugin,
    /// Secrets set / delete (value never leaves the Rust side).
    Secret,
    /// Generic host event.
    Host,
}

/// Outcome of the audited action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditOutcome {
    Success,
    Failure,
    Denied,
    Timeout,
}

/// Single audit row. Matches the JSON shape consumed by the TS renderer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: String,
    pub at: DateTime<Utc>,
    pub kind: AuditKind,
    pub outcome: AuditOutcome,
    pub subject: Option<String>,
    pub tenant_id: Option<String>,
    pub resource: Option<String>,
    pub action: String,
    pub reason: Option<String>,
    pub code: Option<String>,
    pub provider: Option<String>,
    pub target: Option<String>,
    /// SHA-256 of the sanitized payload (12-char prefix). Tamper-evident.
    pub payload_hash: String,
}

impl AuditEntry {
    pub fn new(kind: AuditKind, outcome: AuditOutcome, action: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            at: Utc::now(),
            kind,
            outcome,
            subject: None,
            tenant_id: None,
            resource: None,
            action: action.into(),
            reason: None,
            code: None,
            provider: None,
            target: None,
            payload_hash: String::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_entry_serializes_camel_case_outward() {
        let entry = AuditEntry::new(AuditKind::Auth, AuditOutcome::Success, "login");
        let json = serde_json::to_string(&entry).unwrap();
        // snake_case-internal, no transform outward (TS layer adapts)
        assert!(json.contains("\"action\":\"login\""));
        assert!(json.contains("\"kind\":\"auth\""));
        assert!(json.contains("\"outcome\":\"success\""));
    }

    #[test]
    fn audit_entry_default_fields_are_none_or_empty() {
        let entry = AuditEntry::new(AuditKind::Tool, AuditOutcome::Denied, "bash.run");
        assert_eq!(entry.action, "bash.run");
        assert_eq!(entry.kind, AuditKind::Tool);
        assert_eq!(entry.outcome, AuditOutcome::Denied);
        assert!(entry.subject.is_none());
        assert!(entry.payload_hash.is_empty());
    }
}
