// ---------- skills (x.ai/skills) ----------
// Split out of dto.ts (B1c) so the shared DTO file stays inside its boundary size budget.

export interface SkillInfo {
  name: string;
  displayName?: string;
  description?: string;
  /** Where the skill was discovered: "local" | "repo" | "user" | "server" | "bundled" | "plugin". */
  scope?: string;
  enabled: boolean;
  userInvocable?: boolean;
  /** Filesystem path to the skill directory (when available). */
  path?: string;
  /** Frontmatter version (B1c: the installed view shows it). */
  version?: string;
  /** Copied into `<pi>/skills` by 技能市场 (B1c): batch switches and removal own these files. */
  market?: boolean;
}

/** `skills_install_from_catalog` (B1c): one copied skill or one directory that failed. */
export interface SkillInstallation {
  name: string;
  path: string;
  /** True when the skill was already installed and nothing was copied. */
  already: boolean;
  version?: string;
}

export interface SkillInstallResult {
  installed: SkillInstallation[];
  failed: Array<{ dir: string; error: string }>;
}

/** `skills_export_zip` (B1c): the archive written to the user's chosen target. */
export interface SkillExportResult {
  path: string;
  bytes: number;
  files: string[];
}
