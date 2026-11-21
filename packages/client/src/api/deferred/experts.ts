// The experts_* commands are implemented (20261116-pii W2.3, host module `experts`); the typed wrappers
// moved to `api/experts.ts`. Re-exported here so existing importers of this path keep working.
export {
  expertsDefaultRoot,
  expertsListRoots,
  expertsSetRoots,
  expertsLoad,
  expertsThumbnail,
  expertsImageBytes,
  expertsReadAgentPrompt,
  expertsLinkAgents,
} from "../experts";
