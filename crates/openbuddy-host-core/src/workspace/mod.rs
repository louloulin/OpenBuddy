//! Workspace boundary check — Phase 1 will move canonicalization here.

use serde::{Deserialize, Serialize};

#[derive(Default, Debug)]
pub struct WorkspaceHandle {
    _priv: (),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveResult {
    pub canonical: String,
    #[serde(rename = "inWorkspace")]
    pub in_workspace: bool,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
}
