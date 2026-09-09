/**
 * @openbuddy/dsh-core — Phase B.3 step 2b public surface.
 *
 * Re-exports the two DSH core state machine extensions extracted from
 * `electron/main/agent/host-modules/bootstrap/wire-dsh-services.ts`
 * plus the SHARED state module that BOTH the Cordis shim and the
 * PI extensions consume (so `ctx.dshRemotes.goalsCreate(...)` and
 * `pi.registerCommand("goals.create")` see identical data).
 *
 * v6 §24.4 + v13 §33.2:
 *   - goals state machine         -> `@openbuddy/dsh-core/goals`
 *   - message-feedback state machine -> `@openbuddy/dsh-core/message-feedback`
 *   - shared state module         -> `@openbuddy/dsh-core/state`
 *
 * Consumed by:
 *   - `init-pi-dsh-core-extensions.ts` (B.3 step 2a/2b) via PI
 *     `discoverAndLoadExtensions()` for the PI-native slash-command
 *     surface.
 *   - `wire-dsh-services.ts` (refactored B.3 step 2b) for the
 *     Cordis-bound `ctx.dshRemotes` surface consumed by capability
 *     services + deepseek-compat tests.
 */

export {
  default as createDshGoalsExtension,
} from "./goals";

export {
  default as createDshMessageFeedbackExtension,
} from "./message-feedback";

export * from "./state";
