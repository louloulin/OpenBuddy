import type { Context } from "@openbuddy/cordis";
import * as resources from "./pi-resources";
import { collaborationRuntime, type CollaborationCapabilityProjection } from "../collaboration/collaboration-runtime";
import { CallbackCapabilityProvider, OrganizationCapabilityProvider, PersonalProviderRegistry } from "@openbuddy/collaboration-coordinator";
import { createMcpServerAdapterForRuntime, type McpServerAdapter } from "../mcp-server-adapter";
import { stableDigest, type BuddyArtifact, type BuddyCapability, type BuddyEvidence, type BuddyIdentity } from "@openbuddy/collaboration-protocol";

export const name = "openbuddy-core";
export const inject = ["agentHost"] as const;

let collaborationMountCount = 0;
let networkEndpointDisposers: Array<() => void> = [];

function localCapability(identity: BuddyIdentity, id: string, description: string, options: { allowedActions?: string[]; requiredApproval?: "never" | "before_external_commit" | "always" }, invoke: (envelope: import("@openbuddy/collaboration-protocol").BuddyTaskEnvelope) => Promise<unknown>): CallbackCapabilityProvider {
  const capability: BuddyCapability = {
    id,
    providerId: identity.id,
    description,
    inputSchema: {},
    outputSchema: { type: "object" },
    procedure: [],
      allowedDataScopes: ["room:personal-room", "room:project-*"],
    forbiddenDataScopes: ["secret:prompt", "credential:vault"],
    allowedActions: options.allowedActions ?? ["read:room", "write:artifact"],
    forbiddenActions: ["external:send", "purchase"],
    acceptanceTests: [],
    requiredApproval: options.requiredApproval ?? "never",
    allowDelegation: false,
    maxDelegationDepth: 0,
    visibility: "private",
  };
  return new CallbackCapabilityProvider({
    identity,
      scope: { communityId: "local-community", organizationId: "local-organization", roomId: "personal-room" },
    registrations: [{
      capability,
      invoke: async ({ envelope }) => {
        const value = await invoke(envelope);
        const summary = JSON.stringify(value);
        const artifact: BuddyArtifact = {
          id: `artifact-${envelope.taskId}-${id}`,
          taskId: envelope.taskId,
          kind: "other",
          title: `${description}结果`,
          digest: stableDigest(summary),
          visibility: "requester",
        };
        const evidence: BuddyEvidence = {
          id: `evidence-${envelope.taskId}-${id}`,
          taskId: envelope.taskId,
          type: "execution",
          title: `${description}执行证据`,
          artifactRefs: [artifact.id],
          digest: stableDigest({ capability: id, result: summary }),
          metadata: { providerId: identity.id, resultDigest: artifact.digest },
        };
        return { artifacts: [artifact], evidence: [evidence] };
      },
    }],
  });
}

function localReadCapability(identity: BuddyIdentity, id: string, description: string, invoke: (envelope: import("@openbuddy/collaboration-protocol").BuddyTaskEnvelope) => Promise<unknown>): CallbackCapabilityProvider {
  return localCapability(identity, id, description, {}, invoke);
}

