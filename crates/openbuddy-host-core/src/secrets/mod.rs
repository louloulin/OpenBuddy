//! Secrets capability — AES-256-GCM encrypted storage with file_fallback backend.
//!
//! Phase 1 implementation. Mirrors PI-Desktop
//! `crates/host-core/src/secrets.rs`:
//!
//! - On macOS we defer to the OS keychain (via the `security` CLI) when
//!   available. This implementation uses a portable fallback because the
//!   `keyring` crate would pull a kernel-conditional dependency that we
//!   explicitly avoided per the PI-Desktop借鉴 plan.
//! - On Linux / Windows / and as the `file_fallback` on any platform we
//!   encrypt each value with AES-256-GCM keyed by a machine-local 256-bit
//!   secret stored at `<data_dir>/secrets/.machine-key` (mode 0o600 on
//!   Unix). The plaintext never touches disk; the IV is random per write.
//! - `secrets.list` always reports `backend: "file_fallback"` so the UI can
//!   surface a banner explaining that the OS keychain is unavailable on the
//!   current platform. The reference contract is unchanged.
//!
//! Wire format per entry (`<data_dir>/secrets/<sha256-of-ref>.json`):
//! ```json
//! { "ref": "secret:provider:openai:api_key",
//!   "label": "OpenAI API key",
//!   "ciphertext": "<hex>",
//!   "nonce": "<hex>",
//!   "backend": "file_fallback",
//!   "updated_at": "2026-09-23T14:00:00Z" }
//! ```
//!
//! The on-disk index is intentionally NOT stored separately: each call to
//! `list()` walks the secrets directory and decrypts the `ref` field (which
//! is NOT encrypted — only the value is). That keeps the on-disk format
//! resilient against index corruption.

use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use parking_lot::Mutex;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use openbuddy_error_codes::RpcError;

/// Per-instance handle. Owns the encryption key + the secrets directory path.
pub struct SecretsHandle {
    inner: Arc<Mutex<SecretsState>>,
}

