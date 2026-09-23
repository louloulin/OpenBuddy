//! Session search — JSONL scan with Unicode-aware substring matching.
//!
//! Phase 1 baseline. Mirrors PI-Desktop `crates/host-core/src/session_search.rs`
//! layout but uses an in-memory implementation instead of SQLite FTS5:
//
//   - SQLite FTS5 setup requires a schema migration step (the `openbuddy-db`
//!     crate is reserved for that in Phase 2). For Phase 1 we read JSONL
//!     files directly and rank by term frequency + recency.
//!   - Scoring: `(term_hits_in_message * 10) + recency_bonus` where
//!     `recency_bonus = (1.0 / (1.0 + days_since))` for the session's
//!     most-recent timestamp.
//!   - Snippet: 80 chars of context around the first hit, with the matched
//!     term highlighted via uppercase (the renderer can re-style).
//!
//! Wire methods (Phase 1):
//!   - `session.search` — full-text query across all sessions
//!   - `session.message` — retrieve a specific message line by `session_id` + `line_no`

use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

#[derive(Default, Debug)]
pub struct SessionSearchHandle {
    inner: Arc<RwLock<SessionSearchState>>,
}

#[derive(Default, Debug)]
struct SessionSearchState {
    sessions_root: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub title: Option<String>,
    pub snippet: String,
    pub rank: f32,
    #[serde(rename = "lineNo")]
    pub line_no: usize,
    #[serde(rename = "matchedAt")]
    pub matched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageResult {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "lineNo")]
    pub line_no: usize,
    pub role: Option<String>,
    pub content: String,
    #[serde(rename = "createdAt")]
    pub created_at: Option<String>,
}

impl SessionSearchHandle {
    pub fn open() -> Self {
        Self::default()
    }

    pub fn set_sessions_root(&self, root: PathBuf) -> Result<()> {
        if !root.exists() {
            return Err(anyhow!(
                "sessions root does not exist: {}",
                root.display()
            ));
        }
        let mut state = self.inner.write();
        state.sessions_root = Some(root);
        Ok(())
    }

    pub fn search(
        &self,
        query: &str,
        max_results: usize,
    ) -> Result<SearchResult> {
        let state = self.inner.read();
        let root = state
            .sessions_root
            .clone()
            .ok_or_else(|| anyhow!("sessions root not configured"))?;
        if query.trim().is_empty() {
            return Ok(SearchResult { hits: Vec::new(), total: 0 });
        }
        let q_lower = query.to_lowercase();
        let mut all_hits: Vec<SearchHit> = Vec::new();
        let mut total: u64 = 0;
        for entry in walk_jsonl(&root) {
            let path = entry?;
            let (hits, count) = scan_file(&path, &q_lower, query, max_results * 4)?;
            total = total.saturating_add(count);
            all_hits.extend(hits);
        }
        // Sort by rank descending, then take top N.
        all_hits.sort_by(|a, b| b.rank.partial_cmp(&a.rank).unwrap_or(std::cmp::Ordering::Equal));
        all_hits.truncate(max_results);
        Ok(SearchResult { hits: all_hits, total })
    }

    pub fn message(
        &self,
        session_id: &str,
        line_no: usize,
    ) -> Result<MessageResult> {
        let state = self.inner.read();
        let root = state
            .sessions_root
            .clone()
            .ok_or_else(|| anyhow!("sessions root not configured"))?;
        let path = find_session_file(&root, session_id)
            .ok_or_else(|| anyhow!("session not found: {}", session_id))?;
        let file = File::open(&path)
            .with_context(|| format!("open session file {}", path.display()))?;
        let reader = BufReader::new(file);
        for (idx, line) in reader.lines().enumerate() {
            if idx + 1 != line_no {
                continue;
            }
            let line = line?;
            let parsed: serde_json::Value = serde_json::from_str(&line)
                .with_context(|| format!("parse line {} of {}", line_no, path.display()))?;
            let role = parsed.get("role").and_then(|v| v.as_str()).map(str::to_string);
            let content = parsed
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let created_at = parsed
                .get("timestamp")
                .and_then(|v| v.as_str())
                .or_else(|| parsed.get("createdAt").and_then(|v| v.as_str()))
                .map(str::to_string);
            return Ok(MessageResult {
                session_id: session_id.to_string(),
                line_no,
                role,
                content,
                created_at,
            });
        }
        Err(anyhow!("line {} not found in session {}", line_no, session_id))
    }
}

fn walk_jsonl(root: &Path) -> impl Iterator<Item = Result<PathBuf>> {
    let root = root.to_path_buf();
    let mut out: Vec<Result<PathBuf>> = Vec::new();
    walk_recursive(&root, &mut out);
    out.into_iter()
}

