// Deferred (20261115-md Appendix B, 子代理): subagents_config_* are not in the protocol COMMANDS list yet.
import { invoke } from "../../ipc";

// agents_* and agent_set/clear_session_expert are implemented (20261116-pii W2.1–W2.2, host module
// `experts`); their wrappers moved to `api/experts.ts` and are re-exported for existing importers.
export { agentSetSessionExpert, agentClearSessionExpert, agentsList, agentsGet, agentsSave, agentsDelete, agentsTemplate } from "../experts";

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