function createPersonalProviderRegistry(ctx: Context, runner: OrganizationCapabilityProvider): { registry: PersonalProviderRegistry; cards: CollaborationCapabilityProjection[] } {
  const registry = new PersonalProviderRegistry();
  const cards: CollaborationCapabilityProjection[] = [];
  registry.register("buddy-personal-runner", runner);
  const identity: BuddyIdentity = {
    ...collaborationRuntime.snapshot().data.identity,
    id: "buddy-personal-resources",
    handle: "personal-resources",
    displayName: "个人资源 Buddy",
    trustLevel: "local",
  };
  const email = ctx.get("email") as { digest: (input?: { folder?: string; limit?: number }) => Promise<{ total?: number; unread?: number; needsReply?: unknown[] }> } | undefined;
  if (email) {
    registry.register("email", localReadCapability(identity, "email:digest", "收件箱摘要", async () => {
      const digest = await email.digest({ folder: "inbox", limit: 20 });
      return { total: digest.total ?? 0, unread: digest.unread ?? 0, needsReply: Array.isArray(digest.needsReply) ? digest.needsReply.length : 0 };
    }));
    cards.push({ id: "email:digest", providerId: identity.id, name: "收件箱摘要", source: "pi-extension", visibility: "local", status: "available", contract: { input: "context-refs", output: "artifact-or-message", approval: "before-external-commit" } });
  }
  // openbuddy-automation removed (Stage G-1c); automation is delegated to
  // pi-background-tasks + pi-goal (passthrough). No Cordis `automation`
  // service to read here.
  const task = ctx.get("task") as { list: (sessionId: string) => Promise<unknown[]> } | undefined;
  if (task) {
    registry.register("tasks", localReadCapability(identity, "tasks:list", "个人任务清单", async (envelope) => {
      const sessionId = envelope.input.contextRefs?.find((ref) => ref.startsWith("session:"))?.slice("session:".length) ?? "current";
      const entries = await task.list(sessionId);
      return { sessionId, tasks: entries };
    }));
    cards.push({ id: "tasks:list", providerId: identity.id, name: "个人任务清单", source: "pi-extension", visibility: "local", status: "available", contract: { input: "context-refs", output: "artifact-or-message", approval: "before-external-commit" } });
  }
  const calendar = ctx.get("calendar") as {
    list: (input?: { from?: string; to?: string; roomId?: string; contextRef?: string }) => Promise<unknown[]>;
    create: (input: Record<string, unknown>) => Promise<unknown>;
    updateInRoom: (id: string, roomId: string, patch: Record<string, unknown>) => Promise<unknown>;
    removeInRoom: (id: string, roomId: string) => Promise<unknown>;
  } | undefined;
  if (calendar) {
    registry.register("calendar", localReadCapability(identity, "calendar:list", "本地日历查询", async (envelope) => {
      const refs = envelope.input.contextRefs ?? [];
      const roomId = envelope.roomRef;
      if (!roomId) throw new Error("calendar list requires a task room");
      const contextRef = refs.find((ref) => ref.startsWith("context:"));
      return { events: await calendar.list({ roomId, contextRef }) };
    }));
    cards.push({ id: "calendar:list", providerId: identity.id, name: "本地日历查询", source: "pi-extension", visibility: "local", status: "available", contract: { input: "context-refs", output: "artifact-or-message", approval: "before-external-commit" } });
    const capabilityInput = (envelope: import("@openbuddy/collaboration-protocol").BuddyTaskEnvelope): Record<string, unknown> => {
      const value = envelope.input.constraints?.capabilityInput;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("calendar capability input is required");
      return value as Record<string, unknown>;
    };
    const writeOptions = { allowedActions: ["read:room", "write:artifact", "write:calendar"], requiredApproval: "before_external_commit" as const };
    registry.register("calendar-create", localCapability(identity, "calendar:create", "创建本地日程", writeOptions, async (envelope) => {
      const roomId = envelope.roomRef;
      if (!roomId) throw new Error("calendar create requires a task room");
      const input = capabilityInput(envelope);
      if (input.roomId !== undefined && input.roomId !== roomId) throw new Error("calendar event room must match the task room");
      return calendar.create({ ...input, roomId });
    }));
    registry.register("calendar-update", localCapability(identity, "calendar:update", "修改本地日程", writeOptions, async (envelope) => {
      const input = capabilityInput(envelope);
      const id = typeof input.id === "string" ? input.id : "";
      const patch = input.patch;
      if (!id || !patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("calendar update requires id and patch");
      const roomId = envelope.roomRef;
      if (!roomId) throw new Error("calendar update requires a task room");
      return calendar.updateInRoom(id, roomId, patch as Record<string, unknown>);
    }));
    registry.register("calendar-delete", localCapability(identity, "calendar:delete", "删除本地日程", writeOptions, async (envelope) => {
      const input = capabilityInput(envelope);
      if (typeof input.id !== "string" || !input.id) throw new Error("calendar delete requires id");
      const roomId = envelope.roomRef;
      if (!roomId) throw new Error("calendar delete requires a task room");
      return calendar.removeInRoom(input.id, roomId);
    }));
    for (const [id, name] of [["calendar:create", "创建本地日程"], ["calendar:update", "修改本地日程"], ["calendar:delete", "删除本地日程"]] as const) {
      cards.push({ id, providerId: identity.id, name, source: "pi-extension", visibility: "local", status: "available", contract: { input: "context-refs", output: "artifact-or-message", approval: "before-external-commit" } });
    }
  }
  return { registry, cards };
}

export function mountCollaborationRuntime(ctx: Context): () => void {
  // 启动时把 BuddyIdentityStore 的持久化身份同步到 Runtime，确保 owner id 与 userData 保持一致。
  void import("../casdoor/buddy-identity-store").then(({ sharedBuddyIdentityStore }) => {
    const file = sharedBuddyIdentityStore().loadOrCreate();
    collaborationRuntime.updateBuddyIdentity({
      handle: file.handle,
      displayName: file.displayName,
      organizationId: file.organizationId,
      status: file.status,
    });
  }).catch(() => { /* 无 electron 环境（纯单测）时静默忽略，使用默认 identity */ });
  const teamRunner = ctx.get("teamRunner") as { runMember: (input: { teamId: string; memberId: string; role: string; goal: string; schema?: unknown }, signal: AbortSignal) => Promise<unknown> } | undefined;
  if (collaborationMountCount === 0 && teamRunner) {
    const scope = { communityId: "local-community", organizationId: "local-organization", roomId: "personal-room" };
    const runner = {
      runner: teamRunner,
      isApprovalGranted: (taskId: string, actions: readonly string[]) => collaborationRuntime.isOrganizationApprovalGranted(taskId, actions),
      emit: (event: Parameters<typeof collaborationRuntime.recordProviderEvent>[0]) => collaborationRuntime.recordProviderEvent(event),
    };
    const organizationProvider = new OrganizationCapabilityProvider({
      identity: {
        ...collaborationRuntime.snapshot().data.identity,
        id: "buddy-org-runner",
        handle: "org-runner",
        displayName: "组织执行 Buddy",
        trustLevel: "org",
      },
      scope,
      allowProjectRooms: true,
      ...runner,
    });
    const personalProvider = new OrganizationCapabilityProvider({
      identity: {
        ...collaborationRuntime.snapshot().data.identity,
        id: "buddy-personal-runner",
        handle: "personal-runner",
        displayName: "个人执行 Buddy",
        trustLevel: "local",
      },
      scope,
      allowProjectRooms: true,
      ...runner,
    });
    collaborationRuntime.setOrganizationProvider(organizationProvider);
    const personal = createPersonalProviderRegistry(ctx, personalProvider);
    collaborationRuntime.setPersonalProvider(personal.registry);
    collaborationRuntime.setProviderCapabilityCards(personal.cards);
    networkEndpointDisposers = [
      collaborationRuntime.registerProviderNetworkEndpoint(organizationProvider, collaborationRuntime.snapshot().data.identity),
      collaborationRuntime.registerProviderNetworkEndpoint(personalProvider),
    ];
  }
  collaborationMountCount += 1;
  ctx.provide("collaborationRuntime", collaborationRuntime);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    collaborationMountCount = Math.max(0, collaborationMountCount - 1);
    if (collaborationMountCount !== 0) return;
    networkEndpointDisposers.splice(0).forEach((dispose) => dispose());
    collaborationRuntime.setOrganizationProvider(null);
    collaborationRuntime.setPersonalProvider(null);
  };
}