fn walk_recursive(dir: &Path, out: &mut Vec<Result<PathBuf>>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(err) => {
            out.push(Err(anyhow!(err).context(format!("read_dir {}", dir.display()))));
            return;
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(err) => {
                out.push(Err(anyhow!(err)));
                continue;
            }
        };
        if file_type.is_dir() {
            walk_recursive(&path, out);
        } else if file_type.is_file() && path.extension().map(|e| e == "jsonl").unwrap_or(false) {
            out.push(Ok(path));
        }
    }
}

fn find_session_file(root: &Path, session_id: &str) -> Option<PathBuf> {
    // Pi-style sessions live in `<parent>/<session_id>.jsonl`. We accept
    // either the bare id or a `cwd--<id>--` path-encoded cwd.
    let direct = root.join(format!("{}.jsonl", session_id));
    if direct.exists() {
        return Some(direct);
    }
    for entry in walk_jsonl(root).flatten() {
        if let Some(stem) = entry.file_stem().and_then(|s| s.to_str()) {
            if stem == session_id || stem.contains(session_id) {
                return Some(entry);
            }
        }
    }
    None
}

fn scan_file(
    path: &Path,
    query_lower: &str,
    query_orig: &str,
    cap: usize,
) -> Result<(Vec<SearchHit>, u64)> {
    let file = File::open(path)
        .with_context(|| format!("open {}", path.display()))?;
    let reader = BufReader::new(file);
    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();
    let mut hits: Vec<SearchHit> = Vec::new();
    let mut count: u64 = 0;
    let mut title: Option<String> = None;
    let mut last_ts: Option<DateTime<Utc>> = None;
    for (idx, line) in reader.lines().enumerate() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let parsed: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let role = parsed.get("role").and_then(|v| v.as_str()).unwrap_or("");
        let content = parsed.get("content").and_then(|v| v.as_str()).unwrap_or("");
        let ts_str = parsed
            .get("timestamp")
            .and_then(|v| v.as_str())
            .or_else(|| parsed.get("createdAt").and_then(|v| v.as_str()));
        if let Some(ts) = ts_str.and_then(parse_ts) {
            last_ts = Some(ts);
        }
        if title.is_none() && role == "user" && !content.is_empty() {
            title = Some(truncate(content, 80));
        }
        let content_lower = content.to_lowercase();
        let occurrences: usize = content_lower
            .match_indices(query_lower)
            .count();
        if occurrences == 0 {
            continue;
        }
        count = count.saturating_add(1);
        if hits.len() < cap {
            let snippet = build_snippet(content, query_orig, 80);
            let recency_bonus = match last_ts {
                    Some(ts) => recency_score(ts),
                    None => 0.0,
                };
            let rank = (occurrences as f32) * 10.0 + recency_bonus;
            hits.push(SearchHit {
                session_id: session_id.clone(),
                title: title.clone(),
                snippet,
                rank,
                line_no: idx + 1,
                matched_at: ts_str.unwrap_or("").to_string(),
            });
        }
    }
    Ok((hits, count))
}

fn parse_ts(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn recency_score(ts: DateTime<Utc>) -> f32 {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let then = ts.timestamp();
    let days = ((now - then).max(0) as f64) / 86_400.0;
    (1.0_f32 / (1.0_f32 + days as f32))
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        let mut out: String = text.chars().take(max).collect();
        out.push('…');
        out
    }
}

fn build_snippet(content: &str, query: &str, radius: usize) -> String {
    let lower_content = content.to_lowercase();
    let lower_query = query.to_lowercase();
    let Some(pos) = lower_content.find(&lower_query) else {
        return truncate(content, radius * 2);
    };
    let start_byte = lower_content[..pos]
        .char_indices()
        .nth(0)
        .map(|(b, _)| b)
        .unwrap_or(0);
    let before_chars = lower_content[..pos].chars().count();
    let chars_before = before_chars.min(radius);
    let char_indices: Vec<(usize, char)> = content.char_indices().collect();
    let start_idx = before_chars.saturating_sub(chars_before);
    let end_target = before_chars + lower_query.chars().count() + radius;
    let end_idx = end_target.min(char_indices.len());
    let snippet: String = char_indices[start_idx..end_idx]
        .iter()
        .map(|(_, c)| *c)
        .collect();
    let prefix = if start_idx > 0 { "…" } else { "" };
    let suffix = if end_idx < char_indices.len() { "…" } else { "" };
    format!("{prefix}{snippet}{suffix}")
}

