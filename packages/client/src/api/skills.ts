// §5.3 `skills` module: skills_list / add / remove / toggle, commands_list.
import type { SkillInfo, SlashCommand } from "@openbuddy/protocol/dto";
import { invoke } from "../ipc";

// ---------- skills (x.ai/skills
export async function skillsList(cwd?: string): Promise<SkillInfo[]> {
  return invoke<SkillInfo[]>("skills_list", { cwd: cwd ?? null });
}

/** Add a skill path (directory or file) to `[skills].paths` and rescan. */
export async function skillsAdd(path: string, cwd?: string): Promise<void> {
  await invoke<void>("skills_add", { path, cwd: cwd ?? null });
}

/** Remove a skill path from `[skills].paths`. */
export async function skillsRemove(path: string, cwd?: string): Promise<void> {
  await invoke<void>("skills_remove", { path, cwd: cwd ?? null });
}

/** Enable or disable a skill by name (writes `[skills] disabled`). */
export async function skillsToggle(name: string, enabled: boolean): Promise<void> {
  await invoke<void>("skills_toggle", { name, enabled });
}

// ---------- slash commands + prompt history ----------

/** List slash commands (builtin + skills + plugins). Powers "/" autocomplete. */
export async function commandsList(): Promise<SlashCommand[]> {
  return invoke<SlashCommand[]>("commands_list");
}
