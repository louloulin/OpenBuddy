/**
 * bootstrap/init-deepseek.ts — DSH (DeepSeek Host) assembly stage of `initialize()`.
 *
 * Phase 8.3 Batch D-2: split `agent-host.ts:initialize()` into per-stage helpers
 * so the composition root reads as orchestration, not as a 400-line wall. This
 * stage owns:
 *   - composing the base + profile + override plugin profile
 *   - loading it via `ElectronHarnessPluginLoader`
 *   - syncing the DeepSeek Cordis runtime + capability services
 *   - ensuring the typert registry is ready
 *   - registering the DSH capability remotes on the remote dispatcher
 *   - registering the 7 @deepseek-ai/* core packages
 *   - reconciling profile artifacts (typert + remote contributions)
 *
 * Reverse-dep invariant:
 *   This module imports nothing from agent-host.ts. All deps are passed in.
 */

import { join } from "node:path";
import type { Context } from "@openbuddy/cordis";
import {
  composePluginPatches,
  serializeRemoteContribution,
  type PluginBundle,
  type PluginPatch,
  type PluginProfile,
} from "@openbuddy/plugin-host";
import { createOpenBuddyProfile } from "@openbuddy/bundle-base";

import { type AgentHostState } from "../_state-shape";
import { deepSeekCoreRuntimeEntries, syncDeepSeekCordisRuntime } from "../deepseek/cordis-runtime";
import { deepSeekCapabilityRemote } from "../../../deepseek/deepseek-capabilities";
import { deepSeekSessionQueryRemote } from "../../../deepseek/deepseek-runtime";
import { readOverridePatches } from "../profile/override-patches";
import { composeHostRunnerEntries } from "../deepseek/host-runner-entries";
import type { ElectronHarnessPluginLoader } from "../profile/loader";
import {
  ensureTypertReady,
  restoreDeepSeekCapabilityServices,
  remoteServiceContext,
} from "../workbench-scope";

/**
 * Dependencies required to assemble the DSH Cordis runtime + capability services.
 *
 * Every emit/event/dispatcher closure that the previous inline implementation
 * captured from agent-host module scope is collected here. Keeps this module
 * free-free of agent-host reverse dependencies.
 */
export interface InitDeepSeekDeps {
  state: AgentHostState;
  context: Context;
  /** Pre-built loader (created in the previous stage). */
  loader: ElectronHarnessPluginLoader;
  /** Bundle materialised by the profile bootstrap stage (may be undefined). */
  profileBundle: PluginBundle | undefined;
  /** Resolved importer for `import(new URL(...))` calls (vite-ignore hint preserved at call sites). */
  baseUrl: string;
  emitPluginEvent: (type: string, payload: unknown) => void;
  emitRendererEvent: (channel: string, payload: unknown) => void;
  remoteServiceContext: () => unknown;
  reconcileProfileArtifacts: () => Promise<void>;
}

/**
 * The seven `@deepseek-ai/*` core capability packages that every OpenBuddy
 * profile registers on the remote dispatcher. Kept here so the composition
 * root reads as a list, not as 7 inline `state.remoteDispatcher.register`
 * calls.
 */
export const DEEPSEEK_CORE_CAPABILITY_PACKAGES = [
  "@deepseek-ai/dsh-commands",
  "@deepseek-ai/dsh-goal",
  "@deepseek-ai/dsh-file-reference",
  "@deepseek-ai/dsh-host-plugin-inventory",
  "@deepseek-ai/dsh-message-feedback",
  "@deepseek-ai/dsh-session-reference",
  "@deepseek-ai/dsh-cordis-host-runner",
] as const;

/**
 * The DSH assembly stage. Loads the composed plugin profile into the loader,
 * syncs the Cordis runtime, restores capability services, ensures typert,
 * and registers the 7 core capability packages on the remote dispatcher.
 *
 * Returns nothing — all side effects land on `state`.
 */
export async function initDeepSeek(deps: InitDeepSeekDeps): Promise<void> {
  const {
    state,
    context,
    loader,
    profileBundle,
    emitPluginEvent,
    remoteServiceContext,
    reconcileProfileArtifacts,
  } = deps;

  // Hydrate stored plugin overrides BEFORE composing the profile so the
  // override layers land on top of base + bundle.
  state.piExtensionOverrides = state.piExtensionOverrides ?? {};
  let storedLayers: PluginPatch[][] = [];
  if (state.pluginState) {
    try {
      storedLayers = await state.pluginState.composePatches();
    } catch (error) {
      console.warn("[openbuddy] failed to load stored plugin overrides", error);
    }
  }
  const baseProfile = createOpenBuddyProfile();
  state.storedLayers = storedLayers;
  state.baseProfile = baseProfile;
  const overrideLayers = await readOverridePatches();

  const profile: PluginProfile = {
    entries: composeHostRunnerEntries(
      baseProfile.entries,
      profileBundle?.entries ?? [],
    ),
    patches: [
      ...(baseProfile.patches ?? []),
      ...(profileBundle?.patches ?? []),
      ...storedLayers,
      ...(overrideLayers ?? []),
    ],
  };

  try {
    await loader.loadProfile(profile);
    state.activePluginProfile = profile;
    const sessionQueryEntries = loader.list().filter((e) => e.id === "openbuddy-dsh-session-query" || e.name === "@deepseek-ai/dsh-session-query");
    const sessionServiceEntries = loader.list().filter((e) => e.id === "openbuddy-dsh-session" || e.name === "@deepseek-ai/dsh-session");
    await syncDeepSeekCordisRuntime(
      deepSeekCoreRuntimeEntries(composePluginPatches(profile.entries, profile.patches ?? [])),
    );
  } catch (error) {
    emitPluginEvent("plugin/failed", { id: "openbuddy-core", error: String(error) });
    throw error;
  }
  await restoreDeepSeekCapabilityServices();
  await ensureTypertReady();

  try {
    state.remoteDispatcher.register(
      deepSeekSessionQueryRemote(),
      remoteServiceContext() as never,
    );
  } catch (error) {
    throw error;
  }

  for (const packageName of DEEPSEEK_CORE_CAPABILITY_PACKAGES) {
    const remote = deepSeekCapabilityRemote(packageName);
    if (remote) {
      try {
        state.remoteDispatcher.register(
          serializeRemoteContribution(remote),
          remoteServiceContext() as never,
        );
      } catch (error) {
        throw error;
      }
    }
  }
  await ensureTypertReady();
  await reconcileProfileArtifacts();

  // reconcileProfileArtifacts clears `state.profileRemoteContributions`
  // and re-installs whatever `discoverRemoteImpl()` returns. If the
  // discovery closure returns an empty Map (the default install when no
  // concrete discoverer was wired in), the capability remotes that we
  // just registered are now gone. Re-register the core capability set so
  // renderer-side invocations like `agent:new-session` always find the
  // expected services, even after an artifact reconciliation that wiped
  // them out.
  reRegisterCoreCapabilityRemotes();

  function reRegisterCoreCapabilityRemotes(): void {
    const context = state.context;
    if (!context) return;
    const ctx = remoteServiceContext();
    state.remoteDispatcher.register(deepSeekSessionQueryRemote(), ctx as never);
    for (const packageName of DEEPSEEK_CORE_CAPABILITY_PACKAGES) {
      const remote = deepSeekCapabilityRemote(packageName);
      if (!remote) continue;
      state.remoteDispatcher.register(serializeRemoteContribution(remote), ctx as never);
    }
  }
}
