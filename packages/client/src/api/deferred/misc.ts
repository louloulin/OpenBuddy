// Deferred (20261115-md Appendix B, 其他): session_fork, prompt_history, toggle_plan_mode, internal_reload,
// inspiration_generate, web_search_config_get / save. Not in the protocol COMMANDS list.
// session_search is implemented (pii W1.4); its wrapper moved to ../session.ts with the same name and arguments.
import type { InspirationStarted } from "@openbuddy/protocol/dto";
import { invoke } from "../../ipc";

// ---------- session fork ----------

/** Fork a session: copy history to a new session id. Returns the new id. */
export async function sessionFork(sessionId: string, cwd?: string): Promise<string> {
  return invoke<string>("session_fork", { sessionId, cwd: cwd ?? null });
}

// ---------- slash commands + prompt history ----------

/** Cross-session prompt history. */
export async function promptHistory(limit?: number): Promise<string[]> {
  return invoke<string[]>("prompt_history", { limit: limit ?? null });
}

// ---------- plan mode ----------


export async function togglePlanMode(sessionId: string, enabled: boolean): Promise<void> {
  await invoke<void>("toggle_plan_mode", { sessionId, enabled });
}

// ---------- internal reload ----------


export async function internalReload(kind: "mcp_all" | "mcp_project" | "skills" | "models"): Promise<void> {
  await invoke<void>("internal_reload", { kind });
}

// ---------- inspiration (灵感面板) ----------


export async function inspirationGenerate(
  category: string,
  cwd?: string,
  count?: number,
): Promise<InspirationStarted> {
  return invoke<InspirationStarted>("inspiration_generate", {
    request: { category, cwd: cwd ?? null, count: count ?? null },
  });
}

/** `[models].web_search` config — derived enabled flag + model id. */
export interface WebSearchConfig {
  /** true when a web_search model is set. */
  enabled: boolean;
  /** Configured web_search model id (empty = none). */
  model: string;
}

/** Read the web_search model. `enabled` is derived from whether a model is set. */
export async function webSearchConfigGet(): Promise<WebSearchConfig> {
  return invoke<WebSearchConfig>("web_search_config_get");
}

/** Enable/disable web search by setting/clearing `[models].web_search`.
 *  When enabling, `model` must be a non-empty model id. Requires agent restart. */
export async function webSearchConfigSave(
  enable: boolean,
  model?: string,
): Promise<boolean> {
  return invoke<boolean>("web_search_config_save", { enable, model });
}
