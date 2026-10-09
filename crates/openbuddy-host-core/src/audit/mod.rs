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
    /// On-disk shape (TS-compatible). See AuditLogLine doc.
    pub entries: Vec<AuditLogLine>,
    #[serde(rename = "rotatedFiles")]
    pub rotated_files: usize,
}

impl AuditHandle {
    pub fn open(data_dir: &Path) -> Result<Self> {
        let path = data_dir.join("audit.jsonl");
        // Don't create the file here; the first append does so. We do want
        // to make sure the parent directory exists.
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("failed to create audit dir {}", parent.display()))?;
        }
        Ok(Self {
            inner: Arc::new(Mutex::new(AuditState { path })),
        })
    }

    pub fn append(&self, params: AppendParams) -> Result<AppendResult> {
        let mut entry = AuditEntry::new(
            parse_kind(&params.kind)?,
            parse_outcome(&params.outcome)?,
            params.action,
        );
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
        let mut bytes = serde_json::to_vec(&AuditLogLine::from(&entry))
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
        let len = fs::metadata(&state.path).map(|m| m.len()).unwrap_or(0);

        // Rotation policy — keep file <= MAX_AUDIT_BYTES and <= MAX_AUDIT_ENTRIES.
        if len > MAX_AUDIT_BYTES {
            rotate_if_needed(&state.path, MAX_AUDIT_ENTRIES)?;
        }

        Ok(AppendResult {
            id,
            at,
            payload_hash,
        })
    }

    pub fn tail(&self, params: TailParams) -> Result<TailResult> {
        let state = self.inner.lock();
        let rotated = rotated_file_count(&state.path)?;
        let entries = read_last_n(&state.path, params.limit.clamp(1, MAX_AUDIT_ENTRIES))?;
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

/// On-disk audit line — TS-compatible JSON shape.
///
/// The renderer (`packages/runtime/openbuddy-host-runtime/src/capabilities.ts`
/// plus `electron/main/audit/audit-log.ts`) reads `<userData>/audit.jsonl` and
/// expects every line to conform to:
///
/// ```text
/// { id, at, event, outcome, source, subject?, detail?, hash? }
/// ```
///
/// To keep Rust <-> TS wiring safe, we serialize AuditEntry through this
/// wrapper so the on-disk JSON has the same keys the TS reader expects.
/// The structured fields Rust cares about (kind, tenant_id, resource,
/// reason, code, provider, target) are kept inside detail so the TS
/// reader can ignore them without breaking, while Rust callers that want
/// the full record call audit.tail which returns the typed AuditEntry.
#[derive(Debug, Serialize, Deserialize)]
pub struct AuditLogLine {
    pub id: String,
    pub at: chrono::DateTime<Utc>,
    /// Specific event name (e.g. "bash.run"). Comes from AuditEntry.action.
    pub event: String,
    /// Outcome string — one of "allow" | "deny" | "success" | "failure" | "info".
    pub outcome: String,
    /// Constant — Rust writes come from the host-core binary.
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    /// Aggregated structured fields. TS readers ignore this; Rust callers
    /// get the typed shape via AuditEntry.
    pub detail: AuditLogLineDetail,
    pub hash: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuditLogLineDetail {
    pub kind: AuditKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
}

impl From<&AuditEntry> for AuditLogLine {
    fn from(entry: &AuditEntry) -> AuditLogLine {
        let outcome = match entry.outcome {
            AuditOutcome::Success => "success",
            AuditOutcome::Failure => "failure",
            AuditOutcome::Denied => "deny",
            AuditOutcome::Timeout => "failure",
        };
        AuditLogLine {
            id: entry.id.clone(),
            at: entry.at,
            event: entry.action.clone(),
            outcome: outcome.to_string(),
            source: "main".to_string(),
            subject: entry.subject.clone(),
            detail: AuditLogLineDetail {
                kind: entry.kind,
                tenant_id: entry.tenant_id.clone(),
                resource: entry.resource.clone(),
                reason: entry.reason.clone(),
                code: entry.code.clone(),
                provider: entry.provider.clone(),
                target: entry.target.clone(),
            },
            hash: entry.payload_hash.clone(),
        }
    }
}

fn compute_payload_hash(entry: &AuditEntry) -> String {
    // Hash the sanitized payload (everything except the id / at / payload_hash
    // fields) so the renderer can verify integrity without trusting the host.
    let mut hasher = Sha256::new();
    hasher.update(format!("{:?}", entry.kind).as_bytes());
    hasher.update(format!("{:?}", entry.outcome).as_bytes());
    hasher.update(entry.action.as_bytes());
    if let Some(s) = &entry.subject {
        hasher.update(s.as_bytes());
    }
    if let Some(s) = &entry.resource {
        hasher.update(s.as_bytes());
    }
    if let Some(s) = &entry.code {
        hasher.update(s.as_bytes());
    }
    if let Some(s) = &entry.provider {
        hasher.update(s.as_bytes());
    }
    if let Some(s) = &entry.target {
        hasher.update(s.as_bytes());
    }
    let digest = hasher.finalize();
    let mut out = String::with_capacity(24);
    for b in &digest[..12] {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

fn rotated_file_count(path: &Path) -> Result<usize> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("audit.jsonl");
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
    let entries: Vec<&[u8]> = bytes
        .split(|b| *b == b'\n')
        .filter(|l| !l.is_empty())
        .collect();
    if entries.len() <= max_entries {
        return Ok(());
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("audit.jsonl");
    let rotated = parent.join(format!("{stem}.rotated.{}", Utc::now().timestamp_millis()));
    fs::rename(path, &rotated)?;
    Ok(())
}

fn read_last_n(path: &Path, n: usize) -> Result<Vec<AuditLogLine>> {
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
    let offset = len.saturating_sub(window);
    file.seek(SeekFrom::Start(offset))?;
    let mut buf = Vec::with_capacity((len - offset) as usize);
    file.read_to_end(&mut buf)?;
    let mut entries = Vec::new();
    for line in buf.split(|b| *b == b'\n').rev() {
        if line.is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_slice::<AuditLogLine>(line) {
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

    fn fixture_path() -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tid = format!("{:?}", std::thread::current().id());
        std::env::temp_dir().join(format!(
            "openbuddy-audit-test-{pid}-{nanos}-{tid}",
            pid = std::process::id(),
        ))
    }

    fn fixture_handle() -> AuditHandle {
        let tmp = fixture_path();
        std::fs::create_dir_all(&tmp).unwrap();
        AuditHandle::open(&tmp).unwrap()
    }

    fn fixture_handle_with_path() -> (AuditHandle, std::path::PathBuf) {
        let tmp = fixture_path();
        std::fs::create_dir_all(&tmp).unwrap();
        let audit_path = tmp.join("audit.jsonl");
        (AuditHandle::open(&tmp).unwrap(), audit_path)
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
        assert!(tail.entries[0].event.starts_with("bash.run."));
        // Hash present and 24 hex chars (12-byte SHA-256 prefix).
        assert_eq!(tail.entries[0].hash.len(), 24);
        // Source tag identifies the host-core writer.
        assert_eq!(tail.entries[0].source, "main");
    }

    #[test]
    fn on_disk_json_matches_ts_audit_event_contract() {
        // ADR-0012: 磁盘 audit.jsonl 每行必须满足 packages/runtime/openbuddy-host-runtime/
        // src/capabilities.ts::AuditEntry 的 TS 契约。
        // 关键字段:id / at / event / outcome / source / subject? / detail / hash。
        //
        // 与 append_then_tail 共用 fixture 路径(同一个 PID + 进程内 nanos+thread 派生)。
        let (handle, audit_path) = fixture_handle_with_path();
        handle
            .append(AppendParams {
                kind: "permission".into(),
                outcome: "denied".into(),
                action: "bash.run".into(),
                subject: Some("rm -rf /".into()),
                tenant_id: Some("acme".into()),
                resource: Some("/etc".into()),
                reason: Some("deny-rule-match".into()),
                code: Some("PERMISSION_DENIED".into()),
                provider: None,
                target: None,
            })
            .unwrap();
        let raw = std::fs::read_to_string(&audit_path).unwrap();
        let line = raw.lines().next().expect("at least one line");
        let v: serde_json::Value = serde_json::from_str(line).unwrap();

        // 1. 顶层 TS 字段必须存在
        for key in ["id", "at", "event", "outcome", "source", "detail", "hash"] {
            assert!(
                v.get(key).is_some(),
                "missing top-level field {key} on disk"
            );
        }
        // 2. subject? 也写入(本测试有 subject)
        assert!(v.get("subject").is_some(), "subject missing");

        // 3. detail 必须聚合 kind / tenant_id / resource / reason / code
        let detail = v.get("detail").unwrap();
        assert_eq!(
            detail.get("kind").and_then(|x| x.as_str()),
            Some("permission")
        );
        assert_eq!(
            detail.get("tenant_id").and_then(|x| x.as_str()),
            Some("acme")
        );
        assert_eq!(
            detail.get("resource").and_then(|x| x.as_str()),
            Some("/etc")
        );
        assert_eq!(
            detail.get("reason").and_then(|x| x.as_str()),
            Some("deny-rule-match")
        );
        assert_eq!(
            detail.get("code").and_then(|x| x.as_str()),
            Some("PERMISSION_DENIED")
        );

        // 4. 旧 Rust shape 的 key 必须不在顶层(payload_hash / kind / action)
        assert!(
            v.get("payload_hash").is_none(),
            "old payload_hash leaked to top level"
        );
        assert!(v.get("kind").is_none(), "old top-level kind leaked");
        assert!(v.get("action").is_none(), "old top-level action leaked");

        // 5. outcome 必须为 deny (Denied 映射),hash 必须为 24 hex chars
        assert_eq!(v.get("outcome").and_then(|x| x.as_str()), Some("deny"));
        let hash = v.get("hash").and_then(|x| x.as_str()).unwrap();
        assert_eq!(hash.len(), 24);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
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
