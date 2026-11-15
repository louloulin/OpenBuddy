import type { FeatureEntry } from "./registry";

/**
 * Registry entries without a nav item or route of their own: capabilities used inside other
 * surfaces (tabs of 专家·技能·连接器, the palette's 内容 group, the plan panel). Kept apart from
 * features.tsx so those surfaces can read them without importing every panel.
 */
export const CAPABILITY_FEATURES = [
  { id: "experts-mine", requires: ["agents_list"] },
  { id: "experts-catalog", requires: ["experts_load"] },
  { id: "skills-catalog", requires: ["skills_catalog_load"] },
  { id: "connectors-catalog", requires: ["connectors_load"] },
  { id: "prompts-manage", requires: ["prompts_list"] },
  { id: "session-search", requires: ["session_search"] },
  { id: "plan-panel", requires: [], requiresEvents: ["agent://plan"] },
] as const satisfies readonly FeatureEntry[];

export type CapabilityFeatureId = (typeof CAPABILITY_FEATURES)[number]["id"];

export const capabilityFeature = (id: CapabilityFeatureId): FeatureEntry =>
  CAPABILITY_FEATURES.find((entry) => entry.id === id) as FeatureEntry;
