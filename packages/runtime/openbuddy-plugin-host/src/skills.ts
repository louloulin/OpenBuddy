/**
 * @openbuddy/plugin-host/skills — Skills loading helpers.
 *
 * Phase D.3 of docs/OPENBUDDY_PI_NATIVE_PLAN.md (v3 §D.3):
 *   Replaces the custom skill scanning in
 *   `electron/main/agent/host-modules/pi-resource-loader.ts` with a
 *   thin wrapper around PI's `loadSkills` + `loadSkillsFromDir` +
 *   `formatSkillsForPrompt`. Renderer / main process call this
 *   helper instead of running their own filesystem scans.
 *
 * Why a plugin-host wrapper (instead of importing pi directly):
 *   - Centralises the cwd/agentDir defaults in one place so callers
 *     don't drift apart.
 *   - Adds a `formatForAgentPrompt(skills, ...)` alias so the
 *     caller doesn't need to know the `fileReadTool` parameter name.
 *   - Future D.3 round 2 (renderer wiring) can mock this module
 *     instead of mocking the pi-coding-agent directly.
 *
 * Reverse-dep invariant:
 *   imports nothing from electron/main/.
 */

import {
  loadSkills as piLoadSkills,
  loadSkillsFromDir as piLoadSkillsFromDir,
  formatSkillsForPrompt as piFormatSkillsForPrompt,
  type Skill,
  type LoadSkillsResult,
} from "@earendil-works/pi-coding-agent";

/**
 * Default OpenBuddy agent dir.
 *
 * We compute this inline (vs importing `piHome` from
 * `electron/main/agent/host-modules/_host-paths`) because the
 * plugin-host package has no cross-package dependency on the electron
 * main-process internals. `piHome()` returns the user-configured
 * `PI_CODING_AGENT_DIR` env var (or the default `~/.pi/agent`).
 */
function defaultAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? `${process.env.HOME ?? "/root"}/.pi/agent`;
}

export type { Skill, LoadSkillsResult };

/** Load skills from a single directory (e.g. a user-installed skill). */
export async function loadSkillsFromDir(options: {
  dir: string;
  source: string;
}): Promise<LoadSkillsResult> {
  return piLoadSkillsFromDir(options);
}

/**
 * Load skills from all configured locations.
 *
 * Default cwd is `process.cwd()`; default agentDir is the user
 * agent dir; default `includeDefaults` is `true` so the user
 * skill dirs under `~/.config/openbuddy/skills/` are auto-loaded.
 */
export async function loadSkills(options?: {
  cwd?: string;
  agentDir?: string;
  skillPaths?: string[];
  includeDefaults?: boolean;
}): Promise<LoadSkillsResult> {
  return piLoadSkills({
    cwd: options?.cwd ?? process.cwd(),
    agentDir: options?.agentDir ?? defaultAgentDir(),
    skillPaths: options?.skillPaths ?? [],
    includeDefaults: options?.includeDefaults ?? true,
  });
}

/** Alias around `formatSkillsForPrompt` that hides the pi-internal
 *  parameter name. Renderer / main process call this without
 *  importing `@earendil-works/pi-coding-agent` directly. */
export function formatForAgentPrompt(
  skills: Skill[],
  fileReadTool: "read" | "bash" = "read",
): string {
  return piFormatSkillsForPrompt(skills, fileReadTool);
}