struct SecretsState {
    dir: PathBuf,
    cipher: Aes256Gcm,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SecretMeta {
    #[serde(rename = "ref")]
    pub secret_ref: String,
    pub kind: String,
    pub backend: String,
    pub label: Option<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct OnDiskEntry {
    #[serde(rename = "ref")]
    secret_ref: String,
    label: Option<String>,
    /// AES-256-GCM ciphertext (hex).
    ciphertext: String,
    /// AES-256-GCM nonce (96-bit / 12 bytes, hex).
    nonce: String,
    backend: String,
    #[serde(rename = "updated_at")]
    updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct SetParams {
    #[serde(rename = "ref")]
    pub secret_ref: String,
    pub value: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GetParams {
    #[serde(rename = "ref")]
    pub secret_ref: String,
}

#[derive(Debug, Deserialize)]
pub struct DeleteParams {
    #[serde(rename = "ref")]
    pub secret_ref: String,
}

#[derive(Debug, Serialize)]
pub struct SetResult {
    #[serde(rename = "ref")]
    pub secret_ref: String,
    pub backend: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct GetResult {
    pub value: String,
    pub backend: String,
}

#[derive(Debug, Serialize)]
pub struct ListResult {
    pub backend: String,
    pub secrets: Vec<SecretMeta>,
}

impl SecretsHandle {
    /// Open the secrets store rooted at `<data_dir>/secrets/`. Generates a
    /// fresh machine-local 256-bit key on first use, persists it with
    /// 0o600 (Unix), and reuses it across restarts.
    pub fn open(data_dir: &Path) -> Result<Self> {
        let dir = data_dir.join("secrets");
        fs::create_dir_all(&dir)
            .with_context(|| format!("failed to create secrets dir {}", dir.display()))?;

        let key_path = dir.join(".machine-key");
        // The raw key bytes are the single source of truth: whatever we
        // persist MUST be the same bytes the in-memory cipher is built from.
        // Deriving the cipher and the file separately (the old shape) meant
        // first-run secrets were written under one key and read back under a
        // different one, i.e. every credential entered before the first
        // restart was silently undecryptable forever.
        let key_bytes = if key_path.exists() {
            load_key(&key_path)?
        } else {
            let bytes = generate_key();
            save_key(&key_path, &bytes)?;
            bytes
        };
        let cipher = cipher_from_key(&key_bytes)?;

        Ok(Self {
            inner: Arc::new(Mutex::new(SecretsState { dir, cipher })),
        })
    }

    pub fn set(&self, params: SetParams) -> Result<SetResult> {
        validate_ref(&params.secret_ref)?;
        let value = params.value;
        let state = self.inner.lock();
        let (ciphertext, nonce) = encrypt(&state.cipher, value.as_bytes())?;
        let entry = OnDiskEntry {
            secret_ref: params.secret_ref.clone(),
            label: params.label.clone(),
            ciphertext,
            nonce,
            backend: BACKEND.to_string(),
            updated_at: Utc::now().to_rfc3339(),
        };
        let path = entry_path(&state.dir, &params.secret_ref);
        let json = serde_json::to_vec_pretty(&entry)
            .map_err(|e| anyhow!("failed to serialize secret entry: {e}"))?;
        write_atomically(&path, &json)
            .with_context(|| format!("failed to write {}", path.display()))?;
        Ok(SetResult {
            secret_ref: params.secret_ref,
            backend: BACKEND.to_string(),
            updated_at: entry.updated_at,
        })
    }

    pub fn get(&self, params: GetParams) -> Result<GetResult> {
        validate_ref(&params.secret_ref)?;
        let state = self.inner.lock();
        let path = entry_path(&state.dir, &params.secret_ref);
        let bytes = match fs::read(&path) {
            Ok(b) => b,
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                return Err(RpcError::SecretNotFound(params.secret_ref.clone()).into());
            }
            Err(err) => {
                return Err(err).with_context(|| format!("failed to read {}", path.display()));
            }
        };
        let entry: OnDiskEntry = serde_json::from_slice(&bytes)
            .with_context(|| format!("failed to parse {}", path.display()))?;
        if entry.secret_ref != params.secret_ref {
            return Err(anyhow!(
                "ref mismatch for {}: stored={} requested={}",
                path.display(),
                entry.secret_ref,
                params.secret_ref
            ));
        }
        let nonce_bytes = hex_decode(&entry.nonce)?;
        let ciphertext = hex_decode(&entry.ciphertext)?;
        let plaintext = decrypt(&state.cipher, &nonce_bytes, &ciphertext)
            .map_err(|_| anyhow!("failed to decrypt secret (key may have changed)"))?;
        let value = String::from_utf8(plaintext)
            .map_err(|_| anyhow!("decrypted secret is not valid UTF-8"))?;
        Ok(GetResult {
            value,
            backend: entry.backend,
        })
    }

    pub fn delete(&self, params: DeleteParams) -> Result<()> {
        validate_ref(&params.secret_ref)?;
        let state = self.inner.lock();
        let path = entry_path(&state.dir, &params.secret_ref);
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(err).with_context(|| format!("failed to remove {}", path.display())),
        }
    }

    pub fn list(&self) -> Result<ListResult> {
        let state = self.inner.lock();
        let mut secrets = Vec::new();
        let entries = match fs::read_dir(&state.dir) {
            Ok(d) => d,
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                return Ok(ListResult {
                    backend: BACKEND.to_string(),
                    secrets,
                });
            }
            Err(err) => {
                return Err(err).with_context(|| format!("readdir {}", state.dir.display()))
            }
        };
        for entry in entries {
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') || !name.ends_with(".json") {
                continue;
            }
            let path = entry.path();
            let bytes = match fs::read(&path) {
                Ok(b) => b,
                Err(_) => continue,
            };
            let parsed: serde_json::Result<OnDiskEntry> = serde_json::from_slice(&bytes);
            let parsed = match parsed {
                Ok(v) => v,
                Err(_) => continue,
            };
            secrets.push(SecretMeta {
                secret_ref: parsed.secret_ref,
                kind: parsed.backend.clone(),
                backend: parsed.backend,
                label: parsed.label,
                updated_at: parsed.updated_at,
            });
        }
        // Stable order for UI
        secrets.sort_by(|a, b| a.secret_ref.cmp(&b.secret_ref));
        Ok(ListResult {
            backend: BACKEND.to_string(),
            secrets,
        })
    }
}

/// Stable backend name returned by every method so the UI can render an
/// explanatory banner when the OS keychain is unavailable.
pub const BACKEND: &str = "file_fallback";

fn validate_ref(secret_ref: &str) -> Result<()> {
    if secret_ref.is_empty() {
        return Err(RpcError::InvalidParams("ref must not be empty".into()).into());
    }
    if secret_ref.len() > 256 {
        return Err(RpcError::InvalidParams("ref too long (> 256 chars)".into()).into());
    }
    if secret_ref.contains('/') || secret_ref.contains("\\") || secret_ref.contains("..") {
        return Err(
            RpcError::InvalidParams("ref must not contain path separators or '..'".into()).into(),
        );
    }
    Ok(())
}

fn entry_path(dir: &Path, secret_ref: &str) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(secret_ref.as_bytes());
    let hash = hex_encode(&hasher.finalize());
    dir.join(format!("{hash}.json"))
}

