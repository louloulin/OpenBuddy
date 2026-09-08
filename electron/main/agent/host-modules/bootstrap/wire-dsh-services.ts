/**
 * bootstrap/wire-dsh-services.ts — DSH (DeepSeek-Host) state-machine helpers.
 *
 * Phase L.4 — strip the boot-time DSH service cluster down to the only state
 * that survives after `initialize()`: the per-session DSH goal / message
 * feedback records. Everything else (commands list/parse, file references,
 * inventory / invoke / stopFromPanel / undefineFromPanel) moved to PI:
 *   - commands*: `session.extensionRunner.getCommand()` (PI ExtensionRunner)
 *   - fileReferences: `listDshFileReferences` helper, not a bootstrap concern
 *   - pluginInventory / runHostHalf / define / undefine: PI plugin runtime
 *
 * The remaining surface (`goalsGet / goalsCreate / goalsEdit / goalsPause /
 * goalsResume / goalsComplete / goalsBlocked / goalsClear /
 * messageFeedbackList / messageFeedbackPut / messageFeedbackDelete`) is
 * consumed via `ctx.get("dshRemotes")` by DeepSeek-compat plugins and tests.
 *
 * Reverse-dependency invariant: this module imports nothing from agent-host.
 */
import type { Context } from "@openbuddy/cordis";
import type { AgentHostState } from "../_state-shape";

/**
 * Minimal deps for the goal + feedback state machines. Everything that used
 * to live here (commands list, plugin inventory, running tasks, ...) has been
 * hoisted out and resolved lazily via PI runtime surfaces.
 */
export interface WireDshServicesDeps {
  context: Context;
  state: AgentHostState;
  transitionDshGoal: (
    goal: DshGoalRecord | undefined,
    ref: { id?: string; revision?: number } | undefined,
    phase: "active" | "paused" | "blocked" | "complete",
  ) => DshGoalRecord | undefined;
}

/**
 * Goal shape stored in the local dshGoalState Map.
 */
export interface DshGoalRecord {
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
export interface DshFeedbackEntry {
  rating: string;
  note?: string;
  version: number;
}

/**
 * Wire the DSH goal + message-feedback state machines into the Cordis context.
 * Owns its own private state maps (dshGoalState, dshFeedbackState).
 */
export function wireDshServices(deps: WireDshServicesDeps): void {
  const { context, state } = deps;

  const dshGoalState = new Map<string, DshGoalRecord>();
  const dshFeedbackState = new Map<string, Map<string, DshFeedbackEntry>>();
  const sessionKey = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
      return (value as { id: string }).id;
    }
    if (value && typeof value === "object" && typeof (value as { sessionId?: unknown }).sessionId === "string") {
      return (value as { sessionId: string }).sessionId;
    }
    return state.session?.sessionId ?? "current";
  };
  const dshGoal = (value: unknown): DshGoalRecord | undefined => dshGoalState.get(sessionKey(value));
  const dshFeedback = (value: unknown): Map<string, DshFeedbackEntry> => {
    const key = sessionKey(value);
    const entries = dshFeedbackState.get(key) ?? new Map<string, DshFeedbackEntry>();
    dshFeedbackState.set(key, entries);
    return entries;
  };

  context.provide("dshRemotes", {
    goalsCreate: async (agent: unknown, request: { objective?: string; maxGoalRounds?: number }) => {
      const current = dshGoal(agent);
      if (current && current.phase !== "complete") throw new Error("goal already exists");
      const goal: DshGoalRecord = {
        id: `goal-${Date.now()}`,
        revision: 1,
        objective: String(request?.objective ?? "").trim(),
        phase: "active",
        roundsStarted: 0,
        maxGoalRounds:
          Number.isSafeInteger(request?.maxGoalRounds) && (request.maxGoalRounds ?? 0) > 0
            ? (request.maxGoalRounds as number)
            : 3,
        activation: "armed",
      };
      if (!goal.objective) throw new Error("goal objective must be non-empty");
      dshGoalState.set(sessionKey(agent), goal);
      return { ref: { id: goal.id, revision: goal.revision } };
    },
    goalsGet: async (agent: unknown) => (dshGoal(agent) ? { ...dshGoal(agent) } : undefined),
    goalsEdit: async (agent: unknown, ref: { id?: string; revision?: number }, patch: { objective?: string }) => {
      const goal = dshGoal(agent);
      if (!goal || goal.id !== ref?.id || goal.revision !== ref?.revision) {
        throw new Error("goal revision conflict");
      }
      goal.revision += 1;
      if (patch?.objective !== undefined) {
        goal.objective = patch.objective.trim();
        if (!goal.objective) throw new Error("goal objective must be non-empty");
      }
      return { ...goal };
    },
    goalsPause: async (agent: unknown, ref: { id?: string; revision?: number }) =>
      deps.transitionDshGoal(dshGoal(agent), ref, "paused"),
    goalsResume: async (agent: unknown, ref: { id?: string; revision?: number }) =>
      deps.transitionDshGoal(dshGoal(agent), ref, "active"),
    goalsComplete: async (agent: unknown, ref: { id?: string; revision?: number }) =>
      deps.transitionDshGoal(dshGoal(agent), ref, "complete"),
    goalsBlocked: async (agent: unknown, ref: { id?: string; revision?: number }, reason: string) => {
      const next = deps.transitionDshGoal(dshGoal(agent), ref, "blocked");
      if (next) next.blockedReason = { code: "MODEL_REPORTED_BLOCKED", message: String(reason).trim() };
      return next;
    },
    goalsClear: async (agent: unknown, ref: { id?: string; revision?: number }) => {
      const goal = dshGoal(agent);
      if (!goal || goal.id !== ref?.id || goal.revision !== ref?.revision) {
        throw new Error("goal revision conflict");
      }
      dshGoalState.delete(sessionKey(agent));
      return { id: goal.id, revision: goal.revision + 1 };
    },
    messageFeedbackList: async (request: { sessionId?: string }) =>
      [...dshFeedback(request?.sessionId).entries()].map(([messageId, value]) => ({ messageId, ...value })),
    messageFeedbackPut: async (request: {
      sessionId?: string;
      messageId: string;
      rating: string;
      note?: string;
      ifVersion?: number | null;
    }) => {
      const entries = dshFeedback(request?.sessionId);
      const previous = entries.get(request.messageId);
      if ((request.ifVersion ?? null) !== (previous?.version ?? null)) {
        throw new Error("feedback version conflict");
      }
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
  });
}