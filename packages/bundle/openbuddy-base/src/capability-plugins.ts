/**
 * Per-capability Harness plugin wrappers.
 *
 * Each capability package exports a `mountX(ctx)` function that registers a
 * Cordis Service into the shared context. These thin wrappers re-export each
 * mount function as a Harness-shaped plugin so the OpenBuddy profile can list
 * every capability as its own entry — independently loadable, reloadable, and
 * disable-able through the same loader the user-facing `openbuddy-core`
 * profile currently goes through.
 *
 * The wrappers are intentionally minimal: they import the mount function
 * lazily inside `apply` so consumers that don't enable a given capability
 * never pay its module-load cost.
 */
import type { Context } from "@openbuddy/cordis";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import type { HarnessPlugin } from "@openbuddy/plugin-host";
import { isPassthroughed } from "@openbuddy/plugin-host";
import { OPENBUDDY_COLLABORATION_PROTOCOL_VERSION, type BuddyCollaborationManifest } from "@openbuddy/collaboration-protocol";

interface CapabilityPlugin extends HarnessPlugin {
  /** Stable id used as the plugin entry id in the profile. */
  readonly id: string;
}

interface CollaborationRuntimeBridge {
  mount: (ctx: Context) => void | (() => void);
    getRuntime: () => {
    collaborationManifest?: () => BuddyCollaborationManifest;
    snapshot: () => unknown;
    proposeTask: (input: { title: string; objective: string; capability?: string; roomId?: string; projectId?: string; agentRef?: { type: "expert" | "personal-buddy" | "organization-buddy" | "external-buddy"; id: string }; sideEffectIntentId?: string; sideEffectFingerprint?: string }) => unknown;
    networkSnapshot: () => unknown;
    proposeCollaboration?: (input: { mode: "personal" | "organization" | "network"; title: string; objective: string; capability?: string; roomId?: string; projectId?: string; dataScopes?: string[]; artifactTypes?: string[]; expiresAt?: string; providerId?: string; capabilityInput?: Record<string, unknown>; agentRef?: { type: "expert" | "personal-buddy" | "organization-buddy" | "external-buddy"; id: string }; sideEffectIntentId?: string; sideEffectFingerprint?: string }) => unknown;
    proposeWorkflow?: (input: { title: string; mode: "personal" | "organization"; projectId?: string; nodes: Array<{ id: string; dependsOn?: string[]; title?: string; objective?: string; capability?: string; projectId?: string; roomId?: string; agentRef?: { type: "expert" | "personal-buddy" | "organization-buddy" | "external-buddy"; id: string }; crossNetwork?: boolean; sideEffectIntentId?: string; sideEffectFingerprint?: string }> }) => unknown;
    networkProposeService?: (input: { capabilityId: string; objective: string; dataScopes: string[]; allowedActions?: string[]; artifactTypes: string[]; expiresAt: string }) => unknown;
    networkNegotiateCapability?: (input: { offerId: string; proposalId: string; providerId: string }) => unknown;
      networkPublishOffer?: (input: { providerId: string; capabilityId: string; title: string; description: string; acceptedDataScopes: string[]; acceptedArtifactTypes: string[]; approval: "never" | "before_external_commit" | "always"; validUntil: string; visibility: "known_peers" | "directory" }) => unknown;
      createSideEffectIntent?: (input: { capability: string; action: string; summary: string; fingerprint: string; resourceId?: string; taskId?: string; expiresAt?: string; approvedByUser?: boolean }) => unknown;
  };
}

