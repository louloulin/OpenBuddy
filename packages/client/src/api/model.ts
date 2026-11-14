// §5.3 `model` module: agent_set_model, agent_get_model_state, agent_set_thinking_level, agents_defaults_get, agents_defaults_save.
import type { AgentDefaults, ModelState } from "@openbuddy/protocol/dto";
import { invoke } from "../ipc";

export async function agentSetModel(sessionId: string, modelId: string, providerId?: string): Promise<ModelState> {
  return invoke<ModelState>("agent_set_model", { sessionId, modelId, providerId });
}

export const agentGetModelState = (sessionId: string) => invoke<ModelState>("agent_get_model_state", { sessionId });
export const agentSetThinkingLevel = (sessionId: string, level: string) => invoke<ModelState>("agent_set_thinking_level", { sessionId, level });

/** Read the new-session defaults (model + permission + remember-tool-approvals). */
export async function agentsDefaultsGet(): Promise<AgentDefaults> {
  return invoke<AgentDefaults>("agents_defaults_get");
}

/** Save the new-session defaults. Atomic write to config.toml. */
export async function agentsDefaultsSave(defaults: AgentDefaults): Promise<void> {
  await invoke<void>("agents_defaults_save", { defaults });
}
