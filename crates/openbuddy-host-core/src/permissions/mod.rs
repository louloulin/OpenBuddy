//! Permission gateway — Phase 1 will move deny/ask/allow evaluation here.

use serde::{Deserialize, Serialize};

#[derive(Default, Debug)]
pub struct PermissionsHandle {
    _priv: (),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionAction {
    Allow,
    Deny,
    Ask,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionDecision {
    pub action: PermissionAction,
    pub reason: Option<String>,
    #[serde(rename = "matchedRule")]
    pub matched_rule: Option<String>,
}