/// Draw 32 fresh bytes from the OS CSPRNG. The returned bytes — not the
/// `Aes256Gcm` built from them — are what gets persisted, so that a restart
/// derives the identical cipher.
fn generate_key() -> [u8; 32] {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

fn cipher_from_key(bytes: &[u8]) -> Result<Aes256Gcm> {
    if bytes.len() != 32 {
        return Err(anyhow!(
            "machine key has invalid length {} (expected 32)",
            bytes.len()
        ));
    }
    Ok(Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(bytes)))
}

fn load_key(path: &Path) -> Result<[u8; 32]> {
    let mut f = fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut bytes = Vec::new();
    f.read_to_end(&mut bytes)?;
    // Fail closed on a truncated/garbage key rather than silently rotating:
    // rotating would orphan every existing entry with an unrecoverable error.
    if bytes.len() != 32 {
        return Err(anyhow!(
            "machine key has invalid length {} (expected 32)",
            bytes.len()
        ));
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}

/// Persist the machine key.
///
/// The file is created 0o600 at `open()` time rather than chmod'd afterwards:
/// a create-then-chmod sequence leaves a window where the key sits on disk
/// under the default umask (world-readable on many systems), which for a file
/// whose entire job is to protect every other credential is not a window worth
/// having. Content is `sync_all`ed before returning so a crash immediately
/// after first launch cannot leave a half-written key that fails `load_key`.
fn save_key(path: &Path, bytes: &[u8; 32]) -> Result<()> {
    let mut f = create_private(path).with_context(|| format!("create {}", path.display()))?;
    f.write_all(bytes)?;
    f.sync_all()?;
    Ok(())
}

fn create_private(path: &Path) -> io::Result<fs::File> {
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(path)
}

fn encrypt(cipher: &Aes256Gcm, plaintext: &[u8]) -> Result<(String, String)> {
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| anyhow!("encryption failed: {e}"))?;
    Ok((hex_encode(&ciphertext), hex_encode(&nonce_bytes)))
}

fn decrypt(cipher: &Aes256Gcm, nonce_bytes: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>> {
    if nonce_bytes.len() != 12 {
        return Err(anyhow!("invalid nonce length {}", nonce_bytes.len()));
    }
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow!("decryption failed: {e}"))
}

fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