export function collaborationRuntimeBridge(): { mount: (ctx: Context) => () => void; getRuntime: () => typeof collaborationRuntime } {
  return {
    mount: (ctx) => mountCollaborationRuntime(ctx),
    getRuntime: () => collaborationRuntime,
  };
}

export async function apply(ctx: Context): Promise<() => void> {
  const { mountSession } = await import("@openbuddy/core-session");
  const { mountAuthorization } = await import("@openbuddy/capability-authorization");
  const { mountPermission } = await import("@openbuddy/auth-permission");
  // openbuddy-plan removed; plan-mode is delegated to pi-plan-mode (passthrough).
  // openbuddy-automation removed; automation is delegated to pi-background-tasks + pi-goal (passthrough).
  const { mountCalendar } = await import("@openbuddy/capability-calendar");
  const { mountFsLocal } = await import("@openbuddy/fs-fs-local");
  const { mountTeam } = await import("@openbuddy/team-team");
  const { mountMcpClient } = await import("@openbuddy/capability-mcp-client");
  const { mountEmail, EmailProviderRegistry } = await import("@openbuddy/capability-email");
  const { defaultTaskService } = await import("./host-modules/task-service");

  mountSession(ctx);
  mountAuthorization(ctx);
  mountPermission(ctx);
  mountCalendar(ctx);
  mountFsLocal(ctx);
  mountTeam(ctx);
  mountMcpClient(ctx);
  // Phase R3.0 (Stage G-1d) — mount the task Cordis service so the
  // `pi-todo` adapter's real-tool path stops no-op'ing in production.
  // Previously `ctx.get("task")` returned undefined because the service
  // was never mounted (the only references to `task` were in tests and
  // the dead-adapter path). See `electron/main/agent/host-modules/
  // task-service.ts` for the wrapper shape.
  ctx.provide("task", defaultTaskService());
  ctx.provide("emailKnowledgeContextValidator", { validate: resources.validateKnowledgeContextCitation });

  const emailMcp = ctx.get("mcpClient") as { list?: () => unknown[]; listToolNames?: (serverName: string) => string[]; callTool?: (...args: unknown[]) => Promise<unknown> } | undefined;
  const resolveEmailCredential = async (ref: string) => {
    try {
      const credential = await resources.mcpAuthCredential(ref);
      if (credential?.accessToken) return { accessToken: credential.accessToken, refreshToken: credential.refreshToken, tokenType: credential.tokenType, expiresAt: credential.expiresAt };
    } catch { /* fall through to env/headers */ }
    return undefined;
  };
  const authorizeEmailCredential = async (ref: string) => {
    await resources.mcpAuthMark(ref, "pending");
  };
  const emailRegistry = new EmailProviderRegistry({
    mcp: emailMcp
      ? {
          list: (emailMcp.list ?? (() => [])) as never,
          callTool: ((emailMcp.callTool as never) ?? (async () => ({ content: [], details: {} }))) as never,
          ...(emailMcp.listToolNames ? { listToolNames: emailMcp.listToolNames } : {}),
        }
      : undefined,
    credentialResolver: { resolve: resolveEmailCredential, authorize: authorizeEmailCredential },
  });
  ctx.provide("emailProviderRegistry", emailRegistry);
  mountEmail(ctx);
  const cleanupCollaboration = mountCollaborationRuntime(ctx);

  // Optionally expose BuddyCapability cards as MCP tools over stdio when the
  // process is started with OPENBUDDY_MCP_STDIO=1 (e.g. spawned as a dedicated
  // MCP server by another agent). The default is to leave the transport
  // unbound so the Electron main process keeps stdout for logging; external
  // callers can still reach the adapter through the typed IPC channels exposed
  // by CollaborationRuntime.listMcpCapabilities / invokeMcpCapability.
  // See docs/openbuddy-distributed-buddy-vision.md §3 Phase 3 for rationale.
  let mcpAdapter: McpServerAdapter | undefined;
  let mcpStarted = false;
  if (process.env.OPENBUDDY_MCP_STDIO === "1") {
    try {
      const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
      mcpAdapter = createMcpServerAdapterForRuntime(collaborationRuntime, {
        serverName: "openbuddy-mcp-bridge",
        serverVersion: process.env.OPENBUDDY_VERSION ?? "0.0.0",
      });
      await mcpAdapter.start(new StdioServerTransport());
      mcpStarted = true;
    } catch (error) {
      console.error("[openbuddy-core] failed to start MCP stdio bridge:", error);
    }
  }

  return async () => {
    if (mcpStarted && mcpAdapter) {
      try { await mcpAdapter.stop(); } catch { /* ignore */ }
    }
    cleanupCollaboration();
  };
}
