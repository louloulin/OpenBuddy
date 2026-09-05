import type { PluginEntryOptions, PluginProfile } from "@openbuddy/plugin-host";

export {
  openBuddyCapabilityPlugins,
  openBuddyCapabilityPluginIndex,
} from "./capability-plugins";
export {
  openBuddyRendererPluginIndex,
  rendererComposerPlugin,
  rendererSidebarPlugin,
} from "./renderer-plugins";
export {
  openBuddyAssistantContributionPluginIndex,
  rendererAssistantCrossOrgDeliveriesPlugin,
  rendererAssistantResearchBuddyPlugin,
  rendererAssistantTeamWorkflowPlugin,
} from "./renderer-assistant-contributions";
export {
  openBuddyRendererContributionPluginIndex,
  rendererProjectCrossOrgDeliveriesPlugin,
  rendererProjectWorkflowBlackboardPlugin,
  rendererMessageDelegateToBuddyPlugin,
  rendererSettingsCollaborationPlugin,
  rendererCommandBuddyProposePlugin,
  rendererCommandFederatedGrantPlugin,
} from "./renderer-contributions";
export { openBuddyDeepSeekRendererEntries } from "./renderer";

import type { RendererPluginProfile } from "@openbuddy/renderer-host";

export const openBuddyBaseEntries: readonly PluginEntryOptions[] = [
  { id: "openbuddy-core", name: "openbuddy:core" },
];

/** Every per-capability plugin as a profile entry, in dependency-respecting order. */
export const openBuddyCapabilityEntries: readonly PluginEntryOptions[] = [
  { id: "openbuddy-session", name: "openbuddy-session" },
  { id: "openbuddy-authorization", name: "openbuddy-authorization", inject: ["agentHost"] },
  { id: "openbuddy-mcp-client", name: "openbuddy-mcp-client", inject: ["openbuddy-authorization", "agentHost", "mcpResources", "pi"] },
  { id: "openbuddy-email", name: "openbuddy-email", inject: ["openbuddy-mcp-client", "agentHost", "pi"] },
  { id: "openbuddy-permission", name: "openbuddy-permission" },
  // Stage C-4: openbuddy-memory removed; capability-plugin noop stub keeps
  // the entry id for downstream tooling while `pi-memory` (upstream) owns
  // real memory traffic via pi-extensions passthrough.
  { id: "openbuddy-memory", name: "openbuddy-memory" },
  // Stage G-1c: openbuddy-automation removed; automation is owned by
  // pi-background-tasks + pi-goal (passthrough).
  { id: "openbuddy-calendar", name: "openbuddy-calendar" },
  { id: "openbuddy-fs-local", name: "openbuddy-fs-local" },
  { id: "openbuddy-team", name: "openbuddy-team" },
  { id: "openbuddy-collaboration", name: "openbuddy-collaboration", inject: ["agentHost", "collaborationRuntimeBridge"] },
];

export const openBuddyPluginApiVersion = "1" as const;

export const openBuddyRendererEntries: RendererPluginProfile["entries"] = [
  { id: "openbuddy-renderer-sidebar", name: "openbuddy-renderer-sidebar" },
  { id: "openbuddy-renderer-composer", name: "openbuddy-renderer-composer" },
  { id: "openbuddy-assistant-cross-org-deliveries", name: "openbuddy-assistant-cross-org-deliveries" },
  { id: "openbuddy-assistant-research-buddy", name: "openbuddy-assistant-research-buddy" },
  { id: "openbuddy-assistant-team-workflow", name: "openbuddy-assistant-team-workflow" },
  { id: "openbuddy-project-cross-org-deliveries", name: "openbuddy-project-cross-org-deliveries" },
  { id: "openbuddy-project-workflow-blackboard", name: "openbuddy-project-workflow-blackboard" },
  { id: "openbuddy-message-delegate-to-buddy", name: "openbuddy-message-delegate-to-buddy" },
  { id: "openbuddy-settings-collaboration", name: "openbuddy-settings-collaboration" },
  { id: "openbuddy-command-buddy-propose", name: "openbuddy-command-buddy-propose" },
  { id: "openbuddy-command-federated-grant", name: "openbuddy-command-federated-grant" },
];

export function createOpenBuddyRendererProfile(
  entries: RendererPluginProfile["entries"] = openBuddyRendererEntries,
  patches: NonNullable<RendererPluginProfile["patches"]> = [],
): RendererPluginProfile {
  return { entries: [...entries], patches };
}

export function createOpenBuddyProfile(
  entries: readonly PluginEntryOptions[] = openBuddyCapabilityEntries,
  patches: readonly import("@openbuddy/plugin-host").PluginPatch[][] = [],
): PluginProfile {
  return { entries: [...entries], patches };
}

/** Legacy profile that bundles all capabilities into a single `openbuddy-core` entry. */
export function createOpenBuddyCoreProfile(): PluginProfile {
  return { entries: [...openBuddyBaseEntries], patches: [] };
}