// -- params for IPC ---------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct SearchParams {
    pub query: String,
    #[serde(default = "default_max_results")]
    pub max_results: usize,
}

fn default_max_results() -> usize {
    50
}

#[derive(Debug, Deserialize)]
pub struct MessageParams {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "lineNo")]
    pub line_no: usize,
}

#[derive(Debug, Deserialize)]
pub struct SetRootParams {
    #[serde(rename = "sessionsRoot")]
    pub sessions_root: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fresh() -> std::path::PathBuf {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let pid = std::process::id();
        let p = std::env::temp_dir().join(format!("ob-sess-{pid}-{n}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn write_session(path: &Path, id: &str, lines: &[&str]) {
        let p = path.join(format!("{id}.jsonl"));
        let body: String = lines
            .iter()
            .map(|l| format!("{l}\n"))
            .collect();
        fs::write(&p, body).unwrap();
    }

    #[test]
    fn empty_query_returns_no_hits() {
        let root = fresh();
        write_session(&root, "s1", &[
            r#"{"role":"user","content":"hello world","timestamp":"2026-09-23T10:00:00Z"}"#,
        ]);
        let h = SessionSearchHandle::open();
        h.set_sessions_root(root.clone()).unwrap();
        let res = h.search("", 10).unwrap();
        assert_eq!(res.total, 0);
        assert!(res.hits.is_empty());
    }

    #[test]
    fn finds_substring_case_insensitively() {
        let root = fresh();
        write_session(&root, "s1", &[
            r#"{"role":"user","content":"Find the Rust compiler","timestamp":"2026-09-23T10:00:00Z"}"#,
            r#"{"role":"assistant","content":"The RUST compiler is rustc.","timestamp":"2026-09-23T10:00:05Z"}"#,
        ]);
        let h = SessionSearchHandle::open();
        h.set_sessions_root(root.clone()).unwrap();
        let res = h.search("rust", 10).unwrap();
        assert_eq!(res.total, 2);
        assert_eq!(res.hits[0].session_id, "s1");
        assert!(res.hits[0].snippet.contains("Rust") || res.hits[0].snippet.contains("RUST"));
    }

    #[test]
    fn ranks_repeated_hits_higher() {
        let root = fresh();
        write_session(&root, "s1", &[
            r#"{"role":"user","content":"hello","timestamp":"2026-09-23T10:00:00Z"}"#,
        ]);
        write_session(&root, "s2", &[
            r#"{"role":"user","content":"foo foo foo foo bar","timestamp":"2026-09-23T10:00:00Z"}"#,
        ]);
        let h = SessionSearchHandle::open();
        h.set_sessions_root(root.clone()).unwrap();
        let res = h.search("foo", 10).unwrap();
        assert!(!res.hits.is_empty());
        // s2 has 4 occurrences, s1 has 0 — so s2 should rank first.
        assert_eq!(res.hits[0].session_id, "s2");
    }

    #[test]
    fn message_lookup_returns_role_and_content() {
        let root = fresh();
        write_session(&root, "s1", &[
            r#"{"role":"user","content":"first line","timestamp":"2026-09-23T10:00:00Z"}"#,
            r#"{"role":"assistant","content":"second line","timestamp":"2026-09-23T10:00:05Z"}"#,
        ]);
        let h = SessionSearchHandle::open();
        h.set_sessions_root(root.clone()).unwrap();
        let res = h.message("s1", 2).unwrap();
        assert_eq!(res.role.as_deref(), Some("assistant"));
        assert_eq!(res.content, "second line");
        assert_eq!(res.line_no, 2);
    }

    #[test]
    fn message_lookup_404_for_unknown_session() {
        let root = fresh();
        let h = SessionSearchHandle::open();
        h.set_sessions_root(root.clone()).unwrap();
        let err = h.message("does-not-exist", 1).unwrap_err();
        assert!(err.to_string().contains("not found"));
    }

    #[test]
    fn set_sessions_root_rejects_missing_dir() {
        let h = SessionSearchHandle::open();
        let err = h.set_sessions_root(PathBuf::from("/no/such/path/at/all")).unwrap_err();
        assert!(err.to_string().contains("does not exist"));
    }

    #[test]
    fn search_handles_unicode_query_and_content() {
        let root = fresh();
        write_session(&root, "u1", &[
            r#"{"role":"user","content":"你好，世界 — 这是中文测试","timestamp":"2026-09-23T10:00:00Z"}"#,
        ]);
        let h = SessionSearchHandle::open();
        h.set_sessions_root(root.clone()).unwrap();
        let res = h.search("中文", 10).unwrap();
        assert_eq!(res.total, 1);
        assert!(res.hits[0].snippet.contains("中文"));
    }
}