export function capabilityPlugin(
  id: string,
  importer: () => Promise<(ctx: Context) => unknown>,
  tools?: (ctx: Context, mounted: unknown) => Promise<ToolDefinition[]>,
  inject: readonly string[] = ["agentHost"],
  /**
   * Stage D F4: when a native Pi package owns this capability (e.g.
   * `pi-plan-mode` for plan), `apply()`
   * short-circuits to a no-op so the Cordis plugin does not duplicate
   * the surface. Defaults to undefined (always mount).
   */
  passthroughCapability?: string,
): CapabilityPlugin {
  return {
    id,
    name: id,
    inject,
    apply: async (ctx: Context): Promise<() => void> => {
      if (passthroughCapability && isPassthroughed(passthroughCapability)) {
        // Native Pi package already owns this surface; skip Cordis mount
        // entirely. The compat adapter (pi-extensions.ts) emits a passthrough
        // event when this decision is made so observers can audit it.
        return () => undefined;
      }
      const mount = await importer();
      const cleanup = mount(ctx) as unknown;
      const dispose: () => void = typeof cleanup === "function" ? (cleanup as () => void) : () => undefined;
      const toolDisposers = tools ? await registerPiTools(ctx, await tools(ctx, cleanup)) : [];
      return () => {
        for (const remove of toolDisposers.reverse()) remove();
        dispose();
      };
    },
  };
}

function toolResult(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { content: [{ type: "text" as const, text }], details: value };
}

type ToolArgs = Record<string, any>;

async function registerPiTools(ctx: Context, tools: ToolDefinition[]): Promise<Array<() => void>> {
  const pi = ctx.get("pi") as { tools?: { registerTool: (tool: ToolDefinition) => () => void } } | undefined;
  if (!pi?.tools) return [];
  return tools.map((tool) => pi.tools!.registerTool(tool));
}

/**
 * Wraps `apply` so its returned cleanup is registered through the cordis
 * scope's effect tracker, matching how DeepSeek Harness plugins register
 * disposers.
 */
function trackedPlugin(plugin: CapabilityPlugin): CapabilityPlugin {
  return {
    ...plugin,
    apply: async (ctx: Context): Promise<() => void> => {
      const cleanup = await plugin.apply(ctx);
      const dispose: () => void = typeof cleanup === "function" ? cleanup : () => undefined;
      ctx.effect(() => dispose);
      return () => undefined;
    },
  };
}

export const sessionPlugin = trackedPlugin(
  capabilityPlugin(
    "openbuddy-session",
    () => import("@openbuddy/core-session").then((m) => m.mountSession),
    undefined,
    ["agentHost"],
    // P-3: passthrough when pi-session is installed. See pi-extensions.ts
    // adapter for the install-detection rules. Cordis fallback runs when
    // pi-session is not installed OR the user sets spec.passthrough=false.
    "session",
  ),
);

export const authorizationPlugin = trackedPlugin(
  capabilityPlugin("openbuddy-authorization", () =>
    import("@openbuddy/capability-authorization").then((m) => m.mountAuthorization),
  ),
);

// G-3: openbuddy-mcp-client split. `passthroughCapability: "mcp"` (5th arg)
// means: when the compat adapter in pi-extensions.ts records
// recordPassthrough("mcp", ...) — either because the user opted in or
// pi-mcp-adapter is auto-detected in node_modules — this plugin's apply()
// short-circuits to a no-op and pi-mcp-adapter owns discovery, listTools,
// and tool registration. The Cordis side only mounts when pi-mcp-adapter
// is absent; it provides the OAuth metadata helper
// (createMcpOAuthProvider) and credential persistence that pi-mcp-adapter
// does not implement. Tool names from the Cordis side still surface via
// `this.pi.registerTool(tool)` so the LLM sees a single namespace either
// way. mcpClientPlugin is the only Cordis plugin in the codebase that
// declares passthroughCapability today; the wiring template other plugins
// should follow when they migrate to native pi ownership.
export const mcpClientPlugin = trackedPlugin(
  capabilityPlugin(
    "openbuddy-mcp-client",
    () => import("@openbuddy/capability-mcp-client").then((m) => m.mountMcpClient),
    undefined,
    ["openbuddy-authorization", "agentHost", "mcpResources", "pi"],
    "mcp",
  ),
);

