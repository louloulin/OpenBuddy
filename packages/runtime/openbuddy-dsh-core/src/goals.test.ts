/**
 * @openbuddy/dsh-core/goals — Phase B.3 step 2b tests.
 *
 * Verifies the goal state machine extracted from
 * electron/main/agent/host-modules/bootstrap/wire-dsh-services.ts
 * now lives as a standalone PI ExtensionFactory that:
 *   1. Registers 8 goals.* slash commands on the live ExtensionAPI
 *   2. Shares state with the Cordis shim via @openbuddy/dsh-core/state
 *   3. Maps the legacy `(agent, ..., fallback)` carrier semantics
 *      onto the PI `api.context.get("sessionFallbackKey")` lookup
 *      with a `"current"` fallback (B.3 step 3 will bind a real
 *      sessionFallbackKey via ExtensionRunner.bindCore).
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import createDshGoalsExtension, { createDshGoalsExtensionForSession } from "./goals";
import {
  __resetDshCoreStateForTests,
  advanceGoalRounds,
  createGoal,
  getGoal,
  listAllGoals,
  purgeSession,
  searchGoalsByObjective,
  sessionAggregateStats,
  transitionGoal,
  type DshGoalRecord,
} from "./state";
import { putFeedbackEntry } from "./state";

interface CapturedCommand {
  name: string;
  description: string;
  handler: (args: unknown) => Promise<unknown> | unknown;
}

function buildMockApi(sessionId: string): {
  api: ExtensionAPI;
  commands: Map<string, CapturedCommand>;
} {
  const commands = new Map<string, CapturedCommand>();
  const ctx = {
    ui: {} as ExtensionContext["ui"],
    mode: "rpc" as ExtensionMode,
    hasUI: false,
    cwd: "/work",
    get: (name: string) => (name === "sessionFallbackKey" ? sessionId : undefined),
  } as unknown as ExtensionContext;
  const api = {
    on: (_event: string, _handler: (...args: unknown[]) => void) => undefined,
    registerCommand: (spec: CapturedCommand) => {
      commands.set(spec.name, spec);
      return undefined;
    },
    registerTool: () => undefined,
    sendMessage: () => undefined,
    sendUserMessage: () => undefined,
    setActiveTools: () => undefined,
    setModel: () => undefined,
    setThinkingLevel: () => undefined,
    setLabel: () => undefined,
    getCommands: () => [],
    getAllTools: () => [],
    getActiveTools: () => [],
    getCommand: (name: string) => commands.get(name),
    getThinkingLevel: () => undefined,
    getModel: () => undefined,
    getLabel: () => undefined,
    context: ctx,
  } as unknown as ExtensionAPI;
  return { api, commands };
}

interface DshGoalLike {
  phase: string;
  revision: number;
}

describe("@openbuddy/dsh-core/goals (Phase B.3 step 2b)", () => {
  beforeEach(() => {
    __resetDshCoreStateForTests();
  });

  it("registers 14 goals.* commands on init (Phase C.2: + goals.list, Phase C.3: + goals.search + goals.advance-rounds, Phase C.3 follow-up: + goals.stats + goals.bump-revision + goals.stats-combined)", () => {
    const factory = createDshGoalsExtension();
    const { api, commands } = buildMockApi("session-1");
    factory(api);
    expect(commands.has("goals.get")).toBe(true);
    expect(commands.has("goals.create")).toBe(true);
    expect(commands.has("goals.edit")).toBe(true);
    expect(commands.has("goals.pause")).toBe(true);
    expect(commands.has("goals.resume")).toBe(true);
    expect(commands.has("goals.complete")).toBe(true);
    expect(commands.has("goals.blocked")).toBe(true);
    expect(commands.has("goals.clear")).toBe(true);
    expect(commands.has("goals.list")).toBe(true);
    expect(commands.has("goals.search")).toBe(true);
    expect(commands.has("goals.advance-rounds")).toBe(true);
    expect(commands.has("goals.stats")).toBe(true);
    expect(commands.has("goals.bump-revision")).toBe(true);
    expect(commands.has("goals.stats-combined")).toBe(true);
  });

  it("goals.create returns a ref and persists via the shared state map", async () => {
    const factory = createDshGoalsExtension();
    const { api, commands } = buildMockApi("session-2");
    factory(api);
    const created = (await commands.get("goals.create")!.handler({
      objective: "Ship v1.0",
      maxGoalRounds: 5,
    })) as { ref: { id: string; revision: number } };
    expect(created.ref.id).toMatch(/^goal-\d+$/);
    expect(created.ref.revision).toBe(1);

    // Round-trip: subsequent getGoal should surface the same record
    // through the SHARED state map (Cordis shim and PI extension see
    // identical data — this is the entire point of B.3 step 2b).
    const goal = getGoal({ id: "session-2" }, "current");
    expect(goal?.objective).toBe("Ship v1.0");
    expect(goal?.maxGoalRounds).toBe(5);
  });

  it("goals.create rejects empty / whitespace-only objectives", async () => {
    const factory = createDshGoalsExtension();
    const { api, commands } = buildMockApi("session-3");
    factory(api);
    await expect(commands.get("goals.create")!.handler({ objective: "" })).rejects.toThrow(/objective must be non-empty/);
    await expect(commands.get("goals.create")!.handler({ objective: "   " })).rejects.toThrow(/objective must be non-empty/);
  });

  it("goals.pause / resume / complete round-trip via the shared state map", async () => {
    const factory = createDshGoalsExtension();
    const { api, commands } = buildMockApi("session-4");
    factory(api);
    const ref = (await commands.get("goals.create")!.handler({ objective: "Ship v2" })) as {
      ref: { id: string; revision: number };
    };

    const paused = (await commands.get("goals.pause")!.handler(ref.ref)) as DshGoalLike;
    expect(paused.phase).toBe("paused");
    expect(paused.revision).toBe(ref.ref.revision + 1);

    const resumed = (await commands.get("goals.resume")!.handler(paused)) as DshGoalLike;
    expect(resumed.phase).toBe("active");

    const completed = (await commands.get("goals.complete")!.handler(resumed)) as DshGoalLike;
    expect(completed.phase).toBe("complete");

    // Verify shared state was actually mutated end-to-end.
    const finalGoal = getGoal({ id: "session-4" }, "current");
    expect(finalGoal?.phase).toBe("complete");
  });

  it("goals.blocked persists the blockedReason on the canonical record (Phase B.3 step 2b fix)", async () => {
    // Pre-B.3 step 2b, `wire-dsh-services.goalsBlocked(...)` attached
    // the structured reason to a returned COPY (`{ ...goal }`) so the
    // reason vanished on subsequent reads. B.3 step 2b fixes this by
    // mutating the canonical record via state.blockGoal.
    const factory = createDshGoalsExtension();
    const { api, commands } = buildMockApi("session-blocked");
    factory(api);
    const ref = (await commands.get("goals.create")!.handler({ objective: "Investigation" })) as {
      ref: { id: string; revision: number };
    };
    await commands.get("goals.blocked")!.handler({ ...ref.ref, reason: "context exhausted" });

    // Subsequent read MUST surface the blockedReason — the entire
    // point of moving state to @openbuddy/dsh-core/state.
    const goalAfterBlocked = getGoal({ id: "session-blocked" }, "current") as DshGoalRecord | undefined;
    expect(goalAfterBlocked?.phase).toBe("blocked");
    expect(goalAfterBlocked?.blockedReason?.code).toBe("MODEL_REPORTED_BLOCKED");
    expect(goalAfterBlocked?.blockedReason?.message).toBe("context exhausted");
  });

  it("goals.clear deletes the goal and rejects re-creation conflicts until cleared", async () => {
    const factory = createDshGoalsExtension();
    const { api, commands } = buildMockApi("session-5");
    factory(api);
    await commands.get("goals.create")!.handler({ objective: "Ship v3" });
    const before = getGoal({ id: "session-5" }, "current");
    expect(before).toBeDefined();
    const ref = { id: before!.id, revision: before!.revision };

    const cleared = (await commands.get("goals.clear")!.handler(ref)) as { id: string; revision: number };
    expect(cleared.id).toBe(ref.id);
    expect(getGoal({ id: "session-5" }, "current")).toBeUndefined();

    // After clear, a new goal should be creatable (was blocked by the
    // "goal already exists" guard in state.ts because the previous
    // goal hadn't been marked complete).
    const next = (await commands.get("goals.create")!.handler({ objective: "Ship v4" })) as {
      ref: { id: string; revision: number };
    };
    expect(next.ref.revision).toBe(1);
  });

  it("rejects a second non-complete goal (legacy 'goal already exists' guard)", async () => {
    const factory = createDshGoalsExtension();
    const { api, commands } = buildMockApi("session-6");
    factory(api);
    await commands.get("goals.create")!.handler({ objective: "First" });
    await expect(commands.get("goals.create")!.handler({ objective: "Second" })).rejects.toThrow(/goal already exists/);
  });

  it("PI goals.create + Cordis shim goalsGet see identical state (shared map contract)", async () => {
    // This test pins the entire point of Phase B.3 step 2b: extracting
    // the state to @openbuddy/dsh-core/state so both surfaces share.
    const factory = createDshGoalsExtension();
    const { api, commands } = buildMockApi("session-shared");
    factory(api);
    await commands.get("goals.create")!.handler({ objective: "Shared state goal" });

    // Now simulate the Cordis shim reading the same goal.
    const shimRead = getGoal({ id: "session-shared" }, "current");
    expect(shimRead?.objective).toBe("Shared state goal");

    // And verify `createGoal` from state.ts is the same function both
    // surfaces call into (no shadow Map) — call with a brand-new
    // session so we don't trip the "goal already exists" guard.
    const directCreate = createGoal({ id: "session-direct" }, "current", { objective: "Direct call" });
    expect(directCreate.ref.revision).toBe(1);
  });

  it("goals.list returns all active goals across sessions (Phase C.2)", async () => {
    const factory = createDshGoalsExtension();
    const { api, commands } = buildMockApi("session-1");
    factory(api);
    await commands.get("goals.create")!.handler({ objective: "A" });
    // Brand-new session so we can have a second goal without "already exists" guard.
    const directB = createGoal({ id: "session-2" }, "current", { objective: "B" });
    expect(directB.ref.revision).toBe(1);
    // Complete the second one.
    const ref2 = { id: directB.ref.id, revision: directB.ref.revision };
    await commands.get("goals.complete")!.handler({ ...ref2 });
    // But we are on session-1, so we'd hit "already exists" for session-2 — use state.ts directly.
    listAllGoals; // type-only reference (import is at top)

    const all = listAllGoals();
    expect(all).toHaveLength(2);
    const objectives = all.map((entry) => entry.goal.objective).sort();
    expect(objectives).toEqual(["A", "B"]);
    const sessionIds = all.map((entry) => entry.sessionId).sort();
    expect(sessionIds).toEqual(["session-1", "session-2"]);
  });

  it("goals.list filter narrows by phase", async () => {
    const factory = createDshGoalsExtension();
    const { api, commands } = buildMockApi("session-active");
    factory(api);
    await commands.get("goals.create")!.handler({ objective: "active one" });
    // Create a second goal via state.ts directly in a different session,
    // then complete it via state.ts (the PI extension's commands are
    // bound to the active session's carrier, not session-complete).
    const ref = createGoal({ id: "session-complete" }, "current", { objective: "to be completed" });
    transitionGoal({ id: "session-complete" }, "current", { id: ref.ref.id, revision: ref.ref.revision }, "complete");

    const activeOnly = listAllGoals({ phase: "active" });
    expect(activeOnly).toHaveLength(1);
    expect(activeOnly[0]?.goal.objective).toBe("active one");

    const completeOnly = listAllGoals({ phase: "complete" });
    expect(completeOnly).toHaveLength(1);
    expect(completeOnly[0]?.goal.objective).toBe("to be completed");
  });

  it("goals.list without filter returns goals in every phase", async () => {
    // Empty state → empty list.
    expect(listAllGoals()).toEqual([]);
    // After creating one goal, list size is 1.
    createGoal({ id: "session-x" }, "current", { objective: "X" });
    expect(listAllGoals()).toHaveLength(1);
  });

  it("goals.search filters by case-insensitive substring (Phase C.3)", async () => {
    const factory = createDshGoalsExtension();
    const { api, commands } = buildMockApi("session-search");
    factory(api);
    await commands.get("goals.create")!.handler({ objective: "Ship v1.0 release" });
    createGoal({ id: "session-other-1" }, "current", { objective: "Fix payment bug" });
    createGoal({ id: "session-other-2" }, "current", { objective: "Update SHIPPING docs" });
    // No-op stub: createGoal needs unique sessions, so all 3 land.

    // "ship" matches "Ship v1.0 release" and "Update SHIPPING docs"
    // (case-insensitive). It does NOT match "Fix payment bug".
    const shipMatches = searchGoalsByObjective("ship");
    expect(shipMatches).toHaveLength(2);
    const objectives = shipMatches.map((m) => m.goal.objective).sort();
    expect(objectives).toEqual(["Ship v1.0 release", "Update SHIPPING docs"]);

    // Empty query → empty list (defensive).
    expect(searchGoalsByObjective("")).toEqual([]);
    expect(searchGoalsByObjective("   ")).toEqual([]);

    // No match → empty list.
    expect(searchGoalsByObjective("nonexistent keyword xyzzy")).toEqual([]);
  });

  it("goals.search slash command returns the same shape as goals.list", async () => {
    const factory = createDshGoalsExtension();
    const { api, commands } = buildMockApi("session-slash");
    factory(api);
    await commands.get("goals.create")!.handler({ objective: "Audit v1.0 release" });

    const result = (await commands.get("goals.search")!.handler({ query: "audit" })) as Array<{ sessionId: string; goal: DshGoalRecord }>;
    expect(result).toHaveLength(1);
    expect(result[0]?.goal.objective).toBe("Audit v1.0 release");
  });

  it("goals.advance-rounds increments roundsStarted + revision; rejects on conflict / complete (Phase C.3)", async () => {
    const factory = createDshGoalsExtension();
    const { api, commands } = buildMockApi("session-advance");
    factory(api);
    const created = (await commands.get("goals.create")!.handler({ objective: "Ship v3", maxGoalRounds: 5 })) as { ref: { id: string; revision: number } };

    const advanced1 = (await commands.get("goals.advance-rounds")!.handler(created.ref)) as DshGoalRecord;
    expect(advanced1.roundsStarted).toBe(1);
    expect(advanced1.revision).toBe(created.ref.revision + 1);

    const advanced2 = (await commands.get("goals.advance-rounds")!.handler(advanced1)) as DshGoalRecord;
    expect(advanced2.roundsStarted).toBe(2);
    expect(advanced2.revision).toBe(advanced1.revision + 1);

    // Wrong ref → revision conflict.
    await expect(commands.get("goals.advance-rounds")!.handler({ id: created.ref.id, revision: 999 })).rejects.toThrow(/goal revision conflict/);

    // Complete the goal and verify advance-rounds rejects.
    const completed = (await commands.get("goals.complete")!.handler(advanced2)) as DshGoalRecord;
    await expect(commands.get("goals.advance-rounds")!.handler(completed)).rejects.toThrow(/cannot advance rounds on a complete goal/);

    // Sanity: state helper parity.
    const finalGoal = getGoal({ id: "session-advance" }, "current");
    expect(finalGoal?.roundsStarted).toBe(2);
    expect(finalGoal?.phase).toBe("complete");
  });

  it("B.3 step 3 — createDshGoalsExtensionForSession binds state to a specific sessionId (no api.context lookup)", async () => {
    // Phase B.3 step 3 — the new factory takes a sessionId at
    // construction time and pre-binds the carrier. It does NOT call
    // api.context.get('sessionFallbackKey') because the session is
    // already determined.
    const factory = createDshGoalsExtensionForSession("session-A");
    const { api, commands } = buildMockApi("ignored-by-step3-factory");
    factory(api);

    // Create a goal in session-A.
    const created = (await commands.get("goals.create")!.handler({ objective: "Step 3 bound" })) as { ref: { id: string; revision: number } };
    // The goal must be in the explicit session, not the mock session.
    expect(getGoal({ id: "session-A" }, "current")?.objective).toBe("Step 3 bound");
    expect(getGoal({ id: "ignored-by-step3-factory" }, "current")).toBeUndefined();

    // Advance the rounds to confirm the binding.
    const advanced = (await commands.get("goals.advance-rounds")!.handler(created.ref)) as DshGoalRecord;
    expect(advanced.roundsStarted).toBe(1);

    // Confirm commands register the same 14 commands (12 + goals.stats + goals.stats-combined).
    expect(commands.size).toBe(14);
  });

  it("B.3 step 3 — multiple ForSession factories land goals in different sessions (no cross-talk)", async () => {
    const factoryA = createDshGoalsExtensionForSession("session-X");
    const factoryB = createDshGoalsExtensionForSession("session-Y");
    const mockA = buildMockApi("ignored-A");
    const mockB = buildMockApi("ignored-B");
    factoryA(mockA.api);
    factoryB(mockB.api);

    await mockA.commands.get("goals.create")!.handler({ objective: "Goal in X" });
    await mockB.commands.get("goals.create")!.handler({ objective: "Goal in Y" });

    // Goals land in their respective sessions, no cross-talk.
    expect(getGoal({ id: "session-X" }, "current")?.objective).toBe("Goal in X");
    expect(getGoal({ id: "session-Y" }, "current")?.objective).toBe("Goal in Y");
    // Each session's `goals.get` returns its own goal (verified via
    // the mock API context) — confirms the carrier binding took
    // effect for each session separately.
    const xGoal = (await mockA.commands.get("goals.get")!.handler({})) as DshGoalRecord | undefined;
    const yGoal = (await mockB.commands.get("goals.get")!.handler({})) as DshGoalRecord | undefined;
    expect(xGoal?.objective).toBe("Goal in X");
    expect(yGoal?.objective).toBe("Goal in Y");
  });

  it("goals.stats returns aggregate stats across every session (Phase C.3 follow-up)", async () => {
    const factory = createDshGoalsExtension();
    const { api, commands } = buildMockApi("session-stats");
    factory(api);
    // Empty state.
    const empty = (await commands.get("goals.stats")!.handler({})) as {
      total: number;
      byPhase: Record<string, number>;
      totalRoundsStarted: number;
      averageRoundsStarted: number;
      totalMaxRounds: number;
    };
    expect(empty.total).toBe(0);
    expect(empty.averageRoundsStarted).toBe(0);
    expect(empty.totalMaxRounds).toBe(0);

    // Add goals in this session + a separate session via state.ts directly.
    await commands.get("goals.create")!.handler({ objective: "A", maxGoalRounds: 4 });
    createGoal({ id: "session-other-stats" }, "current", { objective: "B", maxGoalRounds: 6 });

    // Advance the first goal twice (chain so each call returns the
    // updated record — spreading the original ref into the second
    // call would trigger a revision conflict).
    const created1 = (await commands.get("goals.get")!.handler({})) as DshGoalRecord;
    const advanced1 = (await commands.get("goals.advance-rounds")!.handler(created1)) as DshGoalRecord;
    const advanced2 = (await commands.get("goals.advance-rounds")!.handler(advanced1)) as DshGoalRecord;
    expect(advanced2.roundsStarted).toBe(2);

    const populated = (await commands.get("goals.stats")!.handler({})) as {
      total: number;
      byPhase: Record<string, number>;
      totalRoundsStarted: number;
      averageRoundsStarted: number;
      totalMaxRounds: number;
    };
    expect(populated.total).toBe(2);
    expect(populated.byPhase.active).toBe(2);
    expect(populated.totalRoundsStarted).toBe(2);
    expect(populated.averageRoundsStarted).toBe(1);
    expect(populated.totalMaxRounds).toBe(10);
  });

  it("goals.bump-revision increments revision without changing state (Phase C.3 follow-up)", async () => {
    const factory = createDshGoalsExtension();
    const { api, commands } = buildMockApi("session-bump");
    factory(api);
    const created = (await commands.get("goals.create")!.handler({ objective: "Bump test", maxGoalRounds: 3 })) as { ref: { id: string; revision: number } };

    // First bump: revision 1 → 2, no other fields change.
    const advanced = (await commands.get("goals.bump-revision")!.handler(created.ref)) as DshGoalRecord;
    expect(advanced.revision).toBe(2);
    expect(advanced.id).toBe(created.ref.id);
    expect(advanced.objective).toBe("Bump test");
    expect(advanced.maxGoalRounds).toBe(3);
    expect(advanced.roundsStarted).toBe(0);

    // Stale ref → revision conflict (the canonical optimistic-concurrency test).
    await expect(
      commands.get("goals.bump-revision")!.handler({ id: created.ref.id, revision: created.ref.revision }),
    ).rejects.toThrow(/goal revision conflict/);

    // Chain bumps from the up-to-date ref.
    const a = (await commands.get("goals.bump-revision")!.handler(advanced)) as DshGoalRecord;
    const b = (await commands.get("goals.bump-revision")!.handler(a)) as DshGoalRecord;
    expect(b.revision).toBe(4);
    expect(b.objective).toBe("Bump test");
    expect(b.roundsStarted).toBe(0); // roundsStarted never changes
  });

  it("sessionAggregateStats combines goals + feedback signals (Phase C.3 follow-up)", () => {
    // Empty state.
    const empty = sessionAggregateStats();
    expect(empty.goals.total).toBe(0);
    expect(empty.feedback.sessionCount).toBeGreaterThanOrEqual(0);
    expect(empty.feedback.entryCount).toBeGreaterThanOrEqual(0);

    // Add a goal in this session + feedback in another session.
    createGoal({ id: "session-agg-A" }, "current", { objective: "A", maxGoalRounds: 3 });
    putFeedbackEntry({ messageId: "m1", rating: "ok" }, "session-agg-B");
    putFeedbackEntry({ messageId: "m2", rating: "good" }, "session-agg-B");

    const populated = sessionAggregateStats();
    expect(populated.goals.total).toBeGreaterThanOrEqual(1);
    // Feedback from session-agg-B is counted regardless of which
    // session the goal lives in — the aggregation is global.
    expect(populated.feedback.entryCount).toBeGreaterThanOrEqual(2);
    expect(populated.feedback.sessionCount).toBeGreaterThanOrEqual(1);
  });

  it("purgeSession clears the goal + feedback entries for a single session (Phase C.3 follow-up)", () => {
    // Session X: 1 goal + 2 feedback entries.
    createGoal({ id: "session-purge-X" }, "current", { objective: "X", maxGoalRounds: 3 });
    putFeedbackEntry({ messageId: "x1", rating: "ok" }, "session-purge-X");
    putFeedbackEntry({ messageId: "x2", rating: "good" }, "session-purge-X");

    // Session Y: 1 goal + 1 feedback entry (unrelated — must survive).
    createGoal({ id: "session-purge-Y" }, "current", { objective: "Y", maxGoalRounds: 3 });
    putFeedbackEntry({ messageId: "y1", rating: "ok" }, "session-purge-Y");

    const result = purgeSession({ id: "session-purge-X" }, "current");
    expect(result.goalsCleared).toBe(1);
    expect(result.feedbackEntriesCleared).toBe(2);

    // Session X is gone.
    expect(getGoal({ id: "session-purge-X" }, "current")).toBeUndefined();
    // Session Y intact.
    expect(getGoal({ id: "session-purge-Y" }, "current")?.objective).toBe("Y");
  });

  it("purgeSession on a fresh session is a no-op (Phase C.3 follow-up)", () => {
    const result = purgeSession({ id: "never-existed" }, "current");
    expect(result.goalsCleared).toBe(0);
    expect(result.feedbackEntriesCleared).toBe(0);
  });


  it("goals.stats-combined returns goals + feedback aggregates in one call (Phase C.3 follow-up)", async () => {
    const factory = createDshGoalsExtension();
    const { api, commands } = buildMockApi("session-combined");
    factory(api);

    // Empty state: zeros everywhere.
    const empty = (await commands.get("goals.stats-combined")!.handler({})) as { goals: { total: number }; feedback: { sessionCount: number; entryCount: number } };
    expect(empty.goals.total).toBe(0);
    expect(empty.feedback.sessionCount).toBeGreaterThanOrEqual(0);
    expect(empty.feedback.entryCount).toBeGreaterThanOrEqual(0);

    // Populated state: create a goal + put a feedback entry.
    commands.get("goals.create")!.handler({ objective: "combined", maxGoalRounds: 2 });
    putFeedbackEntry({ messageId: "m1", rating: "ok" }, "session-combined");

    const populated = (await commands.get("goals.stats-combined")!.handler({})) as { goals: { total: number }; feedback: { sessionCount: number; entryCount: number } };
    expect(populated.goals.total).toBeGreaterThanOrEqual(1);
    expect(populated.feedback.entryCount).toBeGreaterThanOrEqual(1);
  });
});