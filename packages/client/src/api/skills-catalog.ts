// 技能目录 (20261116-pii W2.7): skills_catalog_default_root / list_roots / load / read_skill.
import type { SkillCatalog } from "@openbuddy/protocol/dto";
import { invoke } from "../ipc";

export type { SkillCatalog };

/** First existing agents data root ("" if none found). */
export async function skillsCatalogDefaultRoot(): Promise<string> {
  return invoke<string>("skills_catalog_default_root");
}

/** Agents roots under `root` that look scannable. */
export async function skillsCatalogListRoots(root: string): Promise<string[]> {
  return invoke<string[]>("skills_catalog_list_roots", { root });
}

/** Scan both sources and return the merged, deduped skill catalog. */
export async function skillsCatalogLoad(root?: string, builtinRoot?: string): Promise<SkillCatalog> {
  return invoke<SkillCatalog>("skills_catalog_load", { root: root ?? null, builtinRoot: builtinRoot ?? null });
}

/** Read the full SKILL.md text for a directory. */
export async function skillsCatalogReadSkill(dir: string): Promise<string> {
  return invoke<string>("skills_catalog_read_skill", { dir });
}