fn hex_decode(s: &str) -> Result<Vec<u8>> {
    if s.len() % 2 != 0 {
        return Err(anyhow!("hex string has odd length"));
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    for i in (0..bytes.len()).step_by(2) {
        let hi = hex_nibble(bytes[i])?;
        let lo = hex_nibble(bytes[i + 1])?;
        out.push((hi << 4) | lo);
    }
    Ok(out)
}

fn hex_nibble(b: u8) -> Result<u8> {
    match b {
        b'0'..=b'9' => Ok(b - b'0'),
        b'a'..=b'f' => Ok(b - b'a' + 10),
        b'A'..=b'F' => Ok(b - b'A' + 10),
        other => Err(anyhow!("invalid hex character {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use openbuddy_error_codes::RpcError;

    fn fixture_handle() -> SecretsHandle {
        let tmp = std::env::temp_dir().join(format!(
            "openbuddy-secrets-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::env::set_var("PI_OPENBUDDY_DATA_DIR", &tmp);
        let data_dir = crate::state::DataDir::resolve().unwrap();
        SecretsHandle::open(&data_dir.0).unwrap()
    }

    #[test]
    fn set_then_get_roundtrip() {
        let handle = fixture_handle();
        let set = handle
            .set(SetParams {
                secret_ref: "secret:provider:openai:api_key".into(),
                value: "sk-test-1234567890".into(),
                label: Some("OpenAI API key".into()),
                kind: Some("provider".into()),
            })
            .unwrap();
        assert_eq!(set.backend, BACKEND);

        let got = handle
            .get(GetParams {
                secret_ref: "secret:provider:openai:api_key".into(),
            })
            .unwrap();
        assert_eq!(got.value, "sk-test-1234567890");
        assert_eq!(got.backend, BACKEND);
    }

    #[test]
    fn get_missing_returns_secret_not_found() {
        let handle = fixture_handle();
        let err = handle
            .get(GetParams {
                secret_ref: "secret:does:not:exist".into(),
            })
            .unwrap_err();
        let rpc = err.downcast_ref::<RpcError>();
        assert!(matches!(rpc, Some(RpcError::SecretNotFound(_))));
    }

    #[test]
    fn delete_is_idempotent() {
        let handle = fixture_handle();
        handle
            .set(SetParams {
                secret_ref: "secret:to:delete".into(),
                value: "v".into(),
                label: None,
                kind: None,
            })
            .unwrap();
        handle
            .delete(DeleteParams {
                secret_ref: "secret:to:delete".into(),
            })
            .unwrap();
        handle
            .delete(DeleteParams {
                secret_ref: "secret:to:delete".into(),
            })
            .unwrap();
    }

    #[test]
    fn list_reports_file_fallback_backend() {
        let handle = fixture_handle();
        handle
            .set(SetParams {
                secret_ref: "secret:a".into(),
                value: "1".into(),
                label: None,
                kind: None,
            })
            .unwrap();
        let list = handle.list().unwrap();
        assert_eq!(list.backend, BACKEND);
        assert!(list.secrets.iter().any(|s| s.secret_ref == "secret:a"));
    }

    #[test]
    fn validate_ref_rejects_path_separators() {
        assert!(validate_ref("a/b").is_err());
        assert!(validate_ref("../escape").is_err());
        assert!(validate_ref("").is_err());
        assert!(validate_ref("ok-ref.with.dots").is_ok());
    }

    fn scratch_dir(tag: &str) -> std::path::PathBuf {
        let tmp = std::env::temp_dir().join(format!(
            "openbuddy-secrets-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&tmp).unwrap();
        tmp
    }

    /// P0-9 — 首启密钥。The bug this pins: `open()` built the in-memory cipher
    /// from one random key and then persisted a *second*, unrelated random
    /// key. Everything written during the first session was therefore
    /// unreadable from the second launch onward — API keys silently lost,
    /// with the only symptom being "failed to decrypt secret (key may have
    /// changed)" much later, far from the launch that caused it.
    ///
    /// The regression shape has to be a real reopen, not two `get`s on one
    /// handle: only a second `open()` reads `.machine-key` back.
    #[test]
    fn first_launch_secrets_survive_a_restart() {
        let dir = scratch_dir("restart");
        let secret_ref = "secret:provider:openai:api_key";

        // Session 1 — the very first launch after install, so `open()` takes
        // the generate-and-persist branch.
        let first = SecretsHandle::open(&dir).unwrap();
        first
            .set(SetParams {
                secret_ref: secret_ref.into(),
                value: "sk-written-on-first-launch".into(),
                label: Some("OpenAI API key".into()),
                kind: Some("provider".into()),
            })
            .unwrap();
        // Still readable within the session it was written in.
        assert_eq!(
            first
                .get(GetParams {
                    secret_ref: secret_ref.into()
                })
                .unwrap()
                .value,
            "sk-written-on-first-launch"
        );

        // Session 2 — a fresh handle over the same data dir, i.e. a restart.
        let second = SecretsHandle::open(&dir).unwrap();
        assert_eq!(
            second
                .get(GetParams {
                    secret_ref: secret_ref.into()
                })
                .unwrap()
                .value,
            "sk-written-on-first-launch"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// The persisted key must be the exact 32 bytes the cipher was built from,
    /// not merely *a* key that decrypts this session.
    #[test]
    fn persisted_machine_key_is_the_one_in_use() {
        let dir = scratch_dir("key-identity");
        let handle = SecretsHandle::open(&dir).unwrap();
        handle
            .set(SetParams {
                secret_ref: "secret:x".into(),
                value: "v".into(),
                label: None,
                kind: None,
            })
            .unwrap();

        let raw = fs::read(dir.join("secrets").join(".machine-key")).unwrap();
        assert_eq!(raw.len(), 32);
        assert_eq!(
            load_key(&dir.join("secrets").join(".machine-key"))
                .unwrap()
                .to_vec(),
            raw
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dir.join("secrets").join(".machine-key"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600, "machine key must not be group/world readable");
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// A corrupted key must fail closed. Silently rotating would orphan every
    /// existing entry behind an unrecoverable "wrong key" error, so the user
    /// would lose all credentials without being told why.
    #[test]
    fn truncated_machine_key_fails_closed_instead_of_rotating() {
        let dir = scratch_dir("corrupt-key");
        let handle = SecretsHandle::open(&dir).unwrap();
        handle
            .set(SetParams {
                secret_ref: "secret:x".into(),
                value: "v".into(),
                label: None,
                kind: None,
            })
            .unwrap();

        let key_path = dir.join("secrets").join(".machine-key");
        fs::write(&key_path, b"too short").unwrap();

        let err = match SecretsHandle::open(&dir) {
            Ok(_) => panic!("a truncated machine key must not be silently rotated"),
            Err(e) => e,
        };
        assert!(
            err.to_string().contains("invalid length"),
            "expected a fail-closed length error, got: {err}"
        );

        // The bad key is left in place for forensics rather than being
        // overwritten — overwriting is what makes the loss unrecoverable.
        assert_eq!(fs::read(&key_path).unwrap(), b"too short");

        fs::remove_dir_all(&dir).ok();
    }
}
