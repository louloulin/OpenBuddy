/**
 * bootstrap/wire-dsh-services.ts — single helper that wires the DSH
 * (DeepSeek-Host) service cluster into the Cordis context after
 * wireContextServices() in agent-host.ts:initialize().
 *
 * Phase 8.3 §39: the DSH cluster is ~188 lines of:
 *   - state maps (dshGoalState, dshFeedbackState)
 *   - helper closures (sessionKey, dshGoal, dshFeedback)
 *   - dshHostRunner instance (createDshHostRunner with inventory/invoke/stop/undefine)
 *   - two context.provide blocks: "dshRemotes" (commands, goals, file refs,
 *     plugin inventory, message feedback, session reference resolver,
 *     dynamic-cordis-runner shims) and "dshRemote" (remote dispatcher facade)
 *
 * All of this is purely DeepSeek-compat surface and has no Pi-native
 * counterpart. Extracting it lets agent-host.ts:initialize() read as
 * orchestration rather than as a giant plugin-compat layer.
 *
 * Reverse-dependency invariant:
 *   This module imports nothing from agent-host. All dependencies flow
 *   through the WireDshServicesDeps interface.
 */
import type { Context } from "@openbuddy/cordis";
import type { AgentHostState } from "../_state-shape";
import { serializeRemoteContribution } from "@openbuddy/plugin-host";
import { createDshHostRunner } from "../../../deepseek/dsh-host-runner";

/**
 * Minimal read-only surface the DSH cluster needs from outside.
 * Anything that lives in `state` is read on-demand (no snapshot).
 */
export interface WireDshServicesDeps {
  context: Context;
  state: AgentHostState;
  cwd: string;

  // Read-only helpers (resolved on every call so plugin install/remove
  // doesn't go stale between initialize() and the first plugin usage).
  listCommands: () => Array<{ name: string }>;
  listPluginInventory: () => unknown;
  listPlugins: () => Array<{ id: string; name: string }>;
  listDshFileReferences: (cwd: string, query: string) => unknown;
  listSessions: (cwd: string) => Promise<Array<{
    sessionId: string;
    title?: string;
    cwd?: string;
    updatedAt: string;
  }>>;
  listRunningTasks: () => unknown;
  killTask: (taskId: string) => unknown;

  // Remote dispatcher helpers
  remoteServiceContext: () => any;
  transitionDshGoal: (goal: unknown, ref: unknown, phase: unknown) => unknown;
}

/**
 * Goal shape stored in the local dshGoalState Map. Mirrors the original
 * inline type literal that lived in agent-host.ts.
 */
interface DshGoalRecord {
  id: string;
  revision: number;
  objective: string;
  phase: "active" | "paused" | "blocked" | "complete";
  roundsStarted: number;
  maxGoalRounds: number;
  activation: "armed" | "disarmed";
  blockedReason?: { code: string; message: string };
}

/**
 * Message-feedback entry stored in the local dshFeedbackState Map.
 */
interface DshFeedbackEntry {
  rating: string;
  note?: string;
  version: number;
}

/**
 * Wire the DSH cluster (dshRemotes + dshRemote) into the Cordis context.
 * Owns its own private state (dshGoalState, dshFeedbackState, sessionKey).
 */
