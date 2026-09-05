/**
 * bootstrap/wire-context-services.ts — single helper that wires every
 * "core services" context.provide() call after installHostModules() in
 * agent-host.ts:initialize().
 *
 * Phase 8.3 §38: the host's Cordis context exposes ~30 services to plugins
 * (jobs, agentHost, pi, piAgent, piSession, terminals, subprocess, sandbox,
 *  modelRuntime, hookShell, toolRegistry, mcpResources, piResources,
 *  teamRunner, collaborationRuntimeBridge, dshRemotes, dshRemote, ...).
 * Half of those (the "core" cluster) are pure declarative registrations —
 * no inline closure state, no per-call setup. They belong in one helper so
 * agent-host.ts:initialize() reads as orchestration, not registration.
 *
 * The DSH cluster (dshRemotes, dshRemote, dshGoalState, dshFeedbackState)
 * stays inline in agent-host.ts because it owns large Maps and per-session
 * closures that aren't natural to pass through a deps interface.
 *
 * Reverse-dependency invariant:
 *   This module imports nothing from agent-host. All dependencies come
 *   through the WireContextServicesDeps parameter, which carries the
 *   closures and helpers that used to be inline.
 */
import type { Context } from "@openbuddy/cordis";
import type { ModelRuntime, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentHostState } from "../_state-shape";
import type { TeamRunner } from "@openbuddy/team-team";
import type { HarnessSubagentEntry } from "../subagent-runtime";
import { createTerminalService, type TerminalRuntime } from "../../../deepseek/terminal-runtime";
import { SandboxPolicyService, SandboxRuntime, SubprocessRuntime } from "../../../deepseek/subprocess-runtime";
import { DefaultHookShellRunner } from "../../agent-hooks";
import { readPersistedSessionEntries as readPersistedSessionEntriesImpl } from "../session-store";
import {
  listPersistedSessionHeaders as readPersistedSessionHeadersImpl,
  listPersistedSessionInfos as listPersistedSessionInfosImpl,
  readPersistedSessionHeader as readPersistedSessionHeaderImpl,
  readPersistedSessionRaw as readPersistedSessionRawImpl,
  readPersistedSessionRevision as readPersistedSessionRevisionImpl,
  appendPersistedSessionEntries as appendPersistedSessionEntriesImpl,
  appendPersistedSessionEntry as appendPersistedSessionEntryImpl,
  appendLifecycleSessionEntry as appendLifecycleSessionEntryImpl,
  createPersistedSession as createPersistedSessionImpl,
} from "../session-store";
import {
  reserveDeepSeekAgent,
  reserveDeepSeekPreparation,
  createDeepSeekAgent,
  resumeDeepSeekAgent,
} from "../deepseek/agent-runtime";
import { sessionInfo, sessionUsage } from "../session-store";
import { listWorkspaces } from "../workbench-scope";
import { runMcpAuthorization } from "../mcp-runtime";
import * as piResources from "../../pi-resources";

/**
 * Dependencies required to wire the core services. Everything that used to
 * be a closure variable in agent-host.ts:initialize() is collected here.
 *
 * NOTE: deliberately excluded from this interface:
 *   - dshGoalState / dshFeedbackState / dshRemotes / dshRemote — these need
 *     large inline closures and stay inline in agent-host.ts for clarity.
 *   - state.session / state.model — read on demand via closures so deps
 *     don't have to be re-passed when state changes.
 */
export interface WireContextServicesDeps {
  // Path helpers
  cwd: string;
  // State + Cordis context
  state: AgentHostState;
  context: Context;
  // Core runtimes already constructed by the install pipeline
  modelRuntime: ModelRuntime;
  piRuntime: AgentHostState["session"] extends never ? never : unknown;
  piSession: unknown;
  // Jobs registry facade (built above the install call site)
  jobs: {
    register: (job: { id: string; sessionId?: string; [k: string]: unknown }) => () => void;
    update: (id: string, patch: Record<string, unknown>) => void;
    list: (sessionId?: string) => unknown[];
    get: (id: string) => unknown;
  };
  // IPC-exposed agent actions (forwarded to context.provide("agentHost", ...))
  prompt: (text: string, options?: { traceId?: string; sessionId?: string }) => Promise<unknown>;
  steer: (...args: unknown[]) => Promise<unknown>;
  followUp: (...args: unknown[]) => Promise<unknown>;
  abort: (options?: { traceId?: string; sessionId?: string }) => Promise<unknown>;
  getModel: () => unknown;
  setModel: (...args: unknown[]) => Promise<unknown>;
  newSession: (...args: unknown[]) => Promise<unknown>;
  loadSession: (...args: unknown[]) => Promise<unknown>;
  listSessions: (...args: unknown[]) => Promise<unknown>;
  // Session metadata helpers
  listAllPiSessions: () => Promise<unknown[]>;
  listPersistedSessionHeadersImpl: () => unknown[];
  // Persisted session helpers
  appendPersistedSessionEntriesImpl: (...args: unknown[]) => Promise<unknown>;
  appendLifecycleSessionEntryImpl: (...args: unknown[]) => Promise<unknown>;
  // DeepSeek capability bridge helpers
  reserveDeepSeekPreparation: (...args: unknown[]) => Promise<unknown>;
  reserveDeepSeekAgent: (...args: unknown[]) => Promise<unknown>;
  createDeepSeekAgent: (...args: unknown[]) => Promise<unknown>;
  resumeDeepSeekAgent: (...args: unknown[]) => Promise<unknown>;
  // Team runner factory + openbuddy-core plugin
  createTeamRunner: (modelRuntime: ModelRuntime, cwd: string, getModel: () => unknown) => TeamRunner;
  openBuddyCorePlugin: { collaborationRuntimeBridge: () => unknown };
  // Workbench scope helper (read by plugin events)
  listSubagentChildren: (parentSessionId: string) => Promise<HarnessSubagentEntry[]>;
}

