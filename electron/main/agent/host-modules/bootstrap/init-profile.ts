/**
 * bootstrap/init-profile.ts — Profile materialization stage of `initialize()`.
 *
 * Phase 8.3 Batch D: split `agent-host.ts:initialize()` into per-stage helpers
 * so the composition root reads as orchestration, not as a 400-line wall.
 * This stage owns the profile materialization + bundle composition + watcher
 * kickoff + "profile/loaded" emit. The downstream DSH and session stages still
 * need the `profileBundle`, `profilePackageJson`, and `profilePackagePaths`
 * state fields populated by this stage — keep them on `state` (single source
 * of truth) rather than passing through deps.
 *
 * Reverse-dep invariant:
 *   This module imports nothing from agent-host.ts. All deps are passed in.
 */

import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  ensureDefaultPiPackages,
  materializeOpenBuddyProfile,
  type PluginProfile,
} from "@openbuddy/plugin-host";

import { runtimeProfileBundle } from "../profile/bundles";

import { type AgentHostState } from "../_state-shape";
import type { OpenBuddyProfileOptions } from "@openbuddy/plugin-host";
import type { ResolvedProfileOptions } from "./profile-options";

/**
 * Dependencies required to materialize + load the active OpenBuddy profile.
 *
 * `piHome` is reused by the `state.profileOptions.scope.dshHomePath` factory
 * (must be the same canonical path as every other dsh client). All emit hooks
 * keep the same channel name as the previous inline implementation so plugin
 * event subscribers see no change.
 */
export interface InitProfileDeps {
  state: AgentHostState;
  resolvedProfile: ResolvedProfileOptions;
  profileOptions: OpenBuddyProfileOptions | null;
  piHome: () => string;
  emitPluginEvent: (type: string, payload: unknown) => void;
  setProfilePiResourcePaths: (paths: {
    extensions: readonly string[];
    skills: readonly string[];
    prompts: readonly string[];
    themes: readonly string[];
  }) => void;
  startProfileWatchers: () => Promise<void>;
}

/**
 * The profile materialization stage. Returns the bundle that the downstream
 * DSH + session stages need, or `undefined` when `profileOptions` is null
 * (no profile → no extensions, no bundles, no resource paths).
 *
 * On failure this stage emits `profile/failed` (so the renderer can show a
 * recovery toast) and re-throws so the agent-host composer can surface the
 * error to the caller.
 */
export async function initProfile(deps: InitProfileDeps): Promise<{
  profileBundle?: PluginProfile;
  profilePackageJson?: string;
}> {
  const {
    state,
    resolvedProfile,
    profileOptions,
    piHome,
    emitPluginEvent,
    setProfilePiResourcePaths,
    startProfileWatchers,
  } = deps;

  // C6: opt-in install of the curated default Pi package bundle.
  // Controlled by `OPENBUDDY_INSTALL_DEFAULT_PI=1` so the default install path
  // is untouched unless the host integrator opts in. Failures are logged as
  // warnings so an upstream registry hiccup never blocks session bootstrap.
  if (process.env.OPENBUDDY_INSTALL_DEFAULT_PI === "1" && profileOptions?.profileDir) {
    void ensureDefaultPiPackages({ profileDir: profileOptions.profileDir }).then((results) => {
      const failed = results.filter((r) => r.status === "failed");
      const installed = results.filter((r) => r.status === "installed");
      if (installed.length || failed.length) {
        console.log(
          `[openbuddy] default Pi bundle: installed=${installed.length} skipped=${results.filter((r) => r.status === "skipped").length} failed=${failed.length}`,
          failed.map((r) => `${r.spec}: ${r.error}`),
        );
      }
    }).catch((error) => {
      console.warn("[openbuddy] default Pi bundle install failed:", error);
    });
  }

  state.profileOptions = profileOptions
    ? {
        ...profileOptions,
        anchors: [fileURLToPath(import.meta.url), join(resolvedProfile.profileDir, "package.json")],
        scope: {
          dshHomePath: (sub: string) => join(piHome(), sub),
          process: { platform: process.platform, env: process.env },
        },
      }
    : null;

  if (!profileOptions) {
    return {};
  }

  try {
    const materialized = await materializeOpenBuddyProfile(state.profileOptions!);
    const runtimeBundle = await runtimeProfileBundle(materialized.bundle);
    state.profilePackageJson = materialized.profile.packageJson;
    state.profilePackagePaths.splice(
      0,
      state.profilePackagePaths.length,
      ...materialized.profile.packagePaths,
    );
    const profileBundle: PluginProfile = {
      entries: [...runtimeBundle.entries],
      patches: runtimeBundle.patches,
    };
    state.profileBundle = profileBundle;
    state.profilePiExtensions = materialized.profile.piExtensions;
    state.profilePiPackagePaths.splice(
      0,
      state.profilePiPackagePaths.length,
      ...materialized.profile.piPackagePaths,
    );
    setProfilePiResourcePaths(materialized.profile.piResourcePaths);
    await startProfileWatchers();
    emitPluginEvent("profile/loaded", {
      name: materialized.profile.name,
      bundles: materialized.profile.bundles,
      piExtensions: materialized.profile.piExtensions.map((extension) => extension.id),
    });
    return { profileBundle, profilePackageJson: materialized.profile.packageJson };
  } catch (error) {
    emitPluginEvent("profile/failed", {
      name: resolvedProfile.profileName,
      error: String(error),
      profileDir: resolvedProfile.profileDir,
    });
    throw error;
  }
}
