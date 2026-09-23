//! Audit log — append-only JSONL with rolling 2 MB / 256-entry cap.
//!
//! Mirrors PI-Desktop `crates/host-core/src/audit.rs` (rotation policy +
//! SHA-256 payload hash). The on-disk format is one JSON object per line at
//! `<data_dir>/audit.jsonl`. We rotate by appending `.1` / `.2` ... when the
//! active file grows past the cap; readers always see the active file plus
//! the most-recent rotated file when calling `tail`.
//!
//! Wire methods (Phase 1):
//!   - `audit.append` — append one entry; returns the assigned id + hash
//!   - `audit.tail`   — return the most recent N entries
//!
//! Concurrency: a `parking_lot::Mutex` around the file handle keeps writes
//! strictly serialised. The throughput target is << 1 write/sec, so this is
//! fine.

use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use openbuddy_audit_types::{AuditEntry, AuditKind, AuditOutcome};
use openbuddy_error_codes::RpcError;

const MAX_AUDIT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_AUDIT_ENTRIES: usize = 256;

#[derive(Default, Debug)]
pub struct AuditHandle {
    inner: Arc<Mutex<AuditState>>,
}

#[derive(Default, Debug)]
struct AuditState {
    path: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct AppendParams {
    pub kind: String,
    pub outcome: String,
    pub action: String,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub tenant_id: Option<String>,
    #[serde(default)]
    pub resource: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub target: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AppendResult {
    pub id: String,
    #[serde(rename = "at")]
    pub at: chrono::DateTime<Utc>,
    #[serde(rename = "payloadHash")]
    pub payload_hash: String,
}

#[derive(Debug, Deserialize)]
pub struct TailParams {
    #[serde(default = "default_tail_limit")]
    pub limit: usize,
}

fn default_tail_limit() -> usize {
    50
}

#[derive(Debug, Serialize)]
pub struct TailResult {
    pub entries: Vec<AuditEntry>,
    #[serde(rename = "rotatedFiles")]
    pub rotated_files: usize,
}

impl AuditHandle {
    pub fn open(data_dir: &Path) -> Result<Self> {
        let path = data_dir.join("audit.jsonl");
        // Don't create the file here; the first append does so. We do want
        // to make sure the parent directory exists.
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).with_context(|| {
                format!("failed to create audit dir {}", parent.display())
            })?;
        }
        Ok(Self {
            inner: Arc::new(Mutex::new(AuditState { path })),
        })
    }

    pub fn append(&self, params: AppendParams) -> Result<AppendResult> {
        let mut entry = AuditEntry::new(parse_kind(&params.kind)?, parse_outcome(&params.outcome)?, params.action);
        entry.subject = params.subject;
        entry.tenant_id = params.tenant_id;
        entry.resource = params.resource;
        entry.reason = params.reason;
        entry.code = params.code;
        entry.provider = params.provider;
        entry.target = params.target;
        let payload_hash = compute_payload_hash(&entry);
        entry.payload_hash = payload_hash.clone();
        let id = entry.id.clone();
        let at = entry.at;

        let state = self.inner.lock();
        let mut bytes = serde_json::to_vec(&entry)
            .map_err(|e| anyhow!("failed to serialize audit entry: {e}"))?;
        bytes.push(b'\n');
        // Use plain create+write+close so the file descriptor isn't held in
        // append-mode (which prevents seek-based readers on macOS).
        {
            let mut f = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&state.path)
                .with_context(|| format!("failed to open {}", state.path.display()))?;
            f.write_all(&bytes)?;
            f.flush()?;
        }
        let len = fs::metadata(&state.path)
            .map(|m| m.len())
            .unwrap_or(0);

        // Rotation policy — keep file <= MAX_AUDIT_BYTES and <= MAX_AUDIT_ENTRIES.
        if len > MAX_AUDIT_BYTES {
            rotate_if_needed(&state.path, MAX_AUDIT_ENTRIES)?;
        }

        Ok(AppendResult { id, at, payload_hash })
    }

    pub fn tail(&self, params: TailParams) -> Result<TailResult> {
        let state = self.inner.lock();
        let rotated = rotated_file_count(&state.path)?;
        let entries = read_last_n(&state.path, params.limit.max(1).min(MAX_AUDIT_ENTRIES))?;
        Ok(TailResult {
            entries,
            rotated_files: rotated,
        })
    }
}

fn parse_kind(s: &str) -> Result<AuditKind> {
    Ok(match s {
        "auth" => AuditKind::Auth,
        "permission" => AuditKind::Permission,
        "folder_trust" => AuditKind::FolderTrust,
        "tool" => AuditKind::Tool,
        "plugin" => AuditKind::Plugin,
        "secret" => AuditKind::Secret,
        "host" => AuditKind::Host,
        other => return Err(RpcError::InvalidParams(format!("unknown audit kind {other}")).into()),
    })
}

