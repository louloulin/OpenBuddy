// Deferred (20261115-md Appendix B, 助理 / 子代理): agents_*, agent_set/clear_session_expert, subagents_config_*.
// Not in the protocol COMMANDS list.
import type { AgentEntry } from "@openbuddy/protocol/dto";
import { invoke } from "../../ipc";

/** Bind an expert to a session (OpenBuddy-only state). */
export async function agentSetSessionExpert(
  sessionId: string,
  expertId: string,
  expertName: string,
  source: string,
  avatarLocal?: string,
): Promise<boolean> {
  return invoke<boolean>("agent_set_session_expert", { sessionId, expertId, expertName, source, avatarLocal: avatarLocal ?? null });
}

/** Remove the expert binding from a session. */
export async function agentClearSessionExpert(sessionId: string): Promise<boolean> {
  return invoke<boolean>("agent_clear_session_expert", { sessionId });
}

/** List all agent definitions visible to OpenBuddy. */
export async function agentsList(cwd?: string): Promise<AgentEntry[]> {
  return invoke<AgentEntry[]>("agents_list", { cwd: cwd ?? null });
}

/** Fetch a single agent file's full contents. */
export async function agentsGet(path: string): Promise<string> {
  return invoke<string>("agents_get", { path });
}


export async function agentsSave(name: string, raw: string): Promise<AgentEntry> {
  return invoke<AgentEntry>("agents_save", { name, raw });
}

/** Delete an agent file by path. */
export async function agentsDelete(path: string): Promise<void> {
  await invoke<void>("agents_delete", { path });
}

/** Render a starter agent markdown body from name/description/system prompt.
 *  Optional avatar (1-20) and modelTags are written to frontmatter. */
export async function agentsTemplate(
  name: string,
  description: string,
  systemPrompt: string,
  avatar?: number,
  modelTags?: string[],
): Promise<string> {
  return invoke<string>("agents_template", {
    name,
    description,
    systemPrompt,
    avatar: avatar ?? null,
    modelTags: modelTags ?? null,
  });
}

/** `[subagents]` config — currently exposes `max_depth` (nesting depth). */
export interface SubagentsConfig {
  
  maxDepth: number;
}

/** Read `[subagents].max_depth`. Returns 1 when unset. */
export async function subagentsConfigGet(): Promise<SubagentsConfig> {
  return invoke<SubagentsConfig>("subagents_config_get");
}

/** Write `[subagents].max_depth` (clamped ≥1). Requires agent restart. */
export async function subagentsConfigSave(maxDepth: number): Promise<number> {
  return invoke<number>("subagents_config_save", { maxDepth });
}
