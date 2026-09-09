/**
 * @openbuddy/dsh-core/goals — PI-native goal state machine extension.
 *
 * Phase B.3 step 2b of docs/OPENBUDDY_PI_NATIVE_PLAN.md (v13 §33.2):
 *   Extracts the per-session goal state machine (formerly in
 *   `electron/main/agent/host-modules/bootstrap/wire-dsh-services.ts`)
 *   into a standalone PI ExtensionFactory. Reads / writes the SHARED
 *   state maps from `@openbuddy/dsh-core/state` so the Cordis-bound
 *   `ctx.dshRemotes` API and the PI `goals.*` commands stay consistent
 *   — see state.ts for the storage layer rationale.
 *
 * v6 §24.4 step 2b: this file replaces the legacy `@deepseek-ai/dsh-goal`
 * string specifier that used to resolve through DSH
 * `resolveDeepSeekModule()` to a local shim.
 *
 * PI ExtensionFactory shape (per `@earendil-works/pi-coding-agent`):
 *   `default export: (api: ExtensionAPI) => void | Promise<void>`
 *
 *   PI's loader calls the factory exactly once with the live
 *   ExtensionAPI. We register 7 slash commands on the API. State
 *   itself is module-scope (in state.ts) — no per-extension closure
 *   capture — so commands registered here see exactly the same data
 *   as the Cordis shim and the per-call `state.dshCoreExtensionResult`
 *   bridge can rely on consistent reads.
 */

import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import {
  blockGoal,
  clearGoal,
  createGoal,
  editGoal,
  getGoal,
  listAllGoals,
  searchGoalsByObjective,
  transitionGoal,
} from "./state";

export type { DshGoalRecord } from "./state";

/**
 * Phase B.3 step 2b — PI-native goal state machine extension.
 *
 * Registers 7 slash commands (`goals.create`, `goals.edit`,
 * `goals.pause`, `goals.resume`, `goals.complete`, `goals.blocked`,
 * `goals.clear`) plus `goals.get` for read access. Sessions are
 * keyed off the carrier exposed through `ctx.sessionFallbackKey` if
 * available (PI will set this once we wire session binding in B.3
 * step 3); otherwise we fall back to `"current"` so the live
 * `discoverAndLoadExtensions()` path still works.
 */
export default function createDshGoalsExtension(): ExtensionFactory {
  return (api: ExtensionAPI): void => {
    const carrier: unknown = (api as unknown as {
      context?: { get?: (name: string) => unknown };
    }).context?.get?.("sessionFallbackKey");
    const fallback = typeof carrier === "string" ? carrier : "current";

    const commands = api as unknown as {
      registerCommand?: (spec: {
        name: string;
        description: string;
        handler: (args: unknown) => Promise<unknown> | unknown;
      }) => void;
    };

    commands.registerCommand?.({
      name: "goals.get",
      description: "Return the current DSH goal for the active session (or undefined).",
      handler: async () => getGoal(carrier, fallback),
    });

    commands.registerCommand?.({
      name: "goals.list",
      description: "List all active DSH goals across every session, optionally filtered by phase.",
      handler: async (args) => {
        const typed = (args ?? {}) as { phase?: "active" | "paused" | "blocked" | "complete" };
        return listAllGoals(typed.phase ? { phase: typed.phase } : undefined);
      },
    });

    commands.registerCommand?.({
      name: "goals.search",
      description: "Search goals across every session by case-insensitive substring of objective (Phase C.3).",
      handler: async (args) => {
        const typed = (args ?? {}) as { query?: string; phase?: "active" | "paused" | "blocked" | "complete" };
        const query = typeof typed.query === "string" ? typed.query : "";
        return searchGoalsByObjective(query, typed.phase ? { phase: typed.phase } : undefined);
      },
    });

    commands.registerCommand?.({
      name: "goals.create",
      description: "Create a new DSH goal for the active session.",
      handler: async (args) => createGoal(carrier, fallback, (args ?? {}) as { objective?: string; maxGoalRounds?: number }),
    });

    commands.registerCommand?.({
      name: "goals.edit",
      description: "Edit an existing DSH goal's objective.",
      handler: async (args) => editGoal(carrier, fallback, (args ?? {}) as { id?: string; revision?: number }, (args ?? {}) as { objective?: string }),
    });

    commands.registerCommand?.({
      name: "goals.pause",
      description: "Pause an active DSH goal.",
      handler: async (args) => transitionGoal(carrier, fallback, (args ?? {}) as { id?: string; revision?: number }, "paused"),
    });

    commands.registerCommand?.({
      name: "goals.resume",
      description: "Resume a paused DSH goal.",
      handler: async (args) => transitionGoal(carrier, fallback, (args ?? {}) as { id?: string; revision?: number }, "active"),
    });

    commands.registerCommand?.({
      name: "goals.complete",
      description: "Complete an active DSH goal.",
      handler: async (args) => transitionGoal(carrier, fallback, (args ?? {}) as { id?: string; revision?: number }, "complete"),
    });

    commands.registerCommand?.({
      name: "goals.blocked",
      description: "Mark a DSH goal as blocked with a reason.",
      handler: async (args) => {
        const typed = (args ?? {}) as { id?: string; revision?: number; reason?: string };
        return blockGoal(carrier, fallback, typed, typed.reason ?? "");
      },
    });

    commands.registerCommand?.({
      name: "goals.clear",
      description: "Clear a DSH goal from the active session.",
      handler: async (args) => clearGoal(carrier, fallback, (args ?? {}) as { id?: string; revision?: number }),
    });
  };
}