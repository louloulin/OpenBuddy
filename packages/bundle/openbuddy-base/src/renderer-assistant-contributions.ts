/**
 * Renderer-side Assistant Contributions for the multi-agent collaboration UI.
 *
 * Each entry exports a RendererPlugin whose apply registers an
 * "assistant"-kind contribution on the rendererContributions registry.
 * The Assistant Workbench's AssistantTopTabs consumes the registry and
 * renders each contribution as a top-tab inside the "更多" popover, so any
 * downstream plugin or feature pack can ship its own collaborative surface
 * without forking the base renderer.
 *
 * The contributions are intentionally declarative — the live UI is rendered
 * by AssistantExtensionPanel in src/components/AssistantWorkspacePanel.tsx,
 * which is wired into PlaceholderPage and reads every plugin contribution
 * from the same registry. The contract stays versioned via
 * @openbuddy/renderer-host.
 */
import type { Context } from "@openbuddy/cordis";
import type { RendererContributionRegistry, RendererPlugin } from "@openbuddy/renderer-host";

interface AssistantContributionRegistry extends RendererContributionRegistry {
  register(value: {
    kind: "assistant";
    id: string;
    payload: {
      label: string;
      description: string;
      route: `助理·${string}`;
      order: number;
      modes?: Array<"personal" | "organization" | "network">;
      capabilityIds?: string[];
      requiredTrust?: "local" | "org" | "known_peer" | "public";
    };
  }): () => void;
}

function assistantContributionPlugin(
  id: string,
  payload: {
    label: string;
    description: string;
    route: `助理·${string}`;
    order: number;
    modes?: Array<"personal" | "organization" | "network">;
    capabilityIds?: string[];
    requiredTrust?: "local" | "org" | "known_peer" | "public";
  },
): RendererPlugin & { id: string } {
  return {
    id,
    name: id,
    inject: ["rendererContributions"],
    apply: (ctx: Context) => {
      const registry = ctx.get("rendererContributions") as AssistantContributionRegistry | undefined;
      if (!registry) throw new Error(`${id} requires rendererContributions registry`);
      return registry.register({ kind: "assistant", id, payload });
    },
  };
}

/**
 * Cross-organization deliveries monitor: surfaces pending network tasks,
 * federated room grants, and bidirectional cross-org delivery state. Lives
 * inside the Assistant Workbench so operators have a single pane to
 * approve / revoke / inspect cross-org traffic without leaving the
 * personal Buddy surface.
 */
export const rendererAssistantCrossOrgDeliveriesPlugin: RendererPlugin & { id: string } =
  assistantContributionPlugin("openbuddy-assistant-cross-org-deliveries", {
    label: "跨组织交付",
    description: "查看跨组织 Pending 任务、已颁发 Federated Room Grant 和双向交付状态。",
    route: "助理·跨组织交付",
    order: 410,
    modes: ["organization", "network"],
    capabilityIds: ["federated-room-grant", "network-deliveries"],
    requiredTrust: "known_peer",
  });

/**
 * Research Buddy: combines local memory, web search and known peer
 * capabilities into a single long-running research session. Lives under
 * the Assistant Workbench so the personal Buddy can delegate research
 * tasks to a specialized Buddy without losing context.
 */
export const rendererAssistantResearchBuddyPlugin: RendererPlugin & { id: string } =
  assistantContributionPlugin("openbuddy-assistant-research-buddy", {
    label: "研究 Buddy",
    description: "汇总本地记忆 + 已知 Peer 公开能力，长跑研究任务；交付物走 Artifact/Evidence 链。",
    route: "助理·研究 Buddy",
    order: 420,
    modes: ["personal", "organization", "network"],
    capabilityIds: ["research:brief", "memory:list", "web-search"],
    requiredTrust: "org",
  });

/**
 * Team Workflow Orchestrator: project-scoped multi-Buddy workflow
 * composer with verifier-aware step ordering. Helps operators design
 * workflow DAGs that respect Provider ≠ Verifier.
 */
export const rendererAssistantTeamWorkflowPlugin: RendererPlugin & { id: string } =
  assistantContributionPlugin("openbuddy-assistant-team-workflow", {
    label: "团队工作流编排",
    description: "为项目编排多 Buddy 工作流，强制 Provider ≠ Verifier 与证据验收。",
    route: "助理·团队工作流编排",
    order: 430,
    modes: ["organization"],
    capabilityIds: ["workflow:propose", "workflow:execute"],
    requiredTrust: "org",
  });

/**
 * Index of every Assistant contribution shipped with the base bundle.
 * Renderer plugins should consume this map when constructing a profile so
 * downstream extensions can mix-and-match without rebuilding the registry.
 */
export const openBuddyAssistantContributionPluginIndex: ReadonlyMap<string, RendererPlugin> = new Map([
  [rendererAssistantCrossOrgDeliveriesPlugin.name!, rendererAssistantCrossOrgDeliveriesPlugin],
  [rendererAssistantResearchBuddyPlugin.name!, rendererAssistantResearchBuddyPlugin],
  [rendererAssistantTeamWorkflowPlugin.name!, rendererAssistantTeamWorkflowPlugin],
]);
