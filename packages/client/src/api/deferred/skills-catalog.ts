// The skills_catalog_* commands are implemented (20261116-pii W2.7, host module `skills`); the typed
// wrappers moved to `api/skills-catalog.ts`. Re-exported here so existing importers keep working.
export {
  skillsCatalogDefaultRoot,
  skillsCatalogListRoots,
  skillsCatalogLoad,
  skillsCatalogReadSkill,
} from "../skills-catalog";
