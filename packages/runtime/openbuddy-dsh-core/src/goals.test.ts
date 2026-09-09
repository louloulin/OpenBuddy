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

import createDshGoalsExtension from "./goals";
import {
  __resetDshCoreStateForTests,
  createGoal,
  getGoal,
  type DshGoalRecord,
} from "./state";

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

  it("registers 8 goals.* commands on init", () => {
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
});