/**
 * Wire the 15 "core services" into the Cordis context. Plugin contributors
 * can resolve these via `ctx.get("service-name")` or react to them via
 * `ctx.on("service-ready", ...)`.
 *
 * Order is not significant — Cordis is order-independent — but we keep the
 * historical order so plugins that relied on relative init order stay stable.
 */
export function wireContextServices(deps: WireContextServicesDeps): void {
  const { context, state, cwd, modelRuntime, piRuntime, piSession, jobs } = deps;

  context.provide("jobs", jobs);
  context.provide("agentHost", {
    getSessionId: () => state.session?.sessionId,
    prompt: deps.prompt,
    steer: deps.steer,
    followUp: deps.followUp,
    abort: deps.abort,
    getModel: deps.getModel,
    setModel: deps.setModel,
    newSession: deps.newSession,
    loadSession: deps.loadSession,
    listSessions: deps.listSessions,
    listAllSessions: deps.listAllPiSessions,
    listSessionInfos: listPersistedSessionInfosImpl,
    listSessionHeaders: deps.listPersistedSessionHeadersImpl,
    readSessionHeader: readPersistedSessionHeaderImpl,
    readSessionEntries: async (sessionId: string) => {
      if (state.session?.sessionId === sessionId) return state.session.sessionManager.getEntries();
      return readPersistedSessionEntriesImpl(sessionId);
    },
    readSessionRaw: readPersistedSessionRawImpl,
    readSessionRevision: readPersistedSessionRevisionImpl,
    appendSessionEntries: deps.appendPersistedSessionEntriesImpl,
    reservePreparation: deps.reserveDeepSeekPreparation,
    appendSessionEntry: appendPersistedSessionEntryImpl,
    appendLifecycleEntry: deps.appendLifecycleSessionEntryImpl,
    createPersistedSession: createPersistedSessionImpl,
    reserveAgent: deps.reserveDeepSeekAgent,
    createAgent: deps.createDeepSeekAgent,
    resumeAgent: deps.resumeDeepSeekAgent,
    listWorkspaces,
    sessionInfo,
    sessionUsage,
    jobs,
  });
  // Make Pi the canonical runtime service before any plugin is applied. A
  // plugin can therefore inject `pi` during startup, register tools through
  // `pi.tools`, and subscribe to the eventual `pi/ready` event without
  // depending on an initialization race.
  context.provide("pi", piRuntime);
  context.provide("piAgent", piRuntime);
  context.provide("piSession", piSession);
  const terminalRuntime: TerminalRuntime = createTerminalService();
  state.terminalRuntime = terminalRuntime;
  context.provide("terminals", terminalRuntime);
  const subprocessRuntime = new SubprocessRuntime();
  const sandboxPolicy = new SandboxPolicyService({ workspaceRoot: cwd });
  const sandboxRuntime = new SandboxRuntime(sandboxPolicy);
  state.subprocessRuntime = subprocessRuntime;
  context.provide("subprocess", subprocessRuntime);
  context.provide("sandboxPolicy", sandboxPolicy);
  context.provide("sandbox", sandboxRuntime);
  // DeepSeek-compatible services resolve the canonical Pi model catalog from
  // this stable host injection instead of constructing a second runtime.
  context.provide("modelRuntime", state.modelRuntime);
  // DeepSeek Harness-style hooks and OpenBuddy plugins share one injectable
  // shell seam. The default implementation keeps process safety in the host;
  // a trusted plugin may provide a sandboxed replacement under the same key.
  context.provide("hookShell", new DefaultHookShellRunner());
  // The raw SDK object remains available for trusted host integrations; user
  // plugins should inject `piSession` or `pi` rather than depend on Pi's
  // concrete class, which is absent during profile boot.
  context.provide("toolRegistry", state.toolRegistry);
  context.provide("mcpResources", {
    getCwd: () => state.cwd,
    readConfig: (requestedCwd?: string | null) => piResources.mcpConfigRead(requestedCwd ?? state.cwd),
    readCredential: (serverName: string, requestedCwd?: string | null) => piResources.mcpAuthCredential(serverName, requestedCwd ?? state.cwd),
    saveCredential: (serverName: string, credential: { accessToken: string; refreshToken?: string; tokenType?: string; expiresAt?: string }) => piResources.mcpAuthStoreCredential(serverName, {
      ...credential,
      ...(credential.expiresAt ? { expiresIn: Math.max(0, Math.floor((Date.parse(credential.expiresAt) - Date.now()) / 1000)) } : {}),
    }),
    authorize: (serverName: string, signal?: AbortSignal) => runMcpAuthorization(state, serverName, signal),
  });
  context.provide("piResources", {
    getCwd: () => state.cwd,
    listSkills: (requestedCwd?: string | null) => piResources.listSkills(requestedCwd ?? state.cwd),
    readSkill: (name: string, requestedCwd?: string | null) => piResources.readSkill(name, requestedCwd ?? state.cwd),
    listAgentPresets: (requestedCwd?: string | null) => piResources.listAgentPresets(requestedCwd ?? state.cwd),
    readAgentPreset: (id: string, requestedCwd?: string | null) => piResources.readAgentPreset(id, requestedCwd ?? state.cwd),
    readAgentPresetDefaults: () => piResources.readAgentPresetDefaults(),
    writeAgentPresetDefault: (id?: string) => piResources.writeAgentPresetDefault(id),
  });
  context.provide("teamRunner", deps.createTeamRunner(modelRuntime, cwd, () => state.model));
  context.provide("collaborationRuntimeBridge", deps.openBuddyCorePlugin.collaborationRuntimeBridge());
}