export function wireDshServices(deps: WireDshServicesDeps): void {
  const { context, state, cwd } = deps;

  // ---------- private state ----------
  const dshGoalState = new Map<string, DshGoalRecord>();
  const dshFeedbackState = new Map<string, Map<string, DshFeedbackEntry>>();
  const sessionKey = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") return (value as { id: string }).id;
    if (value && typeof value === "object" && typeof (value as { sessionId?: unknown }).sessionId === "string") return (value as { sessionId: string }).sessionId;
    return state.session?.sessionId ?? "current";
  };
  const dshGoal = (value: unknown): DshGoalRecord | undefined => dshGoalState.get(sessionKey(value));
  const dshFeedback = (value: unknown): Map<string, DshFeedbackEntry> => {
    const key = sessionKey(value);
    const entries = dshFeedbackState.get(key) ?? new Map<string, DshFeedbackEntry>();
    dshFeedbackState.set(key, entries);
    return entries;
  };

  // ---------- dshHostRunner ----------
  const dshHostRunner = createDshHostRunner({
    inventory: async () => {
      const inventory = (await deps.listPluginInventory()) as {
        entries: Array<{ id: string; name: string; state: string; error?: string }>;
        piExtensions: Array<{ id: string; name: string; state: string; mode?: string; adapter?: string; error?: string }>;
        packages: Array<{ name: string; bundle?: unknown; client?: unknown; pi?: unknown; remote?: unknown; typert?: unknown }>;
        renderers: unknown;
      };
      return {
        packages: [
          ...inventory.entries.map((plugin) => ({
            id: plugin.id,
            name: plugin.name,
            kind: "cordis" as const,
            state: plugin.state,
            ...(plugin.error ? { error: plugin.error } : {}),
          })),
          ...inventory.piExtensions.map((extension) => ({
            id: extension.id,
            name: extension.name,
            kind: "pi" as const,
            state: extension.state,
            ...(extension.mode ? { mode: extension.mode } : {}),
            ...(extension.adapter ? { adapter: extension.adapter } : {}),
            ...(extension.error ? { error: extension.error } : {}),
          })),
          ...inventory.packages.map((pkg) => ({
            id: pkg.name,
            name: pkg.name,
            kind: "package" as const,
            state: "loaded" as const,
            capabilities: [
              ...(pkg.bundle ? ["bundle"] : []),
              ...(pkg.client ? ["renderer"] : []),
              ...(pkg.pi ? ["pi"] : []),
              ...(pkg.remote ? ["remote"] : []),
              ...(pkg.typert ? ["typert"] : []),
            ],
          })),
        ],
        renderers: inventory.renderers,
        remotes: state.remoteDispatcher.list(),
        tasks: deps.listRunningTasks(),
      };
    },
    invoke: (request: unknown) => state.remoteDispatcher.invoke(request, state.context),
    stop: (taskId: string) => deps.killTask(taskId) as any,
    undefine: async (definitionId: string) => {
      const remote = state.remoteDispatcher.unregister(definitionId);
      if (remote.removed) return { ok: true, id: definitionId, kind: "remote" };
      const plugin = deps.listPlugins().find((entry) => entry.id === definitionId || entry.name === definitionId);
      if (!plugin || !state.loader) return { ok: false, code: "not-found", id: definitionId };
      await state.loader.remove(plugin.id);
      return { ok: true, id: plugin.id, kind: "plugin" };
    },
  });

  // ---------- context.provide("dshRemotes", ...) ----------
  context.provide("dshRemotes", {
    commandsList: (_agent?: unknown) => deps.listCommands(),
    commandsFind: (_agent: unknown, name: string) => {
      if (typeof name !== "string" || name.length === 0) return undefined;
      return deps.listCommands().find((command) => command.name === name) ?? undefined;
    },
    commandsParseCommand: (line: string) => {
      // Mirror @deepseek-ai/dsh-commands parseCommand grammar: leading slash,
      // name starts with a lowercase letter followed by [a-z0-9_-]*, then
      // either end-of-input or a single whitespace separator. rawInput is
      // the verbatim remainder after the matched prefix with any leading
      // whitespace stripped so downstream consumers do not need to trim.
      if (typeof line !== "string") return undefined;
      const match = /^\/([a-z][a-z0-9_-]*)/u.exec(line);
      if (match === null) return undefined;
      const name = match[1];
      if (name === undefined) return undefined;
      const rest = line.slice(match[0].length);
      if (rest.length > 0 && !/^[\t\n\r ]/u.test(rest)) return undefined;
      return Object.freeze({ name, rawInput: rest.replace(/^[\t\n\r ]+/u, "") });
    },
    commandsExecute: async (_agent: unknown, input: string, _images: unknown[] = []) => {
      const line = input.trim().replace(/^\/+/, "");
      const [name, ...rest] = line.split(/\s+/);
      const session = state.session;
      if (!session) return undefined;
      const command = session.extensionRunner.getCommand(name);
      if (!command) return undefined;
      await command.handler(rest.join(" "), session.extensionRunner.createCommandContext());
      return { commandId: `pi-command-${Date.now()}`, result: { kind: "success" } };
    },
    goalsCreate: async (agent: unknown, request: { objective?: string; maxGoalRounds?: number }) => {
      const current = dshGoal(agent);
      if (current && current.phase !== "complete") throw new Error("goal already exists");
      const goal: DshGoalRecord = {
        id: `goal-${Date.now()}`,
        revision: 1,
        objective: String(request?.objective ?? "").trim(),
        phase: "active",
        roundsStarted: 0,
        maxGoalRounds: Number.isSafeInteger(request?.maxGoalRounds) && (request.maxGoalRounds ?? 0) > 0 ? request.maxGoalRounds! : 3,
        activation: "armed",
      };
      if (!goal.objective) throw new Error("goal objective must be non-empty");
      dshGoalState.set(sessionKey(agent), goal);
      return { ref: { id: goal.id, revision: goal.revision } };
    },
    goalsGet: async (agent: unknown) => dshGoal(agent) ? { ...dshGoal(agent) } : undefined,
    goalsEdit: async (agent: unknown, ref: { id?: string; revision?: number }, patch: { objective?: string }) => {
      const goal = dshGoal(agent);
      if (!goal || goal.id !== ref?.id || goal.revision !== ref?.revision) throw new Error("goal revision conflict");
      goal.revision += 1;
      if (patch?.objective !== undefined) {
        goal.objective = patch.objective.trim();
        if (!goal.objective) throw new Error("goal objective must be non-empty");
      }
      return { ...goal };
    },
    goalsPause: async (agent: unknown, ref: { id?: string; revision?: number }) => deps.transitionDshGoal(dshGoal(agent), ref, "paused"),
    goalsResume: async (agent: unknown, ref: { id?: string; revision?: number }) => deps.transitionDshGoal(dshGoal(agent), ref, "active"),
    goalsComplete: async (agent: unknown, ref: { id?: string; revision?: number }) => deps.transitionDshGoal(dshGoal(agent), ref, "complete"),
    goalsBlocked: async (agent: unknown, ref: { id?: string; revision?: number }, reason: string) => {
      const goal = dshGoal(agent);
      const next = deps.transitionDshGoal(goal, ref, "blocked") as DshGoalRecord | undefined;
      if (next) next.blockedReason = { code: "MODEL_REPORTED_BLOCKED", message: String(reason).trim() };
      return next;
    },
    goalsClear: async (agent: unknown, ref: { id?: string; revision?: number }) => {
      const goal = dshGoal(agent);
      if (!goal || goal.id !== ref?.id || goal.revision !== ref?.revision) throw new Error("goal revision conflict");
      dshGoalState.delete(sessionKey(agent));
      return { id: goal.id, revision: goal.revision + 1 };
    },
    fileReferencesList: async (agent: unknown, query = "") => deps.listDshFileReferences(state.cwd ?? cwd, String(query)),
    pluginInventoryList: () => deps.listPluginInventory(),
    messageFeedbackList: async (request: { sessionId?: string }) =>
      [...dshFeedback(request?.sessionId).entries()].map(([messageId, value]) => ({ messageId, ...value })),
    messageFeedbackPut: async (request: { sessionId?: string; messageId: string; rating: string; note?: string; ifVersion?: number | null }) => {
      const entries = dshFeedback(request?.sessionId);
      const previous = entries.get(request.messageId);
      if ((request.ifVersion ?? null) !== (previous?.version ?? null)) throw new Error("feedback version conflict");
      const value: DshFeedbackEntry = {
        rating: request.rating,
        ...(request.note ? { note: request.note } : {}),
        version: (previous?.version ?? 0) + 1,
      };
      entries.set(request.messageId, value);
      return { ...value, messageId: request.messageId };
    },
    messageFeedbackDelete: async (request: { sessionId?: string; messageId: string; ifVersion?: number | null }) => {
      const entries = dshFeedback(request?.sessionId);
      const previous = entries.get(request.messageId);
      if (!previous) return { absent: true };
      if (request.ifVersion !== previous.version) throw new Error("feedback version conflict");
      entries.delete(request.messageId);
      return { absent: false };
    },
    sessionReferenceResolverCandidates: async (_agent: unknown, query = "") => {
      const rows = await deps.listSessions(state.cwd ?? cwd);
      const needle = String(query).toLowerCase();
      return rows
        .filter((row) => !needle || `${row.sessionId} ${row.title ?? ""} ${row.cwd ?? ""}`.toLowerCase().includes(needle))
        .map((row) => ({
          sessionId: row.sessionId,
          label: row.title,
          cwd: row.cwd,
          createdAt: Date.parse(row.updatedAt) || Date.now(),
          mention: `@[${row.title}](dsh-session:${row.sessionId})`,
        }));
    },
    inventory: dshHostRunner.inventory,
    invoke: dshHostRunner.invoke,
    stopFromPanel: dshHostRunner.stopFromPanel,
    undefineFromPanel: dshHostRunner.undefineFromPanel,
    define: async () => { throw new Error("dynamicCordisRunner/define is not available in the OpenBuddy host adapter"); },
    undefine: dshHostRunner.undefineFromPanel,
    runHostHalf: async () => { throw new Error("dynamicCordisRunner/runHostHalf is not available in the OpenBuddy host adapter"); },
    getClientCode: async () => { throw new Error("dynamicCordisRunner/getClientCode is not available in the OpenBuddy host adapter"); },
    resolveRequestRun: async () => { throw new Error("dynamicCordisRunner/resolveRequestRun is not available in the OpenBuddy host adapter"); },
    settleUserRun: async () => { throw new Error("dynamicCordisRunner/settleUserRun is not available in the OpenBuddy host adapter"); },
    stop: async (request: unknown) => request === undefined || request === null ? undefined : dshHostRunner.stopFromPanel(request),
    syncInspectManifest: async () => { throw new Error("dynamicCordisRunner/syncInspectManifest is not available in the OpenBuddy host adapter"); },
    resolveInspectQuery: async () => { throw new Error("dynamicCordisRunner/resolveInspectQuery is not available in the OpenBuddy host adapter"); },
    reportRenderFailure: async () => null,
    reportClientGuardFailure: async () => null,
  });

  // ---------- context.provide("dshRemote", ...) ----------
  // The remote dispatcher facade lets plugins register/unregister remote
  // services through Cordis rather than calling the dispatcher directly.
  // `register()` wraps `serializeRemoteContribution()` to normalize the
  // contribution shape across package boundaries.
  const remoteServiceContext = (): unknown => deps.remoteServiceContext() as any;
  context.provide("dshRemote", {
    register: (contribution: unknown) => {
      const packageName = contribution && typeof contribution === "object" && !Array.isArray(contribution)
        ? (contribution as { package?: unknown }).package
        : undefined;
      const result = state.remoteDispatcher.register(serializeRemoteContribution(contribution), remoteServiceContext() as any);
      return () => {
        if (typeof packageName === "string") state.remoteDispatcher.unregister(packageName);
        return result;
      };
    },
    unregister: (packageName: unknown) => state.remoteDispatcher.unregister(packageName),
    invoke: (request: unknown) => state.remoteDispatcher.invoke(request, remoteServiceContext() as any),
    list: () => state.remoteDispatcher.list(),
    get: (endpoint: string) => state.remoteDispatcher.describe(endpoint),
    descriptors: () => state.remoteDispatcher.describeAll(),
  });
}
