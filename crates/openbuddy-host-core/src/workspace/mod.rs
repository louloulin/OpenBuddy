//! Workspace path canonicalization + boundary + ignore-file handling.
//!
//! Mirrors PI-Desktop `crates/host-core/src/workspace.rs` and the TS
//! sandbox code in `electron/main/subprocess-runtime.ts:413-445`:
//!
//!   - `resolve(path)` — `fs::canonicalize` + relative-from-workspace
//!     computation. Symlinks are resolved so a malicious symlink cannot
//!     escape the workspace.
//!   - `check(path)` — `in_workspace` boolean + `is_directory` boolean
//!   - `list_ignored()` — walks the workspace and reports files matched by
//!     `.openbuddyignore` (gitignore syntax via the `ignore` crate).
//!
//! The TS layer at `subprocess-runtime.ts:413-445` (`SandboxPolicyService`)
//! and the existing `folder-trust` package continue to apply policy on top
//! of the canonical path this module returns. The Rust layer only reports
//! ground truth; policy lives in TS.

use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

#[derive(Default, Debug)]
pub struct WorkspaceHandle {
    inner: Arc<RwLock<WorkspaceState>>,
}

#[derive(Default, Debug)]
struct WorkspaceState {
    workspace_root: Option<PathBuf>,
    matcher: Option<Gitignore>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveResult {
    pub canonical: String,
    #[serde(rename = "inWorkspace")]
    pub in_workspace: bool,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckResult {
    #[serde(rename = "inWorkspace")]
    pub in_workspace: bool,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
    #[serde(rename = "isFile")]
    pub is_file: bool,
    #[serde(rename = "exists")]
    pub exists: bool,
    #[serde(rename = "ignored")]
    pub ignored: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IgnoredEntry {
    pub path: String,
    #[serde(rename = "matchedPattern")]
    pub matched_pattern: Option<String>,
}

impl WorkspaceHandle {
    pub fn open() -> Self {
        Self::default()
    }

    pub fn set_workspace_root(&self, root: PathBuf) -> Result<()> {
        let canonical = canonicalize_existing(&root)?;
        let matcher = build_matcher(&canonical)?;
        let mut state = self.inner.write();
        state.workspace_root = Some(canonical);
        state.matcher = Some(matcher);
        Ok(())
    }

    pub fn workspace_root(&self) -> Option<PathBuf> {
        self.inner.read().workspace_root.clone()
    }

    pub fn resolve(&self, path: &Path) -> Result<ResolveResult> {
        let canonical = canonicalize(path)?;
        let root = self
            .inner
            .read()
            .workspace_root
            .clone()
            .ok_or_else(|| anyhow!("workspace root not configured; call set_workspace_root first"))?;
        let in_workspace = canonical.starts_with(&root);
        let is_directory = canonical.is_dir();
        Ok(ResolveResult {
            canonical: canonical.to_string_lossy().to_string(),
            in_workspace,
            is_directory,
        })
    }

    pub fn check(&self, path: &Path) -> Result<CheckResult> {
        let canonical = canonicalize(path)?;
        let state = self.inner.read();
        let root = state
            .workspace_root
            .clone()
            .ok_or_else(|| anyhow!("workspace root not configured"))?;
        let in_workspace = canonical.starts_with(&root);
        let is_directory = canonical.is_dir();
        let is_file = canonical.is_file();
        let exists = canonical.exists();
        let ignored = match state.matcher.as_ref() {
            Some(m) => {
                if in_workspace {
                    let relative = canonical.strip_prefix(&root).unwrap_or(&canonical);
                    m.matched(relative, is_file).is_ignore()
                } else {
                    false
                }
            }
            None => false,
        };
        Ok(CheckResult {
            in_workspace,
            is_directory,
            is_file,
            exists,
            ignored,
        })
    }

    pub fn list_ignored(&self, max_entries: usize) -> Result<Vec<IgnoredEntry>> {
        let state = self.inner.read();
        let root = state
            .workspace_root
            .clone()
            .ok_or_else(|| anyhow!("workspace root not configured"))?;
        let matcher = state
            .matcher
            .clone()
            .ok_or_else(|| anyhow!("ignore matcher not built"))?;
        let mut out: Vec<IgnoredEntry> = Vec::new();
        for entry in ignore::WalkBuilder::new(&root)
            .standard_filters(false)
            .require_git(false)
            .build()
            .flatten()
        {
            if out.len() >= max_entries {
                break;
            }
            let path = entry.path().to_path_buf();
            if !path.starts_with(&root) {
                continue;
            }
            let relative = path.strip_prefix(&root).unwrap_or(&path);
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let m = matcher.matched(relative, !is_dir);
            if m.is_ignore() {
                out.push(IgnoredEntry {
                    path: path.to_string_lossy().to_string(),
                    matched_pattern: Some(format!("{m:?}")),
                });
            }
        }
        Ok(out)
    }
}

fn canonicalize_existing(path: &Path) -> Result<PathBuf> {
    if !path.exists() {
        return Err(anyhow!(
            "workspace root does not exist: {}",
            path.display()
        ));
    }
    std::fs::canonicalize(path).with_context(|| format!("canonicalize {}", path.display()))
}

fn canonicalize(path: &Path) -> Result<PathBuf> {
    // For non-existing paths, normalise manually so the boundary check
    // remains correct (e.g. resolve a path the caller has not yet created).
    if path.exists() {
        std::fs::canonicalize(path).with_context(|| format!("canonicalize {}", path.display()))
    } else {
        let mut normalized = PathBuf::new();
        for comp in path.components() {
            match comp {
                Component::ParentDir => {
                    normalized.pop();
                }
                Component::CurDir => {}
                other => normalized.push(other.as_os_str()),
            }
        }
        if normalized.as_os_str().is_empty() {
            normalized.push(".");
        }
        Ok(normalized)
    }
}

fn build_matcher(root: &Path) -> Result<Gitignore> {
    let mut builder = GitignoreBuilder::new(root);
    let ignore_path = root.join(".openbuddyignore");
    if ignore_path.exists() {
        let _ = builder.add(&ignore_path);
    }
    let global = root.join(".gitignore");
    if global.exists() {
        let _ = builder.add(&global);
    }
    Ok(builder.build().context("build gitignore matcher")?)
}

#[derive(Debug, Deserialize)]
pub struct ResolveParams {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct CheckParams {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct SetRootParams {
    #[serde(rename = "workspaceRoot")]
    pub workspace_root: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile_tempdir_compat::TempDir;
    // Avoid pulling `tempfile` as a workspace dep; use a hand-rolled tempdir.
    mod tempfile_tempdir_compat {
        use std::path::PathBuf;
        pub struct TempDir(pub PathBuf);
        impl TempDir {
            pub fn new(tag: &str) -> Self {
                let n = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos();
                let pid = std::process::id();
                let p = std::env::temp_dir().join(format!("ob-ws-{tag}-{pid}-{n}"));
                std::fs::create_dir_all(&p).unwrap();
                Self(p)
            }
            pub fn path(&self) -> &std::path::Path {
                &self.0
            }
        }
        impl Drop for TempDir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    fn make_tree() -> (TempDir, std::path::PathBuf) {
        let tmp = TempDir::new("ws");
        let root = tmp.path().to_path_buf();
        fs::create_dir_all(root.join("subdir")).unwrap();
        fs::write(root.join("file.txt"), "hello").unwrap();
        fs::write(root.join("subdir/nested.txt"), "world").unwrap();
        // `secret/**` matches the contents of the secret dir; gitignore
        // syntax requires the trailing `**` to recurse. The dir itself is
        // matched separately by the walker (we add `secret/` too).
        fs::write(
            root.join(".openbuddyignore"),
            "secret/\nsecret/**\n*.log\n!important.log\n",
        )
        .unwrap();
        fs::create_dir_all(root.join("secret")).unwrap();
        fs::write(root.join("secret/key.pem"), "x").unwrap();
        fs::write(root.join("debug.log"), "y").unwrap();
        fs::write(root.join("important.log"), "z").unwrap();
        (tmp, root)
    }

    #[test]
    fn resolve_within_workspace_returns_canonical_and_true() {
        let (_tmp, root) = make_tree();
        let h = WorkspaceHandle::open();
        h.set_workspace_root(root.clone()).unwrap();
        let res = h.resolve(&root.join("subdir")).unwrap();
        assert!(res.in_workspace);
        assert!(res.is_directory);
        assert!(res.canonical.contains("subdir"));
    }

    #[test]
    fn resolve_outside_workspace_returns_false() {
        let (_tmp, root) = make_tree();
        let h = WorkspaceHandle::open();
        h.set_workspace_root(root.clone()).unwrap();
        let outside = std::env::temp_dir().join("ob-ws-outside-not-workspace");
        let _ = fs::create_dir_all(&outside);
        let res = h.resolve(&outside).unwrap();
        assert!(!res.in_workspace);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn resolve_rejects_parent_traversal_into_workspace() {
        let (_tmp, root) = make_tree();
        let h = WorkspaceHandle::open();
        h.set_workspace_root(root.clone()).unwrap();
        // Try to escape via `..` segments
        let sneaky = root.join("subdir").join("..").join("..").join("..").join("etc");
        let res = h.resolve(&sneaky).unwrap();
        // canonicalize of non-existent "etc" will normalize the path but
        // strip_parent removes the parent dirs, leaving the path "etc" —
        // which does not start with the workspace root, so in_workspace=false.
        assert!(!res.in_workspace);
    }


    #[test]
    fn check_reports_ignored_secret_dir() {
        let (_tmp, root) = make_tree();
        let h = WorkspaceHandle::open();
        h.set_workspace_root(root.clone()).unwrap();
        let res = h.check(&root.join("secret/key.pem")).unwrap();
        assert!(res.in_workspace);
        assert!(res.is_file);
        assert!(res.ignored);
    }

    #[test]
    fn check_reports_important_log_as_not_ignored() {
        let (_tmp, root) = make_tree();
        let h = WorkspaceHandle::open();
        h.set_workspace_root(root.clone()).unwrap();
        let res = h.check(&root.join("important.log")).unwrap();
        assert!(res.in_workspace);
        assert!(res.is_file);
        assert!(!res.ignored, "negation pattern should not mark important.log as ignored");
    }

    #[test]
    fn check_reports_debug_log_as_ignored() {
        let (_tmp, root) = make_tree();
        let h = WorkspaceHandle::open();
        h.set_workspace_root(root.clone()).unwrap();
        let res = h.check(&root.join("debug.log")).unwrap();
        assert!(res.ignored);
    }

    #[test]
    fn list_ignored_returns_ignored_paths() {
        let (_tmp, root) = make_tree();
        let h = WorkspaceHandle::open();
        h.set_workspace_root(root.clone()).unwrap();
        let entries = h.list_ignored(64).unwrap();
        let paths: Vec<String> = entries.iter().map(|e| e.path.clone()).collect();
        assert!(paths.iter().any(|p| p.ends_with("secret") || p.contains("secret/key")), "secret dir should be listed; got {:?}", paths);
        assert!(paths.iter().any(|p| p.ends_with("debug.log")));
        assert!(!paths.iter().any(|p| p.ends_with("important.log")));
    }

    #[test]
    fn missing_workspace_root_returns_error() {
        let h = WorkspaceHandle::open();
        let err = h.set_workspace_root(PathBuf::from("/does/not/exist/at/all/anywhere")).unwrap_err();
        assert!(err.to_string().contains("does not exist"));
    }

    #[test]
    fn check_without_root_returns_error() {
        let h = WorkspaceHandle::open();
        let err = h.check(Path::new("/tmp")).unwrap_err();
        assert!(err.to_string().contains("workspace root not configured"));
    }
}
