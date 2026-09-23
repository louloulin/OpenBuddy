//! Secrets capability — Phase 1 will move AES-256-GCM + Keychain logic here.
//! Phase 0 only declares the handle so the binary compiles.

use serde::{Deserialize, Serialize};

/// Per-instance handle. Holds no state until Phase 1 wires the SecretStore.
#[derive(Default, Debug)]
pub struct SecretsHandle {
    _priv: (),
}

/// Result of `secrets.list` (Phase 1 shape — declared here for the TypeScript
/// contract review).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretMeta {
    #[serde(rename = "ref")]
    pub secret_ref: String,
    pub kind: String,
    pub backend: String,
    pub label: Option<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}
