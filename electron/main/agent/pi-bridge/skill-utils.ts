/**
 * pi-bridge/skill-utils.ts — thin IPC shim around pi's skills API.
 *
 * Phase A.1 + D.3 of OPENBUDDY_PI_NATIVE_PLAN.md. Renderer can ask the main
 * process to load + format skills, replacing the custom scan in
 * electron/main/agent/host-modules/pi-resource-loader.ts.
 *
 * `loadSkills()` is what pi-codint-agent exposes; we expose two flavours:
 *   - loadSkillsFromDir — single directory scan
 *   - loadSkills — full discovery (cwd + agentDir + skillPaths + defaults)
 */
import {
  loadSkills as piLoadSkills,
  loadSkillsFromDir as piLoadSkillsFromDir,
  formatSkillsForPrompt as piFormatSkillsForPrompt,
  type Skill,
  type LoadSkillsResult,
} from "@earendil-works/pi-coding-agent";
import { piHome } from "../host-modules/_host-paths";

/** Default OpenBuddy / agent config dir (matches `piHome()` from _host-paths). */
function defaultAgentDir(): string {
  return piHome();
}

export type { Skill, LoadSkillsResult };

/** Load skills from a single directory. */
export async function loadSkillsFromDir(options: { dir: string; source: string }): Promise<LoadSkillsResult> {
  return piLoadSkillsFromDir(options);
}

/**
 * Load skills from all configured locations.
 *
 * Default: scans `cwd` + `agentDir` + no explicit paths + includeDefaults=true
 * (matches OpenBuddy's current behavior where user skill dirs under
 * `~/.config/openbuddy/skills/` are auto-loaded).
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

/** Format loaded skills into the standard system-prompt XML block. */
export function formatSkillsForPrompt(skills: Skill[], fileReadTool: "read" | "bash" = "read"): string {
  return piFormatSkillsForPrompt(skills, fileReadTool);
}