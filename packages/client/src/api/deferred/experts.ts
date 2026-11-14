// Deferred (20261115-md Appendix B, 专家): experts_* commands. Not in the protocol COMMANDS list.
import type { ExpertCatalog } from "@openbuddy/protocol/dto";
import { invoke } from "../../ipc";

// ---------- expert marketplace (live local data dir) ----------

/** First existing candidate data root ("" if none found). */
export async function expertsDefaultRoot(): Promise<string> {
  return invoke<string>("experts_default_root");
}

/** Data roots under `root` that contain the marketplace manifest. */
export async function expertsListRoots(root: string): Promise<string[]> {
  return invoke<string[]>("experts_list_roots", { root });
}

/** Load categories + experts by merging the manifest with each plugin.json. */
export async function expertsLoad(root?: string): Promise<ExpertCatalog> {
  return invoke<ExpertCatalog>("experts_load", { root: root ?? null });
}

/** Small base64 JPEG thumbnail for a local avatar path (cached server-side). */
export async function expertsThumbnail(path: string): Promise<string> {
  return invoke<string>("experts_thumbnail", { path });
}

/** Full-size local image as a `data:` URL (used for 精选场景 banners). */
export async function expertsImageBytes(path: string): Promise<string> {
  return invoke<string>("experts_image_bytes", { path });
}

/** Read the full agent prompt markdown from an expert's package directory. */
export async function expertsReadAgentPrompt(
  root: string,
  plugin: string,
  agentName: string,
): Promise<string> {
  return invoke<string>("experts_read_agent_prompt", { root, plugin, agentName });
}


export async function expertsLinkAgents(root: string, plugin: string): Promise<number> {
  return invoke<number>("experts_link_agents", { root, plugin });
}
