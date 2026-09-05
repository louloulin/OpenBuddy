/**
 * Renderer-side Contribution Plugins for project / message / settings / command.
 *
 * Each entry registers a contribution of the matching kind on the
 * `rendererContributions` registry consumed by:
 *   - `project`    → `ProjectDetailView` (project-scoped tabs)
 *   - `message`    → `MessageItem`       (per-message footer slots)
 *   - `settings`   → `SettingsPanel`     (settings sections)
 *   - `command`    → `SlashCommands`     (slash commands)
 *
 * Every plugin payload declares `modes` + `capabilityIds` + `requiredTrust`
 * so the host can filter by trust boundary before rendering. Cross-network
 * contributions must include `federated-room-grant` in capabilityIds so that
 * the existing relay-auth gate enforces `Discovery ≠ Authorization`.
 */
import type { Context } from "@openbuddy/cordis";
import type { RendererContributionRegistry, RendererPlugin } from "@openbuddy/renderer-host";

type ContributionKind = "project" | "message" | "settings" | "command";

function contributionPlugin(
  id: string,
  kind: ContributionKind,
  payload: Record<string, unknown>,
): RendererPlugin & { id: string } {
  return {
    id,
    name: id,
    inject: ["rendererContributions"],
    apply: (ctx: Context) => {
      const registry = ctx.get("rendererContributions") as
        | (RendererContributionRegistry & {
            register: (value: { kind: ContributionKind; id: string; payload: Record<string, unknown> }) => () => void;
          })
        | undefined;
      if (!registry) throw new Error(`${id} requires rendererContributions registry`);
      return registry.register({ kind, id, payload });
    },
  };
}

/* ------------------------------------------------------------------ project */

/**
 * Project-scoped cross-org delivery surface. Shows in `ProjectDetailView` as a
 * tab; pulls federated grants, delivery state, and audit events filtered by
 * the active `projectId`. Authority still flows through the relay-auth gate
 * via `federated-room-grant`.
 */
export const rendererProjectCrossOrgDeliveriesPlugin: RendererPlugin & { id: string } =
  contributionPlugin("openbuddy-project-cross-org-deliveries", "project", {
    label: "跨组织交付",
    description: "项目维度查看 Federated Room Grant、Pending 任务和审计事件。",
    projectTab: "cross-org-deliveries",
    order: 510,
    modes: ["organization", "network"],
    capabilityIds: ["federated-room-grant", "network-deliveries"],
    requiredTrust: "known_peer",
  });

/**
 * Project-scoped Workflow Blackboard view (per project). Reuses the
 * global `WorkflowBlackboard` shape but filters by `projectId`. Lives inside
 * the Project Detail so project managers see one DAG per project.
 */
export const rendererProjectWorkflowBlackboardPlugin: RendererPlugin & { id: string } =
  contributionPlugin("openbuddy-project-workflow-blackboard", "project", {
    label: "工作流黑板",
    description: "项目内多 Buddy 工作流拓扑、依赖边、Provider ≠ Verifier 高亮。",
    projectTab: "workflow-blackboard",
    order: 520,
    modes: ["personal", "organization"],
    capabilityIds: ["workflow:read"],
    requiredTrust: "local",
  });

/* ------------------------------------------------------------------ message */

/**
 * Per-message footer action: "委托给 Buddy" — turns the active message into a
 * replayable task proposal so the personal Buddy can delegate without copying
 * the original prompt across the boundary.
 */
export const rendererMessageDelegateToBuddyPlugin: RendererPlugin & { id: string } =
  contributionPlugin("openbuddy-message-delegate-to-buddy", "message", {
    label: "委托给 Buddy",
    description: "把当前消息作为 TaskEnvelope 委托给其他 Buddy，保留稳定 ID + 摘要，不复制完整 prompt。",
    order: 600,
    modes: ["personal", "organization", "network"],
    capabilityIds: ["task:propose", "buddy:delegate"],
    requiredTrust: "org",
  });

/* ----------------------------------------------------------------- settings */

/**
 * Settings section that exposes the collaboration invariants + capability
 * contracts so operators can audit the local Buddy configuration.
 */
export const rendererSettingsCollaborationPlugin: RendererPlugin & { id: string } =
  contributionPlugin("openbuddy-settings-collaboration", "settings", {
    label: "协作与多智能体",
    description: "查看 effectivePolicy、组织成员、Federated Room Grant 与跨组织信任根。",
    section: "collaboration",
    order: 700,
    modes: ["personal", "organization", "network"],
    capabilityIds: ["policy:read", "buddy:identity:read", "federated-room-grant:read"],
    requiredTrust: "local",
  });

/* ----------------------------------------------------------------- command */

/**
 * Slash command: `/buddy-propose` — quick path to propose a unified Buddy
 * collaboration task from any chat composer.
 */
export const rendererCommandBuddyProposePlugin: RendererPlugin & { id: string } =
  contributionPlugin("openbuddy-command-buddy-propose", "command", {
    label: "/buddy-propose",
    description: "通过统一协作合同提出一个 personal / organization / network 任务。",
    command: "buddy-propose",
    insertText: "/buddy-propose ",
    placeholder: "输入目标 / 能力 / 模式",
    order: 800,
    modes: ["personal", "organization", "network"],
    capabilityIds: ["task:propose"],
    requiredTrust: "local",
  });

/**
 * Slash command: `/federated-grant` — quick path to issue / revoke a
 * Federated Room Grant from the composer. Stays scoped to known_peer by
 * default; network visibility stays `not_configured`.
 */
export const rendererCommandFederatedGrantPlugin: RendererPlugin & { id: string } =
  contributionPlugin("openbuddy-command-federated-grant", "command", {
    label: "/federated-grant",
    description: "颁发 / 撤销 Federated Room Grant，仅 known_peer，公网 Relay 仍 not_configured。",
    command: "federated-grant",
    insertText: "/federated-grant ",
    placeholder: "projectId · roomId · principalId · expiresAt",
    order: 810,
    modes: ["organization", "network"],
    capabilityIds: ["federated-room-grant"],
    requiredTrust: "known_peer",
  });

/**
 * Index of every cross-kind contribution shipped with the base bundle.
 * The renderer can mix-and-match these without rebuilding the registry.
 */
export const openBuddyRendererContributionPluginIndex: ReadonlyMap<string, RendererPlugin> = new Map([
  [rendererProjectCrossOrgDeliveriesPlugin.name!, rendererProjectCrossOrgDeliveriesPlugin],
  [rendererProjectWorkflowBlackboardPlugin.name!, rendererProjectWorkflowBlackboardPlugin],
  [rendererMessageDelegateToBuddyPlugin.name!, rendererMessageDelegateToBuddyPlugin],
  [rendererSettingsCollaborationPlugin.name!, rendererSettingsCollaborationPlugin],
  [rendererCommandBuddyProposePlugin.name!, rendererCommandBuddyProposePlugin],
  [rendererCommandFederatedGrantPlugin.name!, rendererCommandFederatedGrantPlugin],
]);
