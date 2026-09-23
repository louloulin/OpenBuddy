//! Session search — Phase 1 will move SQLite FTS5 + Unicode fallback here.

use serde::{Deserialize, Serialize};

#[derive(Default, Debug)]
pub struct SessionSearchHandle {
    _priv: (),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub title: Option<String>,
    pub snippet: String,
    pub rank: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    pub total: u64,
}
