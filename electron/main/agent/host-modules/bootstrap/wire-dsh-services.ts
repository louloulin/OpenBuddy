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
 * Phase B.3 step 2b — the goal / message-feedback state machines are
 * now consumed from `@openbuddy/dsh-core/state`. The Cordis shim here
 * re-exposes them via `ctx.get("dshRemotes")` for legacy DSH plugins +
 * deepseek-compat tests + `deepseek-capabilities.ts` (which builds the
 * 7 `@deepseek-ai/dsh-*` capability services from the remotes table).
 *
 * State ownership: `dshGoalState` and `dshFeedbackState` are
 * module-scope Maps in `@openbuddy/dsh-core/state`, shared with the
 * PI extensions `createDshGoalsExtension()` and
 * `createDshMessageFeedbackExtension()`. Reading via `ctx.dshRemotes`
 * and writing via `pi.registerCommand("goals.*")` see identical data.
 *
 * Reverse-dependency invariant: this module imports nothing from agent-host.
 */
import type { Context } from "@openbuddy/cordis";

import {
  blockGoal,
  clearGoal,
  createGoal,
  editGoal,
  getGoal,
  listFeedbackEntries,
  putFeedbackEntry,
  deleteFeedbackEntry,
  transitionGoal,
  type DshGoalRecord,
  type DshFeedbackEntry,
} from "@openbuddy/dsh-core/state";

import type { AgentHostState } from "../_state-shape";

/**
 * Phase B.3 step 2b — the transition helper is no longer injected as a
 * dep. The transition logic lives in `@openbuddy/dsh-core/state.ts`
 * (see `transitionGoal`) and is shared with the PI extensions. The
 * shim still exposes `goalsPause / goalsResume / goalsComplete` via
 * `ctx.get("dshRemotes")` for legacy capability services that pass
 * `state.context.inject = ["dshRemotes"]`.
 *
 * Kept here for compatibility with downstream callers that still
 * introspect the dependency shape (e.g., `init-pipeline-builder.ts`).
 */
export interface WireDshServicesDeps {
  context: Context;
  state: AgentHostState;
  transitionDshGoal?: (
    goal: DshGoalRecord | undefined,
    ref: { id?: string; revision?: number } | undefined,
    phase: "active" | "paused" | "blocked" | "complete",
  ) => DshGoalRecord | undefined;
}

/**
 * Goal shape stored in the shared dshGoalState Map (re-export for
 * downstream consumers that import this module directly).
 */
export type { DshGoalRecord, DshFeedbackEntry };

/**
 * Wire the DSH goal + message-feedback state machines into the Cordis context.
 * The actual state lives in `@openbuddy/dsh-core/state` (shared with the
 * PI extensions). This shim only registers the legacy `dshRemotes`
 * surface so `deepseek-capabilities.ts` can keep building the 7
 * `@deepseek-ai/dsh-*` capability services from `ctx.get("dshRemotes")`.
 */
export function wireDshServices(deps: WireDshServicesDeps): void {
  const { context } = deps;

  context.provide("dshRemotes", {
    goalsCreate: async (agent: unknown, request: { objective?: string; maxGoalRounds?: number }) =>
      createGoal(agent, "current", request),
    goalsGet: async (agent: unknown) => getGoal(agent, "current"),
    goalsEdit: async (agent: unknown, ref: { id?: string; revision?: number }, patch: { objective?: string }) =>
      editGoal(agent, "current", ref, patch),
    goalsPause: async (agent: unknown, ref: { id?: string; revision?: number }) =>
      transitionGoal(agent, "current", ref, "paused"),
    goalsResume: async (agent: unknown, ref: { id?: string; revision?: number }) =>
      transitionGoal(agent, "current", ref, "active"),
    goalsComplete: async (agent: unknown, ref: { id?: string; revision?: number }) =>
      transitionGoal(agent, "current", ref, "complete"),
    goalsBlocked: async (agent: unknown, ref: { id?: string; revision?: number }, reason: string) =>
      blockGoal(agent, "current", ref, reason),
    goalsClear: async (agent: unknown, ref: { id?: string; revision?: number }) =>
      clearGoal(agent, "current", ref),
    messageFeedbackList: async (request: { sessionId?: string }) =>
      listFeedbackEntries(request, "current"),
    messageFeedbackPut: async (request: {
      sessionId?: string;
      messageId: string;
      rating: string;
      note?: string;
      ifVersion?: number | null;
    }) => putFeedbackEntry(request, "current"),
    messageFeedbackDelete: async (request: { sessionId?: string; messageId: string; ifVersion?: number | null }) =>
      deleteFeedbackEntry(request, "current"),
  });
}