export const emailPlugin = trackedPlugin(
  capabilityPlugin(
    "openbuddy-email",
    () => import("@openbuddy/capability-email").then((m) => m.mountEmail),
    async () => {
      const { createEmailPiTools } = await import("@openbuddy/capability-email");
      return createEmailPiTools();
    },
    ["openbuddy-mcp-client", "agentHost", "pi"],
  ),
);

// P-1: openbuddy-permission declares `passthroughCapability: "permission"`
// (5th arg). When `pi-permission-system` is installed the compatibility
// adapter in `electron/main/agent/pi-extensions.ts` calls
// `recordPassthrough("permission", ...)` and `isPassthroughed("permission")`
// returns true at apply() time — the Cordis mount short-circuits to a
// no-op and the pi package owns the surface. When `pi-permission-system`
// is not installed (the common case), the Cordis `mountPermission` runs
// unchanged so the existing OpenBuddy permission settings.json block
// still drives the agent. Same wiring template as `mcpClientPlugin`.
export const permissionPlugin = trackedPlugin(
  capabilityPlugin(
    "openbuddy-permission",
    () => import("@openbuddy/auth-permission").then((m) => m.mountPermission),
    undefined,
    ["agentHost"],
    "permission",
  ),
);

// Stage C-4: openbuddy-memory deleted; the canonical memory capability is
// now `pi-memory` (upstream ExtensionAPI passthrough). This stub stays in
// the profile so legacy tooling that expects `openbuddy-memory` as an
// entry id keeps working — apply() is a noop and `disabled` flips the
// loader off while the passthrough flag in pi-extensions routes real
// traffic to `pi-memory`.
export const memoryPlugin = trackedPlugin(
  capabilityPlugin(
    "openbuddy-memory",
    async () => () => undefined,
    async () => [] as ToolDefinition[],
  ),
);

export const calendarPlugin = trackedPlugin(
  capabilityPlugin(
    "openbuddy-calendar",
    () => import("@openbuddy/capability-calendar").then((m) => m.mountCalendar),
    async () => {
      const { calendarHandlers } = await import("@openbuddy/capability-calendar");
      return [
        {
          name: "calendar_list",
          label: "List calendar events",
          description: "List local OpenBuddy calendar events by time range, room, or context.",
          parameters: Type.Object({
            from: Type.Optional(Type.String()),
            to: Type.Optional(Type.String()),
            roomId: Type.Optional(Type.String()),
            contextRef: Type.Optional(Type.String()),
          }),
          execute: async (_toolCallId, args: ToolArgs) => toolResult(await calendarHandlers.list(args)),
        },
        {
          name: "calendar_create",
          label: "Create calendar event",
          description: "Create a local calendar event; external calendar sync is not enabled.",
          parameters: Type.Object({
            title: Type.String(),
            start: Type.String(),
            end: Type.String(),
            timeZone: Type.Optional(Type.String()),
            allDay: Type.Optional(Type.Boolean()),
            roomId: Type.Optional(Type.String()),
            contextRefs: Type.Optional(Type.Array(Type.String())),
            description: Type.Optional(Type.String()),
            location: Type.Optional(Type.String()),
            attendees: Type.Optional(Type.Array(Type.String())),
          }),
          execute: async (_toolCallId, args: ToolArgs) => toolResult(await calendarHandlers.create(args as Parameters<typeof calendarHandlers.create>[0])),
        },
      ] as ToolDefinition[];
    },
  ),
);

export const fsLocalPlugin = trackedPlugin(
  capabilityPlugin(
    "openbuddy-fs-local",
    () => import("@openbuddy/fs-fs-local").then((m) => m.mountFsLocal),
    undefined,
    ["agentHost"],
    // P-3: passthrough when pi-fs is installed. Cordis fallback runs when
    // pi-fs is not installed OR the user sets spec.passthrough=false.
    "fs",
  ),
);

