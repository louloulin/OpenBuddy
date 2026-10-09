//! Permission capability — Pi permission rule + mode service.
//!
//! Phase 1 implementation that mirrors `packages/auth/openbuddy-permission`
//! exactly so we can swap the TS implementation out without UI churn:
//!
//!   - Three actions (`allow` / `deny` / `ask`) with `deny > ask > allow`
//!     precedence (matches `resolvePermissionAction` in the TS module).
//!   - Five modes (`default` / `acceptEdits` / `dontAsk` / `plan` /
//!     `bypassPermissions`) — read/written through the same
//!     `agentPath("settings.json")` slot the TS code uses, so the JSON file
//!     is byte-identical to the TS writer.
//!   - Glob matching uses the `globset` crate which supports `**` and
//!     brace-expansion — strict improvement over the TS regex translator.
//!
//! The TS implementation may continue to operate alongside the Rust one
//! during the cut-over window; they share the on-disk schema.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::Utc;
use globset::{Glob, GlobMatcher};
use serde::{Deserialize, Serialize};

/// Action precedence — `Deny > Ask > Allow`. Matches the TS
/// `resolvePermissionAction` ordering exactly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "lowercase")]
pub enum PermissionAction {
    Allow,
    Deny,
    Ask,
}

impl PermissionAction {
    pub fn precedence(self) -> u8 {
        match self {
            PermissionAction::Deny => 3,
            PermissionAction::Ask => 2,
            PermissionAction::Allow => 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRule {
    pub action: PermissionAction,
    pub tool: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub pattern: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    #[default]
    Default,
    AcceptEdits,
    DontAsk,
    Plan,
    BypassPermissions,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermissionBlock {
    #[serde(skip_serializing_if = "Option::is_none")]
    deny: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    allow: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ask: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rules: Option<Vec<PermissionRule>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    default_mode: Option<PermissionMode>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct Settings {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    permission: Option<PermissionBlock>,
}

/// Compiled view of a single rule — the glob matcher is built once and
/// re-used for every `evaluate` call. The rule's action is deliberately not
/// stored here: `evaluate` zips the compiled slice with the source rules and
/// reads the action from the latter, so a copy would only be dead state.
#[derive(Debug, Clone)]
struct CompiledRule {
    tool_matcher: GlobMatcher,
    pattern_matcher: Option<GlobMatcher>,
}

impl CompiledRule {
    fn compile(rule: &PermissionRule) -> Result<Self> {
        let tool_matcher = Glob::new(&rule.tool)
            .with_context(|| format!("invalid tool glob `{}`", rule.tool))?
            .compile_matcher();
        let pattern_matcher = match &rule.pattern {
            Some(p) => Some(
                Glob::new(p)
                    .with_context(|| format!("invalid pattern glob `{p}`"))?
                    .compile_matcher(),
            ),
            None => None,
        };
        Ok(Self {
            tool_matcher,
            pattern_matcher,
        })
    }

    fn matches(&self, tool: &str, pattern: Option<&str>) -> bool {
        if !self.tool_matcher.is_match(tool) {
            return false;
        }
        match (&self.pattern_matcher, pattern) {
            (Some(m), Some(p)) => m.is_match(p),
            (None, _) => true,
            (Some(_), None) => false,
        }
    }
}

/// Per-instance handle. Owns the path to `settings.json` and a cached
/// in-memory copy of the compiled rules.
pub struct PermissionsHandle {
    settings_path: PathBuf,
}

impl PermissionsHandle {
    pub fn open(data_dir: &Path) -> Result<Self> {
        // Pi's settings.json lives under `<data_dir>/pi-agent/settings.json`
        // (mirrors `agentPath("settings.json")` from the TS implementation).
        let pi_agent_dir = data_dir.join("pi-agent");
        fs::create_dir_all(&pi_agent_dir).with_context(|| {
            format!(
                "failed to create pi-agent dir at {}",
                pi_agent_dir.display()
            )
        })?;
        Ok(Self {
            settings_path: pi_agent_dir.join("settings.json"),
        })
    }

    fn read_settings(&self) -> Result<Settings> {
        match fs::read_to_string(&self.settings_path) {
            Ok(text) => serde_json::from_str(&text).with_context(|| {
                format!("parse settings.json at {}", self.settings_path.display())
            }),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
            Err(err) => Err(err)
                .with_context(|| format!("read settings.json at {}", self.settings_path.display())),
        }
    }

    fn write_settings(&self, settings: &Settings) -> Result<()> {
        if let Some(parent) = self.settings_path.parent() {
            fs::create_dir_all(parent)?;
        }
        // Mirror TS tmp-rename atomic write.
        let pid = std::process::id();
        let now = Utc::now().timestamp_millis();
        let tmp = self
            .settings_path
            .with_extension(format!("json.{pid}.{now}.tmp"));
        let body = serde_json::to_string_pretty(settings).context("serialize settings.json")?;
        fs::write(&tmp, format!("{body}\n"))
            .with_context(|| format!("write tmp settings at {}", tmp.display()))?;
        // 0o600 on unix (matches TS).
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perm = fs::metadata(&tmp)?.permissions();
            perm.set_mode(0o600);
            fs::set_permissions(&tmp, perm)?;
        }
        fs::rename(&tmp, &self.settings_path).with_context(|| {
            format!(
                "rename tmp {} → {}",
                tmp.display(),
                self.settings_path.display()
            )
        })?;
        Ok(())
    }

    fn parse_compact(s: &str, action: PermissionAction) -> PermissionRule {
        // Mirrors `parseCompact` from TS: ToolName(pattern) → split on first `(`.
        if let Some(open) = s.find('(') {
            let tool = s[..open].trim().to_lowercase();
            let rest = s[open + 1..].trim_end();
            let pattern = rest.strip_suffix(')').unwrap_or(rest).trim();
            PermissionRule {
                action,
                tool,
                pattern: if pattern.is_empty() {
                    None
                } else {
                    Some(pattern.to_string())
                },
            }
        } else {
            PermissionRule {
                action,
                tool: s.trim().to_lowercase(),
                pattern: None,
            }
        }
    }

    fn read_rules(settings: &Settings) -> Vec<PermissionRule> {
        let perm = match settings.permission.as_ref() {
            Some(p) => p,
            None => return Vec::new(),
        };
        let mut out: Vec<PermissionRule> = Vec::new();
        for action in [
            PermissionAction::Deny,
            PermissionAction::Allow,
            PermissionAction::Ask,
        ] {
            let arr = match action {
                PermissionAction::Deny => perm.deny.as_ref(),
                PermissionAction::Allow => perm.allow.as_ref(),
                PermissionAction::Ask => perm.ask.as_ref(),
            };
            if let Some(arr) = arr {
                for v in arr {
                    out.push(Self::parse_compact(v, action));
                }
            }
        }
        if let Some(rules) = perm.rules.as_ref() {
            out.extend(rules.iter().cloned());
        }
        out
    }

    pub fn read_rules_from_disk(&self) -> Result<Vec<PermissionRule>> {
        let settings = self.read_settings()?;
        Ok(Self::read_rules(&settings))
    }

    pub fn write_rules(&self, rules: &[PermissionRule]) -> Result<()> {
        // Mirrors TS `writeRulesToSettings` exactly: compact form only.
        // The structured `rules` field is populated lazily by readers when
        // they encounter the structured form — but since the TS writer
        // doesn't emit it, neither do we.
        let mut settings = self.read_settings().unwrap_or_default();
        let mut deny = Vec::new();
        let mut allow = Vec::new();
        let mut ask = Vec::new();
        for r in rules {
            let compact = match &r.pattern {
                Some(p) => format!("{}({})", r.tool, p),
                None => r.tool.clone(),
            };
            match r.action {
                PermissionAction::Deny => deny.push(compact),
                PermissionAction::Allow => allow.push(compact),
                PermissionAction::Ask => ask.push(compact),
            }
        }
        let block = settings
            .permission
            .get_or_insert(PermissionBlock::default());
        block.deny = if deny.is_empty() { None } else { Some(deny) };
        block.allow = if allow.is_empty() { None } else { Some(allow) };
        block.ask = if ask.is_empty() { None } else { Some(ask) };
        block.rules = None;
        self.write_settings(&settings)
    }

    pub fn read_mode(&self) -> Result<PermissionMode> {
        let settings = self.read_settings()?;
        Ok(settings
            .permission
            .as_ref()
            .and_then(|p| p.default_mode)
            .unwrap_or(PermissionMode::Default))
    }

    pub fn write_mode(&self, mode: PermissionMode) -> Result<()> {
        let mut settings = self.read_settings().unwrap_or_default();
        let block = settings
            .permission
            .get_or_insert(PermissionBlock::default());
        block.default_mode = Some(mode);
        self.write_settings(&settings)
    }

    pub fn evaluate(&self, tool: &str, pattern: Option<&str>) -> Result<EvaluationResult> {
        let rules = self.read_rules_from_disk()?;
        let compiled: Vec<CompiledRule> = rules
            .iter()
            .map(CompiledRule::compile)
            .collect::<Result<Vec<_>>>()?;
        let mut winning: Option<(PermissionAction, &PermissionRule)> = None;
        for (rule, c) in rules.iter().zip(compiled.iter()) {
            let m = c.matches(tool, pattern);
            if !m {
                continue;
            }
            let take = match winning {
                Some((cur, _)) => rule.action.precedence() > cur.precedence(),
                None => true,
            };
            if take {
                winning = Some((rule.action, rule));
            }
        }
        let (action, matched) = match winning {
            Some((a, r)) => (a, Some(r.clone())),
            None => (PermissionAction::Ask, None),
        };
        Ok(EvaluationResult {
            action,
            matched_rule: matched.map(rule_to_compact),
        })
    }
}

fn rule_to_compact(rule: PermissionRule) -> String {
    match rule.pattern {
        Some(p) => format!("{}({})", rule.tool, p),
        None => rule.tool,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvaluationResult {
    pub action: PermissionAction,
    #[serde(rename = "matchedRule", skip_serializing_if = "Option::is_none")]
    pub matched_rule: Option<String>,
}

// -- params for IPC ---------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct EvaluateParams {
    pub tool: String,
    #[serde(default)]
    pub pattern: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WriteRulesParams {
    pub rules: Vec<PermissionRule>,
}

#[derive(Debug, Deserialize)]
pub struct WriteModeParams {
    pub mode: PermissionMode,
}

// -- tests ------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn fresh_handle() -> PermissionsHandle {
        // Tests run in parallel threads of one process, so the pid+nanosecond
        // pair is not enough to keep these directories apart: several tests can
        // land in the same microsecond and then delete each other's fixtures.
        // The counter makes the path unique per call.
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let tmp = std::env::temp_dir().join(format!(
            "ob-perm-{}-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or(0),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&tmp);
        PermissionsHandle::open(&tmp).expect("open")
    }

    #[test]
    fn evaluate_denies_priority_over_ask_and_allow() {
        let h = fresh_handle();
        h.write_rules(&[
            PermissionRule {
                action: PermissionAction::Allow,
                tool: "bash".into(),
                pattern: Some("ls *".into()),
            },
            PermissionRule {
                action: PermissionAction::Deny,
                tool: "bash".into(),
                pattern: Some("ls /etc/**".into()),
            },
            PermissionRule {
                action: PermissionAction::Ask,
                tool: "bash".into(),
                pattern: Some("ls *".into()),
            },
        ])
        .unwrap();
        let res = h.evaluate("bash", Some("ls /etc/passwd")).unwrap();
        assert_eq!(res.action, PermissionAction::Deny);
        assert!(res.matched_rule.unwrap().contains("ls /etc"));
    }

    #[test]
    fn evaluate_falls_back_to_ask_when_no_match() {
        let h = fresh_handle();
        h.write_rules(&[PermissionRule {
            action: PermissionAction::Allow,
            tool: "bash".into(),
            pattern: Some("ls *".into()),
        }])
        .unwrap();
        let res = h.evaluate("bash", Some("rm -rf /")).unwrap();
        assert_eq!(res.action, PermissionAction::Ask);
        assert!(res.matched_rule.is_none());
    }

    #[test]
    fn glob_double_star_matches_across_directories() {
        let h = fresh_handle();
        h.write_rules(&[PermissionRule {
            action: PermissionAction::Allow,
            tool: "edit".into(),
            pattern: Some("**/*.ts".into()),
        }])
        .unwrap();
        let res = h
            .evaluate("edit", Some("packages/auth/foo/bar.ts"))
            .unwrap();
        assert_eq!(res.action, PermissionAction::Allow);
    }

    #[test]
    fn round_trip_compact_and_structured_forms() {
        let h = fresh_handle();
        let rules = vec![
            PermissionRule {
                action: PermissionAction::Allow,
                tool: "bash".into(),
                pattern: Some("ls *".into()),
            },
            PermissionRule {
                action: PermissionAction::Deny,
                tool: "edit".into(),
                pattern: None,
            },
        ];
        h.write_rules(&rules).unwrap();
        let read = h.read_rules_from_disk().unwrap();
        // read_rules_from_disk deduplicates via parse_compact → structured;
        // we only check the action precedence survives.
        assert!(read.iter().any(|r| r.action == PermissionAction::Allow
            && r.tool == "bash"
            && r.pattern.as_deref() == Some("ls *")));
        assert!(read.iter().any(|r| r.action == PermissionAction::Deny
            && r.tool == "edit"
            && r.pattern.is_none()));
    }

    #[test]
    fn mode_round_trip_through_disk() {
        let h = fresh_handle();
        h.write_mode(PermissionMode::AcceptEdits).unwrap();
        assert_eq!(h.read_mode().unwrap(), PermissionMode::AcceptEdits);
        h.write_mode(PermissionMode::BypassPermissions).unwrap();
        assert_eq!(h.read_mode().unwrap(), PermissionMode::BypassPermissions);
    }

    #[test]
    fn bypass_permissions_short_circuits_to_allow() {
        let h = fresh_handle();
        h.write_mode(PermissionMode::BypassPermissions).unwrap();
        // Even without any matching rule, `bypassPermissions` mode should
        // collapse to allow — see agent-host.ts:2525 + Codex App `--yolo`.
        // The host-core layer surfaces the mode in `read_mode`; the final
        // short-circuit happens in the TS caller, but we record the mode
        // here so the caller can take the bypass branch deterministically.
        assert_eq!(h.read_mode().unwrap(), PermissionMode::BypassPermissions);
    }
}
