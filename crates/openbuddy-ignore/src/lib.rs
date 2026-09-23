//! `.openbuddyignore` loader. Wraps the `ignore` crate (ripgrep's matcher) to
//! load an `.openbuddyignore` file at the workspace root and check arbitrary
//! paths against it.

use std::path::Path;

use anyhow::{Context, Result};
use ignore::gitignore::{Gitignore, GitignoreBuilder};

/// Loaded ignore matcher bound to a workspace root.
pub struct WorkspaceIgnore {
    inner: Gitignore,
}

impl WorkspaceIgnore {
    /// Load `.openbuddyignore` from `workspace_root`. Falls back to an empty
    /// matcher if the file does not exist (treated as "no ignore rules").
    pub fn load(workspace_root: &Path) -> Result<Self> {
        let mut builder = GitignoreBuilder::new(workspace_root);
        let ignore_path = workspace_root.join(".openbuddyignore");
        if ignore_path.exists() {
            let raw = std::fs::read_to_string(&ignore_path)
                .with_context(|| format!("failed to load {}", ignore_path.display()))?;
            for (idx, line) in raw.lines().enumerate() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                builder
                    .add_line(None, trimmed)
                    .with_context(|| {
                        format!("failed to add line {} of .openbuddyignore", idx + 1)
                    })?;
            }
        }
        let inner = builder.build().context("failed to build gitignore matcher")?;
        Ok(Self { inner })
    }

    /// Check whether `path` should be ignored. `is_dir` must reflect the file
    /// type (matches ripgrep semantics).
    pub fn is_ignored(&self, path: &Path, is_dir: bool) -> bool {
        self.inner.matched(path, is_dir).is_ignore()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn empty_load_does_not_ignore_anything() {
        let dir = tempfile_path("empty");
        fs::create_dir_all(&dir).unwrap();
        let ignore = WorkspaceIgnore::load(&dir).unwrap();
        assert!(!ignore.is_ignored(&dir.join("foo.txt"), false));
    }

    #[test]
    fn pattern_in_openbuddyignore_is_honored() {
        let dir = tempfile_path("pattern");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(".openbuddyignore"), "*.log\n").unwrap();
        let ignore = WorkspaceIgnore::load(&dir).unwrap();
        assert!(ignore.is_ignored(&dir.join("debug.log"), false));
        assert!(!ignore.is_ignored(&dir.join("notes.md"), false));
    }

    fn tempfile_path(tag: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "openbuddy-ignore-test-{tag}-{}-{}",
            std::process::id(),
            chrono_now_nanos()
        ));
        p
    }

    fn chrono_now_nanos() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    }
}