// subagent handled by pi-subagents (122k weekly downloads); no Cordis stub required.

// P-2: openbuddy-team supports `passthroughCapability: "goal"`. When
// `pi-goal` / `pi-goal-x` / `@narumitw/pi-goal` is installed the
// compatibility adapter in `electron/main/agent/pi-extensions.ts` calls
// `recordPassthrough("goal", ...)` — `isPassthroughed("goal")` returns
// true at apply() time and the Cordis mount short-circuits to a no-op
// while `pi-subagents` (or the user's preferred pi goal package) owns
// the surface. The teamPlugin uses a custom apply (it must mount the
// Cordis service AND register the additional pi tools via
// `createTeamTools`), so the passthrough check has to live INSIDE that
// custom apply — `capabilityPlugin`'s built-in check would be bypassed
// by the spread.
export const teamPlugin = trackedPlugin({
  id: "openbuddy-team",
  name: "openbuddy-team",
  inject: ["agentHost", "pi"],
  apply: async (ctx: Context): Promise<() => void> => {
    if (isPassthroughed("goal")) {
      // Native pi-goal owns this surface; skip Cordis mount entirely.
      return () => undefined;
    }
    const mount = await import("@openbuddy/team-team").then((m) => m.mountTeam);
    mount(ctx);
    const { createTeamTools } = await import("@openbuddy/team-team/pi");
    const pi = ctx.get("pi") as {
      tools: { registerTool: (tool: ToolDefinition) => () => void };
    } | undefined;
    if (!pi?.tools) return () => undefined;
    const disposers = createTeamTools().map((tool) => pi.tools.registerTool(tool));
    return () => {
      for (const dispose of disposers.reverse()) dispose();
    };
  },
});

