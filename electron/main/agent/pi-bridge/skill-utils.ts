/**
 * pi-bridge/skill-utils.ts — IPC shim for Pi-native skills.
 *
 * Discovery is owned by @openbuddy/plugin-host so Electron does not maintain
 * a second Pi integration or duplicate agent-directory defaults.
 */
import {
  formatForAgentPrompt,
  loadSkills,
  loadSkillsFromDir,
  type Skill,
  type LoadSkillsResult,
} from "@openbuddy/plugin-host";

export type { Skill, LoadSkillsResult };
export { loadSkills, loadSkillsFromDir };

/** Format loaded skills into Pi's standard system-prompt XML block. */
export function formatSkillsForPrompt(skills: Skill[], fileReadTool: "read" | "bash" = "read"): string {
  return formatForAgentPrompt(skills, fileReadTool);
}