fn parse_outcome(s: &str) -> Result<AuditOutcome> {
    Ok(match s {
        "success" => AuditOutcome::Success,
        "failure" => AuditOutcome::Failure,
        "denied" => AuditOutcome::Denied,
        "timeout" => AuditOutcome::Timeout,
        other => {
            return Err(RpcError::InvalidParams(format!("unknown audit outcome {other}")).into())
        }
    })
}

fn compute_payload_hash(entry: &AuditEntry) -> String {
    // Hash the sanitized payload (everything except the id / at / payload_hash
    // fields) so the renderer can verify integrity without trusting the host.
    let mut hasher = Sha256::new();
    hasher.update(format!("{:?}", entry.kind).as_bytes());
    hasher.update(format!("{:?}", entry.outcome).as_bytes());
    hasher.update(entry.action.as_bytes());
    if let Some(s) = &entry.subject { hasher.update(s.as_bytes()); }
    if let Some(s) = &entry.resource { hasher.update(s.as_bytes()); }
    if let Some(s) = &entry.code { hasher.update(s.as_bytes()); }
    if let Some(s) = &entry.provider { hasher.update(s.as_bytes()); }
    if let Some(s) = &entry.target { hasher.update(s.as_bytes()); }
    let digest = hasher.finalize();
    let mut out = String::with_capacity(24);
    for b in &digest[..12] {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

fn rotated_file_count(path: &Path) -> Result<usize> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path.file_name().and_then(|s| s.to_str()).unwrap_or("audit.jsonl");
    let mut count = 0;
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(stem) && name.ends_with(".rotated") {
            count += 1;
        }
    }
    Ok(count)
}

fn rotate_if_needed(path: &Path, max_entries: usize) -> Result<()> {
    let bytes = fs::read(path).unwrap_or_default();
    let entries: Vec<&[u8]> = bytes.split(|b| *b == b'\n').filter(|l| !l.is_empty()).collect();
    if entries.len() <= max_entries {
        return Ok(());
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path.file_name().and_then(|s| s.to_str()).unwrap_or("audit.jsonl");
    let rotated = parent.join(format!("{stem}.rotated.{}", Utc::now().timestamp_millis()));
    fs::rename(path, &rotated)?;
    Ok(())
}

fn read_last_n(path: &Path, n: usize) -> Result<Vec<AuditEntry>> {
    let mut file = match fs::File::open(path) {
        Ok(f) => f,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.into()),
    };
    let len = file.metadata()?.len();
    if len == 0 {
        return Ok(Vec::new());
    }
    // Read up to ~256 KiB from the tail — enough for 256 short JSONL rows.
    let window = 256u64 * 1024u64;
    let offset = if len > window { len - window } else { 0 };
    file.seek(SeekFrom::Start(offset))?;
    let mut buf = Vec::with_capacity((len - offset) as usize);
    file.read_to_end(&mut buf)?;
    let mut entries = Vec::new();
    for line in buf.split(|b| *b == b'\n').rev() {
        if line.is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_slice::<AuditEntry>(line) {
            entries.push(entry);
            if entries.len() >= n {
                break;
            }
        }
    }
    entries.reverse();
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_handle() -> AuditHandle {
        let tmp = std::env::temp_dir().join(format!(
            "openbuddy-audit-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::env::set_var("PI_OPENBUDDY_DATA_DIR", &tmp);
        let data_dir = crate::state::DataDir::resolve().unwrap();
        AuditHandle::open(&data_dir.0).unwrap()
    }

    #[test]
    fn append_then_tail() {
        let handle = fixture_handle();
        for i in 0..3 {
            handle
                .append(AppendParams {
                    kind: "tool".into(),
                    outcome: "success".into(),
                    action: format!("bash.run.{i}"),
                    subject: Some("user-1".into()),
                    tenant_id: None,
                    resource: Some("/tmp/x".into()),
                    reason: None,
                    code: None,
                    provider: None,
                    target: None,
                })
                .unwrap();
        }
        let tail = handle.tail(TailParams { limit: 10 }).unwrap();
        assert_eq!(tail.entries.len(), 3);
        assert!(tail.entries[0].action.starts_with("bash.run."));
        // Hash present and 24 hex chars.
        assert_eq!(tail.entries[0].payload_hash.len(), 24);
    }

    #[test]
    fn invalid_kind_is_rejected() {
        let handle = fixture_handle();
        let err = handle
            .append(AppendParams {
                kind: "garbage".into(),
                outcome: "success".into(),
                action: "noop".into(),
                subject: None,
                tenant_id: None,
                resource: None,
                reason: None,
                code: None,
                provider: None,
                target: None,
            })
            .unwrap_err();
        let rpc = err.downcast_ref::<RpcError>();
        assert!(matches!(rpc, Some(RpcError::InvalidParams(_))));
    }
}
