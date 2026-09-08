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
 * Phase K.2 — OpenBuddyPlugin SDK 接入:
 *   - The 7 DSH core packages are now declared as `OpenBuddyPluginManifest`
 *     entries (`coreCapabilityManifests`) and serialised via the K.1 SDK
 *     before being materialised into `PluginEntryOptions` rows for the
 *     existing `HarnessPluginLoader.loadProfile(...)` call. Real loading
 *     still goes through `HarnessPluginLoader` for now (Phase L.3 will
 *     route it through PI `loadExtensions()` per v6 §24.4).
 *   - The base profile is now built from the SDK-serialised entry rows
 *     (`profileEntriesFromManifests`) so adding a new DSH core package is
 *     a single edit to `coreCapabilityManifests`.
 *   - `loader.loadProfile(profile)` is kept as-is; Phase K.2 only owns
 *     manifest shape, not the loader swap.
 *
 * Reverse-dep invariant:
 *   This module imports nothing from agent-host.ts. All deps are passed in.
 */

import type { Context } from "@openbuddy/cordis";
import {
  composePluginPatches,
  openbuddyPluginManifestSchema,
  serializeRemoteContribution,
  serializeHarnessTrack,
  validateOpenBuddyPluginManifest,
  type PluginBundle,
  type PluginEntryOptions,
  type PluginPatch,
  type PluginProfile,
  type OpenBuddyPluginManifest,
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
 * Phase K.2 — OpenBuddyPlugin manifests for the 7 DSH core capability packages.
 * Each manifest declares a single `harness` track that resolves to the
 * package's `name` field. The serializer emits a `PluginEntryOptions` row
 * that `HarnessPluginLoader.loadProfile(...)` already understands, so adding
 * a new DSH core package is one row in this table instead of two (one
 * package row + one loader call).
 */
export const coreCapabilityManifests: readonly OpenBuddyPluginManifest[] = DEEPSEEK_CORE_CAPABILITY_PACKAGES.map((packageName) =>
  validateOpenBuddyPluginManifest({
    schema: openbuddyPluginManifestSchema,
    id: packageName,
    packageName,
    version: "0.0.0",
    description: `DSH core capability package: ${packageName}`,
    tracks: [{ kind: "harness", source: packageName }],
  }),
);

/** Materialise the core capability manifests into `PluginEntryOptions` rows
 *  the loader can consume. Phase K.2 keeps this call to feed the existing
 *  `loader.loadProfile(...)`; Phase L.3 will replace the loader with PI
 *  `loadExtensions()` per v6 §24.4. */
export function profileEntriesFromManifests(
  manifests: readonly OpenBuddyPluginManifest[],
): PluginEntryOptions[] {
  const rows: PluginEntryOptions[] = [];
  for (const manifest of manifests) {
    for (const track of serializeHarnessTrack(manifest)) {
      rows.push({
        id: track.id,
        name: track.name,
        ...(track.inject ? { inject: [...track.inject] } : {}),
        ...(track.disabled !== undefined ? { disabled: track.disabled } : {}),
      });
    }
  }
  return rows;
}

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

  // Phase K.2: prepend the SDK-serialised core capability entries to the
  // base profile. The row order matches `DEEPSEEK_CORE_CAPABILITY_PACKAGES`
  // so the loader sees them in the documented sequence. The base + bundle
  // entries follow, with override patches layered on top.
  const coreEntries = profileEntriesFromManifests(coreCapabilityManifests);
  const profile: PluginProfile = {
    entries: composeHostRunnerEntries(
      baseProfile.entries,
      profileBundle?.entries ?? [],
      coreEntries,
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
