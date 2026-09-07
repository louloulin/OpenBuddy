/**
 * bootstrap/profile-options-setup.ts — profile-options composition helper.
 *
 * Phase 8.3 Batch D-9: split `agent-host.ts:initialize()` so the final
 * composition root reads as 8-10 stages of orchestration, not a wall of
 * inline closures. This stage owns:
 *   - `resolveProfileOptions(process.env)` (env → resolved profile name + dir)
 *   - `bootstrapProfileOptions(process.env)` (resolve + scope factory)
 *   - `await ensureOpenBuddyProfile(profileOptions)` (idempotent disk creation)
 *
 * Why this stage exists:
 *   Pre-Batch-D-9 the 3-line composition
 *     `resolveProfileOptions + bootstrapProfileOptions + ensureOpenBuddyProfile`
 *   lived inline between `wireForwardedEvents` and `initProfile`. Wrapping
 *   it gives the agent-host composition root one named call instead of
 *   three and centralizes the env-handling contract.
 *
 * Reverse-dep invariant:
 *   This module imports nothing from agent-host.ts. All deps are passed in.
 */

import {
  bootstrapProfileOptions as bootstrapProfileOptionsImpl,
  resolveProfileOptions as resolveProfileOptionsImpl,
} from "./profile-options";
import {
  ensureOpenBuddyProfile as ensureOpenBuddyProfileImpl,
  type OpenBuddyProfileOptions,
} from "@openbuddy/plugin-host";
import { type ResolvedProfileOptions } from "./profile-options";

/**
 * Dependencies required to set up the profile options.
 *
 * `env` defaults to `process.env` so callers can omit it in production
 * but tests can pass a synthetic env. Kept as a dep rather than a closure
 * for testability + reverse-dep cleanliness.
 */
export interface ProfileOptionsSetupDeps {
  env?: NodeJS.ProcessEnv;
}

/**
 * Result of `setupProfileOptions`. Callers pass `profileOptions` to
 * `initProfile` and `resolvedProfile` for diagnostics / display.
 */
export interface ProfileOptionsSetupResult {
  resolvedProfile: ResolvedProfileOptions;
  profileOptions: OpenBuddyProfileOptions | null;
}

/**
 * Resolve the active OpenBuddy profile options from the environment and
 * idempotently create the profile directory on disk.
 *
 * Steps:
 *   1. `resolveProfileOptions(env)` reads OPENBUDDY_PROFILE / PI_PROFILE /
 *      OPENBUDDY_PROFILE_DIR and returns the resolved name + dir + home.
 *   2. `bootstrapProfileOptions(env)` adds the scope factories
 *      (dshHomePath, process platform / env) that the runtime needs.
 *   3. `await ensureOpenBuddyProfile(profileOptions)` creates the
 *      directory + writes the default package.json if absent.
 *
 * Errors from step 3 surface to the caller — they're an environment
 * problem (disk full, permission denied) that the host cannot recover
 * from silently.
 */
export async function setupProfileOptions(deps: ProfileOptionsSetupDeps = {}): Promise<ProfileOptionsSetupResult> {
  const env = deps.env ?? process.env;
  const resolvedProfile = resolveProfileOptionsImpl(env);
  const profileOptions = bootstrapProfileOptionsImpl(env);
  await ensureOpenBuddyProfileImpl(profileOptions);
  return { resolvedProfile, profileOptions };
}
