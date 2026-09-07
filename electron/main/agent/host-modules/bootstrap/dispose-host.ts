/**
 * bootstrap/dispose-host.ts — full host dispose path (counterpart of `initialize()`).
 *
 * Phase 8.3 Batch D-4: split `agent-host.ts:disposeInternal()` into per-section
 * helpers so the composition root reads as orchestration, not as a 80-line wall.
 * This module owns:
 *   - tearing down hooks + draining any in-flight subprocess
 *   - tearing down the active Pi AgentSession (with `pi/dispose` + `session/dispose` events)
 *   - stopping profile watchers + waiting for any profile-reload in-flight
 *   - unsubscribing capability event bridge + typert registry
 *   - clearing the remote dispatcher
 *   - disposing the preset session runtime + loader + runtimes (terminal, subprocess, dsh)
 *   - clearing all profile-related state (contributions, typert registrations)
 *   - flushing + clearing the session event log
 *   - resetting every `state` field back to its bootstrap-time default
 *   - cancelling + disposing continuable subagents + deepseek agent children
 *   - rejecting pending UI requests (permission + question)
 *   - clearing editor text + tools-expanded maps
 *
 * Reverse-dep invariant:
 *   This module imports nothing from agent-host.ts. All deps are passed in.
 */

import {
  disposeActiveHookProcesses,
  drainActiveHookProcesses,
} from "../../agent-hooks";
import { disposeProfileTypertRegistrations } from "../profile/contributions-pure";
import { stopProfileWatchers } from "../profile/watchers";
import { type AgentHostState } from "../_state-shape";

/**
 * Dependencies required to dispose the agent host.
 *
 * `piSessionRuntime` and `emitPluginEvent` are passed as callbacks so this
 * module does not import agent-host.ts. `stopProfileWatchers` is exported
 * from `host-modules/profile/watchers.ts`.
 */
export interface DisposeHostDeps {
  state: AgentHostState;
  piSessionRuntime: { dispose: (opts?: { abort?: boolean }) => Promise<void> };
  emitPluginEvent: (type: string, payload: unknown) => void;
}

/**
 * Tear down the entire agent host. Called from `dispose()` in agent-host.ts
 * (which wraps it in `enqueueLifecycle` so concurrent dispose/initialize
 * calls stay serialised).
 *
 * This function never throws — every cleanup step is wrapped in a try/catch
 * or `?.` so a partial failure cannot leave the host in a half-disposed state.
 */
export async function disposeHost(deps: DisposeHostDeps): Promise<void> {
  const { state, piSessionRuntime, emitPluginEvent } = deps;

  disposeActiveHookProcesses();
  await drainActiveHookProcesses();

  // Stage G-1c: openbuddy-automation removed; nothing to stop here.
  // pi-background-tasks disposes itself with the pi session.
  const session = state.session;
  try {
    if (session) {
      state.context?.emit("pi/dispose", { sessionId: session.sessionId });
      emitPluginEvent("session/dispose", { sessionId: session.sessionId });
      await piSessionRuntime.dispose(undefined);
    }
  } catch (error) {
    console.warn("[openbuddy] abort on dispose failed", error);
  }

  stopProfileWatchers(state);
  await state.profileReloadPromise.catch(() => undefined);

  state.capabilityEventBridgeUnsubscribe?.();
  state.capabilityEventBridgeUnsubscribe = null;
  state.typertRegistryUnsubscribe?.();
  state.typertRegistryUnsubscribe = null;
  state.remoteDispatcher.clear();

  await state.presetSessionRuntime?.dispose().catch((error) => {
    console.warn("[openbuddy] preset runtime dispose failed", error);
  });
  state.presetSessionRuntime = null;
  state.profileRemoteContributions.clear();
  disposeProfileTypertRegistrations(state.profileTypertContributions.values());
  state.profileTypertContributions.clear();

  await state.loader?.dispose();
  await state.terminalRuntime?.dispose();
  state.terminalRuntime = null;
  await state.subprocessRuntime?.dispose();
  state.subprocessRuntime = null;
  await state.deepSeekCordisRuntime?.dispose();
  state.deepSeekCordisRuntime = null;
  state.deepSeekCordisSnapshot = null;

  await state.sessionEventLog?.flush();
  state.sessionUnsubscribe = null;
  state.loader = null;
  state.sessionEventLog?.clear();
  state.eventSequence = 0;
  state.sessionSequences.clear();
  state.sessionEventLog = null;
  state.context = null;
  state.session = null;
  state.queueMirror = null;
  state.cwd = null;
  state.model = undefined;
  state.pluginState = null;
  state.pluginCommitGeneration = 0;
  state.lastPluginCommitTransactionId = undefined;
  state.lastPluginCommitMarker = undefined;
  state.modelRuntime = null;
  state.piResourceLoader = null;
  state.piMarketplaceResourcePaths.extensions = [];
  state.piMarketplaceResourcePaths.skills = [];
  state.piMarketplaceResourcePaths.prompts = [];
  state.piMarketplaceResourcePaths.themes = [];
  state.piMarketplaceAgentFiles = [];
  state.hookConfigs = [];
  state.piRefreshPromise = Promise.resolve();
  state.profileOptions = null;
  state.profileBundle = null;
  state.profilePackageJson = undefined;
  state.profilePackagePaths = [];
  state.baseProfile = null;
  state.activePluginProfile = null;
  state.storedLayers = [];
  state.profileReloadPromise = Promise.resolve();
  state.pluginReadiness = { phase: "idle", generation: 0 };
  state.runningTasks.clear();
  state.jobsRegistry.clear();

  for (const child of state.continuableSubagents.values()) {
    child.controller.abort();
    void child.session.abort().catch(() => undefined);
    child.unsubscribe();
    child.session.dispose();
  }
  await Promise.allSettled([...state.deepSeekAgents.values()].map((agent) => agent.dispose()));
  state.deepSeekAgents.clear();
  state.continuableSubagents.clear();
  state.hookPermissionSessionRules.clear();
  for (const request of state.pendingUiRequests.values()) request.resolve(undefined);
  state.pendingUiRequests.clear();
  state.extensionEditorText.clear();
  state.extensionToolsExpanded.clear();
}
