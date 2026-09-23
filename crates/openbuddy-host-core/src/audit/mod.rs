//! Audit log — Phase 1 will move JSONL append / sanitize / hash here.

use serde::{Deserialize, Serialize};

#[derive(Default, Debug)]
pub struct AuditHandle {
    _priv: (),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditAppendRequest {
    pub kind: String,
    pub outcome: String,
    pub action: String,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub resource: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditTailResult {
    pub entries: Vec<openbuddy_audit_types::AuditEntry>,
}
