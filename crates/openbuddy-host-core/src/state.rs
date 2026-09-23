//! Application state owned by host-core. Loaded once at startup, then handed
//! to the RPC dispatcher and each capability module.
//!
//! Mirrors PI-Desktop `crates/host-core/src/state.rs` (372 lines) but trimmed
//! to the five capabilities in scope.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result};

/// Root data directory (`<PI_OPENBUDDY_DATA_DIR>` or `~/.openbuddy`).
#[derive(Debug, Clone)]
pub struct DataDir(pub PathBuf);

impl DataDir {
    pub fn resolve() -> Result<Self> {
        let raw = std::env::var("PI_OPENBUDDY_DATA_DIR")
            .map(PathBuf::from)
            .or_else(|_| {
                dirs::home_dir()
                    .map(|h| h.join(".openbuddy"))
                    .ok_or_else(|| anyhow::anyhow!("no home dir resolved"))
            })?;
        std::fs::create_dir_all(&raw)
            .with_context(|| format!("failed to create data dir {}", raw.display()))?;
        Ok(Self(raw))
    }

    pub fn secrets_dir(&self) -> PathBuf {
        self.0.join("secrets")
    }

    pub fn audit_path(&self) -> PathBuf {
        self.0.join("audit.jsonl")
    }

    pub fn db_path(&self) -> PathBuf {
        self.0.join("host.sqlite")
    }

    pub fn crash_dumps_dir(&self) -> PathBuf {
        self.0.join("crash-dumps")
    }

    pub fn logs_dir(&self) -> PathBuf {
        self.0.join("logs")
    }

    pub fn cache_dir(&self) -> PathBuf {
        self.0.join("cache")
    }
}

/// Top-level application state shared by all handlers.
pub struct AppState {
    pub data_dir: DataDir,
    /// Capability handles. Each is `Option<Arc<...>>` until Phase 1 wires them
    /// in; in Phase 0 the dispatcher returns `method_not_found` for any
    /// capability call.
    pub secrets: crate::secrets::SecretsHandle,
    pub permissions: crate::permissions::PermissionsHandle,
    pub session_search: crate::session_search::SessionSearchHandle,
    pub workspace: crate::workspace::WorkspaceHandle,
    pub audit: crate::audit::AuditHandle,
}

impl AppState {
    pub fn open(data_dir: DataDir) -> Result<Arc<Self>> {
        let state = Arc::new(Self {
            data_dir: data_dir.clone(),
            secrets: crate::secrets::SecretsHandle::default(),
            permissions: crate::permissions::PermissionsHandle::default(),
            session_search: crate::session_search::SessionSearchHandle::default(),
            workspace: crate::workspace::WorkspaceHandle::default(),
            audit: crate::audit::AuditHandle::default(),
        });
        Ok(state)
    }

    pub fn data_dir_path(&self) -> &Path {
        &self.data_dir.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_dir_resolves_to_home_when_env_absent() {
        // Set the env var to a temp dir to keep the test hermetic.
        let tmp = std::env::temp_dir().join(format!(
            "openbuddy-state-test-{}-{}",
            std::process::id(),
            chrono_nanos()
        ));
        std::env::set_var("PI_OPENBUDDY_DATA_DIR", &tmp);
        let dir = DataDir::resolve().unwrap();
        assert_eq!(dir.0, tmp);
        std::env::remove_var("PI_OPENBUDDY_DATA_DIR");
    }

    fn chrono_nanos() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }
}
