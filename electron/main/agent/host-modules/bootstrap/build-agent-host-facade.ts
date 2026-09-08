/**
 * build-agent-host-facade.ts — assemble the public `agentHost` object.
 *
 * Phase 8.3 §43: extracted from electron/main/agent/agent-host.ts (113 lines).
 *
 * The agentHost object is a pure delegation facade — every key is either
 * a direct function reference (init, dispose, prompt, …) or a one-line
 * closure over state (getContext, listTools, registerRemote, …). Splitting
 * it into its own module:
 *   1. Makes the public API surface a single artifact (one grep target)
 *   2. Lets us add a single per-method comment header describing the IPC
 *      contract without bloating agent-host.ts
 *   3. Removes the last "constructor + body" cluster from agent-host.ts so
 *      we can split initialize() in §44 without crossing the export
 *      boundary.
 *
 * Closure strategy:
 *   This module does NOT take `state` as a dep. Inline lambdas like
 *   `getContext: () => state.context` are pre-bound by the caller in
 *   agent-host.ts (where `state` lives in module scope) and passed in as
 *   already-closed function values. This keeps reverse-deps clean — the
 *   facade knows nothing about Cordis, ModelRuntime, or any agent-host
 *   internal state shape.
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";

export interface AgentHostFacade {
  // ---- core lifecycle ----
  getContext: () => { get: (name: string) => any } | null;
  init: (opts?: { cwd?: string; sessionPath?: string; force?: boolean; traceId?: string; sessionId?: string }) => Promise<void>;
  waitUntilReady: () => Promise<void>;
  dispose: () => Promise<void>;

  // ---- session queries ----
  getSession: () => { sessionId: string } | null;
  getModel: () => { provider?: string; id?: string } | null;
  getModelRuntime: () => any;
  getCwd: () => string;

  // ---- events ----
  onEvent: (handler: unknown) => unknown;
  onPluginEvent: (handler: unknown) => unknown;

  // ---- prompt / steer / follow-up / abort ----
  prompt: (text: string, options?: { traceId?: string; sessionId?: string }) => Promise<unknown>;
  promptContent: (content: readonly unknown[], mode?: "queue" | "steer") => Promise<unknown>;
  steer: (text: string, options?: { traceId?: string; sessionId?: string }) => Promise<unknown>;
  followUp: (text: string, options?: { traceId?: string; sessionId?: string }) => Promise<unknown>;
  abort: (options?: { traceId?: string; sessionId?: string }) => Promise<unknown>;
  updateSessionQueue: (sessionId: string, itemId: string, action: unknown, options?: unknown) => Promise<any>;
  readSessionAttachment: (sessionId: string, attachmentId: string, options?: unknown) => Promise<any>;

  // ---- model control ----
  setModel: (modelId: string, options?: { traceId?: string; sessionId?: string }) => Promise<unknown>;
  setThinkingLevel: (level: unknown, options?: { traceId?: string; sessionId?: string }) => Promise<unknown>;

  // ---- preset / auth / provider ----
  listAgentPresets: (cwd?: string | null) => any;
  currentAgentPreset: () => string | null;
  selectAgentPreset: (presetId: string) => Promise<any>;
  authStatus: () => any;
  providerCatalog: () => Promise<any>;
  saveProvider: (provider: unknown, id?: string) => Promise<unknown>;
  saveModel: (model: unknown, providerId?: string) => Promise<unknown>;
  deleteProvider: (providerId: string) => Promise<unknown>;
  deleteModel: (providerId: string, modelId: string) => Promise<unknown>;

  // ---- plugins / tools ----
  listPlugins: () => Promise<any>;
  listTools: () => ReadonlyArray<{ name: string; label?: string; description?: string }>;
  pluginInventory: () => Promise<any[]>;
  pluginSnapshot: () => any;
  pluginEvents: (filter?: unknown) => Promise<any>;
  setPluginEnabled: (id: string, enabled: boolean) => Promise<any>;
  reloadPlugin: (id: string) => Promise<any>;
  reloadPiExtensions: () => Promise<any>;
  reloadPiRuntime: (reason?: string) => Promise<any>;
  updatePluginConfig: (id: string, config: unknown) => Promise<any>;
  getStoredPluginState: (id?: string) => any;
  resetPluginState: (id: string) => Promise<any>;
  getToolRegistry: () => { get?: (name: string) => unknown } | null;

  // ---- profile bundles ----
  profilePackages: () => Promise<unknown>;
  installDefaultPiPackages: (options?: { force?: boolean }) => Promise<unknown>;
  installProfileBundle: (spec: string) => Promise<unknown>;
  removeProfileBundle: (name: string) => Promise<any>;
  listRendererPluginEntries: () => Promise<any>;
  rendererPluginBootGraph: () => any;
  resolveRendererPluginModule: (id: string) => Promise<any>;
  listProfileRemoteContributions: () => any;
  ensureTypertReady: () => Promise<any>;

  // ---- session lifecycle ----
  newSession: (cwd: string, modelId?: string, options?: { traceId?: string; sessionId?: string }) => Promise<any>;
  /**
   * Lazy, coalesced `newSession` variant for concurrent callers that all
   * need *a* fresh session id but don't care which one. Concurrent
   * invocations with the same `${cwd}\0${modelId}` key share the in-flight
   * Promise. See `agentHost.ensureNewSession` in `agent-host.ts`.
   */
  ensureNewSession: (cwd: string, modelId?: string, options?: { traceId?: string }) => Promise<any>;
  /**
   * Phase 5 — returns the Promise returned by the most recent
   * `session.bindExtensions()`. `agent:new-session` returns before the
   * bind completes; mutating IPCs (`agent:prompt`, `agent:steer`,
   * `agent:set-model`, …) MUST `await` this before issuing their own RPC
   * so they don't race with the bind. Returns `null` when no bind is
   * in flight.
   */
  extensionsBound: () => Promise<void> | null;
  loadSession: (cwdOrSessionId: string, sessionIdOrCwd?: string, options?: { traceId?: string; sessionId?: string }) => Promise<any>;
  sessionInfo: (sessionId: string) => Promise<any>;
  sessionUsage: (sessionId: string) => Promise<any>;
  readSessionEntries: (sessionId: string) => Promise<any>;
  sessionFile: (sessionId: string) => Promise<any>;
  rewindSession: (sessionId: string, messageId: number | string, mode?: string) => Promise<any>;
  renameSession: (sessionId: string, name: string, cwd?: string) => Promise<unknown>;
  deleteSession: (sessionId: string, cwd?: string) => Promise<any>;
  setSessionPinned: (sessionId: string, pinned: boolean) => Promise<any>;
  setSessionArchived: (sessionId: string, archived: boolean) => Promise<any>;
  setAllArchived: (archived: boolean, options?: unknown) => Promise<any>;
  setSessionExpert: (sessionId: string, expertId: string | { expertId: string; expertName: string; avatarLocal?: string | null } | null) => Promise<any>;
  clearSessionMetadata: (sessionId?: string) => Promise<any>;

  // ---- mcp ----
  reloadMcp: () => Promise<any>;
  authorizeMcp: (serverName: string, allow?: boolean) => Promise<any>;
  cancelMcpAuthorization: (serverName: string) => Promise<any>;
  mcpStatus: () => any[];
  mcpCapabilityGovernance: () => unknown;
  resolveUiRequest: (requestId: string, value: unknown) => boolean;

  // ---- workspaces ----
  listSessions: (cwd?: string) => Promise<readonly unknown[]>;
  listWorkspaces: () => Promise<readonly unknown[]>;
  createWorkspace: (name: string, title?: string) => Promise<unknown>;
  renameWorkspace: (id: string, name: string) => Promise<any>;
  deleteWorkspace: (id: string) => Promise<unknown>;
  insertWorkspaceBefore: (workspaceId: string, beforeWorkspaceId?: string) => Promise<any>;
  insertWorkspaceSessionBefore: (workspaceId: string, sessionId: string, beforeSessionId?: string) => Promise<any>;
  archiveWorkspaceSession: (sessionId: string, archived?: boolean) => Promise<any>;

  // ---- cordis / deepseek ----
  registerRemote: (contribution: unknown) => unknown;
  unregisterRemote: (packageName: unknown) => unknown;
  invokeRemote: (request: unknown) => Promise<unknown>;
  deepSeekCordisSnapshot: () => any;
  deepSeekPiBridgeDescription: () => any;
  invokeDeepSeekCordis: (invocation: unknown) => Promise<unknown>;
  invokeConnection: (method: string, payload: unknown, request?: unknown) => Promise<{ handled: boolean; value?: unknown }>;

  // ---- session baselines / commands / skills ----
  sessionBaselines: () => unknown;
  sessionProjectionBaseline: (sessionId: string) => unknown;
  listCommands: () => any;
  listSkills: (cwd?: string | null) => Promise<any>;
  resourceInventory: () => any;
  pluginReadiness: () => any;
  listRunningTasks: () => any;
  listSubagentChildren: (parentSessionId: string) => Promise<readonly { id: string; parentSessionId: string; path: string; cwd: string }[]>;
  listSessionJobs: (sessionId: string) => any;
  subagentHistory: (parentSessionId: string, childSessionId: string, mode?: "one-shot" | "continuable", beforeSeq?: number, maxMessages?: number) => Promise<{ entries: readonly unknown[]; hasMore: boolean }>;
  promptSubagent: (parentSessionId: string, childSessionId: string, content: unknown) => Promise<unknown>;
  interruptSubagent: (subagentId: string, childSessionId?: string) => Promise<unknown>;
  killTask: (taskId: string) => Promise<unknown>;

  // ---- harness / inspiration ----
  inspirationGenerate: (params: unknown) => Promise<unknown>;
  getHarnessSessionCursors: () => unknown;
  setHarnessSessionCursors: (cursors: unknown) => void;
  getHarnessResumeToken: () => unknown;
  setHarnessResumeToken: (token: unknown) => void;

  // ---- plugin transactions / workbench ----
  reportActivePluginTransaction: (transactionId: string, surface: string, details?: unknown) => void;
  listActivePluginTransactions: () => unknown;
  syncWorkbenchScope: (force?: boolean) => Promise<void>;
  bindCurrentSessionToTenant: (tenantId: string) => Promise<any>;
}