export const collaborationPlugin = trackedPlugin({
  id: "openbuddy-collaboration",
  name: "openbuddy-collaboration",
  inject: ["agentHost", "collaborationRuntimeBridge"],
  apply: async (ctx: Context): Promise<() => void> => {
    const bridge = ctx.get("collaborationRuntimeBridge") as CollaborationRuntimeBridge | undefined;
    if (!bridge) throw new Error("openbuddy-collaboration requires collaborationRuntimeBridge");
    const cleanup = bridge.mount(ctx);
    const runtime = bridge.getRuntime();
    const pi = ctx.get("pi") as { tools?: { registerTool: (tool: ToolDefinition) => () => void } } | undefined;
    if (!pi?.tools) return typeof cleanup === "function" ? cleanup : () => undefined;
    const tools: ToolDefinition[] = [
      {
        name: "buddy_collaboration_manifest",
        label: "Collaboration protocol manifest",
        description: "Read the versioned collaboration protocol, supported modes, transports, and security invariants.",
        parameters: Type.Object({}),
        execute: async () => toolResult(runtime.collaborationManifest?.() ?? {
          protocol: OPENBUDDY_COLLABORATION_PROTOCOL_VERSION,
          pluginId: "openbuddy-collaboration",
          capabilities: [],
          invariants: ["single-runtime-source-of-truth", "discovery-is-not-authorization", "provider-cannot-self-verify", "renderer-receives-redacted-projection"],
        }),
      },
      {
        name: "buddy_collaboration_snapshot",
        label: "Collaboration snapshot",
        description: "Read the redacted local-first collaboration projection for the current Buddy.",
        parameters: Type.Object({}),
        execute: async () => toolResult(runtime.snapshot()),
      },
      {
        name: "buddy_task_propose",
        label: "Propose Buddy task",
        description: "Create a replayable task proposal; execution, delegation, and external side effects remain separately authorized.",
        parameters: Type.Object({
          title: Type.String(),
          objective: Type.String(),
          capability: Type.Optional(Type.String()),
          roomId: Type.Optional(Type.String()),
          projectId: Type.Optional(Type.String()),
          agentRef: Type.Optional(Type.Object({ type: Type.Union([Type.Literal("expert"), Type.Literal("personal-buddy"), Type.Literal("organization-buddy"), Type.Literal("external-buddy")]), id: Type.String() })),
          sideEffectIntentId: Type.Optional(Type.String()),
          sideEffectFingerprint: Type.Optional(Type.String()),
        }),
        execute: async (_toolCallId, args: ToolArgs) => toolResult(runtime.proposeTask({ title: args.title, objective: args.objective, capability: args.capability, roomId: args.roomId, projectId: args.projectId, agentRef: args.agentRef, sideEffectIntentId: args.sideEffectIntentId, sideEffectFingerprint: args.sideEffectFingerprint })),
      },
      {
        name: "buddy_network_snapshot",
        label: "Open Buddy network snapshot",
        description: "Read known Peer, offer, proposal, and bid projections without exposing private prompts or credentials.",
        parameters: Type.Object({}),
        execute: async () => toolResult(runtime.networkSnapshot()),
      },
      {
        name: "buddy_side_effect_intent",
        label: "Create side-effect intent",
        description: "Create a task-bound, fingerprinted side-effect authorization; approval is separate unless explicitly supplied by the host.",
        parameters: Type.Object({
          capability: Type.String(),
          action: Type.String(),
          summary: Type.String(),
          fingerprint: Type.String(),
          resourceId: Type.Optional(Type.String()),
          taskId: Type.Optional(Type.String()),
          expiresAt: Type.Optional(Type.String()),
        }),
        execute: async (_toolCallId, args: ToolArgs) => {
          if (!runtime.createSideEffectIntent) throw new Error("side-effect intent command is unavailable");
          return toolResult(runtime.createSideEffectIntent(args as Parameters<NonNullable<typeof runtime.createSideEffectIntent>>[0]));
        },
      },
      {
        name: "buddy_collaboration_propose",
        label: "Propose unified Buddy collaboration",
        description: "Propose a personal, organization, or open-network task through one redacted collaboration contract.",
        parameters: Type.Object({
          mode: Type.Union([Type.Literal("personal"), Type.Literal("organization"), Type.Literal("network")]),
          title: Type.String(),
          objective: Type.String(),
          capability: Type.Optional(Type.String()),
          roomId: Type.Optional(Type.String()),
          dataScopes: Type.Optional(Type.Array(Type.String())),
          artifactTypes: Type.Optional(Type.Array(Type.String())),
          expiresAt: Type.Optional(Type.String()),
          providerId: Type.Optional(Type.String()),
          agentRef: Type.Optional(Type.Object({ type: Type.Union([Type.Literal("expert"), Type.Literal("personal-buddy"), Type.Literal("organization-buddy"), Type.Literal("external-buddy")]), id: Type.String() })),
          sideEffectIntentId: Type.Optional(Type.String()),
          sideEffectFingerprint: Type.Optional(Type.String()),
        }),
        execute: async (_toolCallId, args: ToolArgs) => {
	          if (!runtime.proposeCollaboration) throw new Error("unified collaboration command is unavailable");
          return toolResult(runtime.proposeCollaboration(args as Parameters<NonNullable<typeof runtime.proposeCollaboration>>[0]));
        },
      },
      {
        name: "buddy_workflow_propose",
        label: "Propose Buddy workflow",
        description: "Create a project-scoped multi-Buddy workflow; each node keeps its own capability and Buddy reference.",
        parameters: Type.Object({
          title: Type.String(),
          mode: Type.Union([Type.Literal("personal"), Type.Literal("organization")]),
          projectId: Type.Optional(Type.String()),
          nodes: Type.Array(Type.Object({
          id: Type.String(),
            dependsOn: Type.Optional(Type.Array(Type.String())),
            title: Type.Optional(Type.String()),
            objective: Type.Optional(Type.String()),
            capability: Type.Optional(Type.String()),
            projectId: Type.Optional(Type.String()),
            roomId: Type.Optional(Type.String()),
            agentRef: Type.Optional(Type.Object({ type: Type.Union([Type.Literal("expert"), Type.Literal("personal-buddy"), Type.Literal("organization-buddy"), Type.Literal("external-buddy")]), id: Type.String() })),
            crossNetwork: Type.Optional(Type.Boolean()),
            sideEffectIntentId: Type.Optional(Type.String()),
            sideEffectFingerprint: Type.Optional(Type.String()),
          })),
        }),
        execute: async (_toolCallId, args: ToolArgs) => {
          if (!runtime.proposeWorkflow) throw new Error("workflow proposal command is unavailable");
          return toolResult(runtime.proposeWorkflow(args as Parameters<NonNullable<typeof runtime.proposeWorkflow>>[0]));
        },
      },
      {
        name: "buddy_network_propose",
        label: "Propose network service",
        description: "Publish a redacted open-network service request using public data scopes only.",
        parameters: Type.Object({ capabilityId: Type.String(), objective: Type.String(), dataScopes: Type.Array(Type.String()), allowedActions: Type.Optional(Type.Array(Type.String())), artifactTypes: Type.Array(Type.String()), expiresAt: Type.String() }),
        execute: async (_toolCallId, args: ToolArgs) => {
          if (!runtime.networkProposeService) throw new Error("network proposal command is unavailable");
          return toolResult(runtime.networkProposeService(args as Parameters<NonNullable<typeof runtime.networkProposeService>>[0]));
        },
      },
      {
        name: "buddy_network_negotiate",
        label: "Negotiate Buddy capability",
        description: "Compute an auditable intersection of trust, scopes, actions, artifacts, and approval before bidding.",
        parameters: Type.Object({ offerId: Type.String(), proposalId: Type.String(), providerId: Type.String() }),
        execute: async (_toolCallId, args: ToolArgs) => {
          if (!runtime.networkNegotiateCapability) throw new Error("network capability negotiation is unavailable");
          return toolResult(runtime.networkNegotiateCapability(args as Parameters<NonNullable<typeof runtime.networkNegotiateCapability>>[0]));
        },
      },
      {
        name: "buddy_network_offer",
        label: "Publish Buddy capability",
        description: "Publish a capability offer to known peers or the local directory; settlement remains disabled.",
        parameters: Type.Object({ providerId: Type.String(), capabilityId: Type.String(), title: Type.String(), description: Type.String(), acceptedDataScopes: Type.Array(Type.String()), acceptedArtifactTypes: Type.Array(Type.String()), approval: Type.Union([Type.Literal("never"), Type.Literal("before_external_commit"), Type.Literal("always")]), validUntil: Type.String(), visibility: Type.Union([Type.Literal("known_peers"), Type.Literal("directory")]) }),
        execute: async (_toolCallId, args: ToolArgs) => {
          if (!runtime.networkPublishOffer) throw new Error("network offer command is unavailable");
          return toolResult(runtime.networkPublishOffer(args as Parameters<NonNullable<typeof runtime.networkPublishOffer>>[0]));
        },
      },
    ];
    const disposers = tools.map((tool) => pi.tools!.registerTool(tool));
    return () => {
      for (const dispose of disposers.reverse()) dispose();
      if (typeof cleanup === "function") cleanup();
    };
  },
} satisfies CapabilityPlugin);

export const openBuddyCapabilityPlugins: readonly CapabilityPlugin[] = [
  sessionPlugin,
  authorizationPlugin,
  mcpClientPlugin,
  emailPlugin,
  permissionPlugin,
  memoryPlugin,
  calendarPlugin,
  fsLocalPlugin,
  teamPlugin,
  collaborationPlugin,
];

/** Index by id for the loader's importer. */
export const openBuddyCapabilityPluginIndex: ReadonlyMap<string, CapabilityPlugin> = new Map(
  openBuddyCapabilityPlugins.map((plugin) => [plugin.id, plugin]),
);
