// `experts` module (20261116-pii W2.1–W2.3): agents_list / get / save / delete / template,
// agent_set_session_expert / agent_clear_session_expert, experts_default_root / list_roots / set_roots /
// load / read_agent_prompt / thumbnail / image_bytes / link_agents.
// The names the renderer used before (agentsList, expertsThumbnail …) keep their call shapes;
// `api/deferred/{experts,assistants}.ts` re-export them from here.
import type {
  ExpertCenterCatalog,
  ExpertDraft,
  ExpertEntry,
  ExpertRootInfo,
  SessionExpertInfo,
  WorkBuddyImportResult,
} from "@openbuddy/protocol/experts";
import type { TeamTemplate } from "@openbuddy/protocol/teams";
import { invoke } from "../ipc";

export type { ExpertCenterCatalog, ExpertDraft, ExpertEntry, ExpertRootInfo, SessionExpertInfo };

// ---------- 我的专家 (the store) ----------

/** 我的专家: the user's own experts, then the trusted project's (`<cwd>/.pi/agents`). */
export async function agentsList(cwd?: string): Promise<ExpertEntry[]> {
  return invoke<ExpertEntry[]>("agents_list", { cwd: cwd ?? null });
}

/** One expert by id (any source, user first). */
export async function agentsGet(id: string, cwd?: string): Promise<ExpertEntry> {
  return invoke<ExpertEntry>("agents_get", { id, cwd: cwd ?? null });
}

/**
 * Save an expert. `create` picks a fresh id (never overwrites); `update` rewrites the user's
 * expert `draft.id`. The legacy `(name, raw)` form writes a raw Markdown file.
 */
export async function agentsSave(draft: ExpertDraft, mode?: "create" | "update"): Promise<ExpertEntry>;
export async function agentsSave(name: string, raw: string): Promise<ExpertEntry>;
export async function agentsSave(draftOrName: ExpertDraft | string, modeOrRaw?: string): Promise<ExpertEntry> {
  if (typeof draftOrName === "string") return invoke<ExpertEntry>("agents_save", { name: draftOrName, raw: modeOrRaw ?? "" });
  return invoke<ExpertEntry>("agents_save", { expert: draftOrName, mode: modeOrRaw ?? (draftOrName.id ? "update" : "create") });
}

/** Delete one of the user's experts (by id; a legacy absolute path inside the user directory also works). */
export async function agentsDelete(idOrPath: string): Promise<void> {
  await invoke<void>("agents_delete", /[\\/]/.test(idOrPath) ? { path: idOrPath } : { id: idOrPath });
}

/** Render the Markdown a draft saves as. The legacy positional form builds a draft from name / description / prompt. */
export async function agentsTemplate(draft: ExpertDraft): Promise<string>;
export async function agentsTemplate(name: string, description: string, systemPrompt: string, avatar?: number, modelTags?: string[]): Promise<string>;
export async function agentsTemplate(draftOrName: ExpertDraft | string, description?: string, systemPrompt?: string, ..._legacy: unknown[]): Promise<string> {
  if (typeof draftOrName === "string") return invoke<string>("agents_template", { name: draftOrName, description: description ?? "", systemPrompt: systemPrompt ?? "" });
  return invoke<string>("agents_template", { expert: draftOrName });
}

// ---------- session binding ----------

/** Bind an expert to a session: persona, model, thinking level and tools apply from the next turn. */
export async function agentSetSessionExpert(sessionId: string, expertId: string): Promise<SessionExpertInfo> {
  return invoke<SessionExpertInfo>("agent_set_session_expert", { sessionId, expertId });
}

/** Unbind; returns false when nothing was bound. */
export async function agentClearSessionExpert(sessionId: string): Promise<boolean> {
  return invoke<boolean>("agent_clear_session_expert", { sessionId });
}

// ---------- 专家中心 (catalog + library directories) ----------

/** The user's experts directory (`<pi>/agents`), created if missing. */
export async function expertsDefaultRoot(): Promise<string> {
  return invoke<string>("experts_default_root");
}

/** Library directories the user added. */
export async function expertsListRoots(): Promise<ExpertRootInfo[]> {
  return invoke<ExpertRootInfo[]>("experts_list_roots");
}

/** Replace the library directory list. */
export async function expertsSetRoots(roots: string[]): Promise<ExpertRootInfo[]> {
  return invoke<ExpertRootInfo[]>("experts_set_roots", { roots });
}

/** Built-in + user + library + trusted project experts, categories and featured scenes. */
export async function expertsLoad(cwd?: string): Promise<ExpertCenterCatalog> {
  return invoke<ExpertCenterCatalog>("experts_load", { cwd: cwd ?? null });
}

/** The expert's full Markdown (front matter + persona). */
export async function expertsReadAgentPrompt(id: string, cwd?: string): Promise<string> {
  return invoke<string>("experts_read_agent_prompt", { id, cwd: cwd ?? null });
}

/** Base64 bytes of an avatar image inside an expert directory. */
export async function expertsThumbnail(path: string): Promise<string> {
  return invoke<string>("experts_thumbnail", { path });
}

/** A `data:` URL for an image inside an expert directory. */
export async function expertsImageBytes(path: string): Promise<string> {
  return invoke<string>("experts_image_bytes", { path });
}

/** Copy experts from a library directory into 我的专家 (new or newer files only); returns how many. */
export async function expertsLinkAgents(root: string, ids?: string[]): Promise<number> {
  return invoke<number>("experts_link_agents", { root, ids: ids ?? null });
}

/** Import a WorkBuddy expert package (ZIP or extracted folder) into 我的专家 (S18). */
export async function expertsImportWorkbuddy(path: string): Promise<WorkBuddyImportResult> {
  return invoke<WorkBuddyImportResult>("experts_import_workbuddy", { path });
}

/** Open an experts directory in the system file manager (the `files` module's `open_path`). */
export async function expertsOpenDir(path: string): Promise<void> {
  await invoke<void>("open_path", { path });
}

// ---------- 专家团 (pii W3.5) ----------

/** Built-in team pipelines, with whether each is already in 我的指令. */
export async function teamsList(): Promise<TeamTemplate[]> {
  return invoke<TeamTemplate[]>("teams_list");
}

/** Install one team as a global 我的指令 prompt template (`/team-...`). */
export async function teamsInstall(id: string): Promise<TeamTemplate> {
  return invoke<TeamTemplate>("teams_install", { id });
}