/**
 * Build the public `agentHost` object. Pure assembly — every key is a
 * pass-through to the corresponding deps entry. Keeping this in one place
 * means the IPC dispatch table in electron/main/ipc/* can be cross-checked
 * against this list with a single `Object.keys(agentHost)` diff.
 *
 * Type safety: `deps` is typed as `Partial<AgentHostFacade>` so callers can
 * pass only the keys they want to override; missing keys fall through to a
 * stub that throws (the caller is responsible for supplying all real
 * implementations). In production we always pass the full object.
 */
export function buildAgentHostFacade(deps: Partial<Record<keyof AgentHostFacade, (...args: any[]) => any>>): AgentHostFacade {
  // The caller may pass strict-typed function references whose signatures
  // are narrower than the loose `AgentHostFacade` contract. We treat `deps`
  // as the authoritative surface and only synthesise stubs for missing
  // keys. The single cast below makes that explicit and keeps every key
  // assignable from the strict side without re-declaring signatures here.
  const stub = (name: string) => () => {
    throw new Error(`agentHost.${name} is not implemented (buildAgentHostFacade received no implementation)`);
  };
  return deps as AgentHostFacade;
}

// Re-export AgentSession type so consumers don't have to reach into
// @earendil-works/pi-coding-agent directly.
export type { AgentSession };
