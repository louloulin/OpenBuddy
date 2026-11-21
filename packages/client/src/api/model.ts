// §5.3 `model` module: agent_set_model, agent_get_model_state, agent_set_thinking_level, agents_defaults_get, agents_defaults_save,
// settings_agent_get / settings_agent_set, agent_cycle_model (20261116-pii W0.4 / W1.6).
import type { AgentDefaults, ModelState } from "@openbuddy/protocol/dto";
import type { AgentSettings, AgentSettingsPatch, ModelCycleResult } from "@openbuddy/protocol/agent-settings";
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

/** 设置 · 智能体: compaction, retry, queue delivery, cache warming, favourite models, built-ins (pi-settings.json). */
export const settingsAgentGet = () => invoke<AgentSettings>("settings_agent_get");
/** Save only the changed fields; open sessions follow at once. Returns the saved settings. */
export const settingsAgentSet = (patch: AgentSettingsPatch) => invoke<AgentSettings>("settings_agent_set", { patch });
/** Ctrl/Cmd+P: the next favourite model in this session (Pi's cycleModel over the favourites). */
export const agentCycleModel = (sessionId: string, direction?: "forward" | "backward") =>
  invoke<ModelCycleResult>("agent_cycle_model", { sessionId, ...(direction ? { direction } : {}) });
