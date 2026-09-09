/**
 * bootstrap/init-pi-user-extensions.ts — PI native user-extension loading stage.
 *
 * Phase B.3 of docs/OPENBUDDY_PI_NATIVE_PLAN.md (v6 §24.4):
 *   Replace the DSH `HarnessPluginLoader` path with PI's actual
 *   `discoverAndLoadExtensions()` API for user plugins from
 *   `profile.piExtensions`.
 *
 * Background:
 *   The DSH `HarnessPluginLoader.loadProfile()` (used in
 *   `init-deepseek.ts:178` for DSH core packages) loads via the
 *   `HarnessPluginLoader` runtime, which is a DSH-specific abstraction.
 *   v6 §24.4 wants PI's own `discoverAndLoadExtensions(paths, cwd,
 *   agentDir, eventBus)` to be the canonical plugin loading path so
 *   OpenBuddy plugins interoperate with PI's ExtensionRunner / lifecycle
 *   directly.
 *
 * Strategy (Phase B.3 step 1):
 *   - Keep the DSH `HarnessPluginLoader.loadProfile(...)` for the 7 DSH
 *     core packages (which still have local shims in
 *     `deepseek-runtime.ts`). Migrating them to PI extension format lands
 *     in L.5 / Phase K.3.
 *   - Add a parallel stage for USER plugins declared in `profile.piExtensions`
 *     that go through PI's `discoverAndLoadExtensions(paths, cwd,
 *     agentDir, eventBus)`. The runtime is a fresh
 *     `createExtensionRuntime()` (no bindCore yet — actions are stubs
 *     until session.bindCore, which happens at session create time per
 *     PI's lifecycle).
 *   - User extensions are exposed via `state.userExtensionResult` so the
 *     renderer can show load diagnostics (count + failed ids).
 *
 * Reverse-dep invariant:
 *   This module imports nothing from agent-host.ts. All deps are passed in.
 *
 * Phase B.3 follow-ups:
 *   - B.3 step 2: route the 7 DSH core packages through PI too (replace
 *     loader.loadProfile) and remove the HarnessPluginLoader from the
 *     agent-host bootstrap.
 *   - B.3 step 3: when a new PI session is created, merge user-extension
 *     Extensions into the session's ExtensionRunner so /commands see them.
 */

import { createExtensionRuntime, discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

import { type AgentHostState } from "../_state-shape";

export interface InitPiUserExtensionsDeps {
  state: AgentHostState;
  cwd: string;
  /** Emit hooks the loader forwards to the host. */
  emitPluginEvent: (type: string, payload: unknown) => void;
}

export interface PiUserExtensionLoadResult {
  /** Number of user PI extensions successfully loaded. */
  loaded: number;
  /** Number of user PI extensions that failed to load. */
  failed: number;
  /** IDs of extensions that failed (for renderer diagnostics). */
  failedIds: string[];
}

/**
 * Phase B.3 step 1 — load user PI extensions through PI's actual
 * `discoverAndLoadExtensions()` API. Runs AFTER `initDeepSeek` so DSH
 * core packages are already on the DSH `HarnessPluginLoader`.
 *
 * Returns a summary that callers can expose via IPC / renderer state.
 */
export async function initPiUserExtensions(
  deps: InitPiUserExtensionsDeps,
): Promise<PiUserExtensionLoadResult> {
  const { state, cwd, emitPluginEvent } = deps;

  // No user plugins declared in the active profile -> no-op.
  if (state.profilePiPackagePaths.length === 0) {
    return { loaded: 0, failed: 0, failedIds: [] };
  }

  // Phase B.3 step 1 — fresh ExtensionRuntime. Actions are stubs until a
  // PI session binds core (which happens at session creation). For the
  // bootstrap stage we only need:
  //   1. The Extensions themselves (returned by discoverAndLoadExtensions)
  //   2. Their registration into an internal map (used by session.merge later)
  //   3. Lifecycle event emission
  const runtime = createExtensionRuntime();

  try {
    const result = await discoverAndLoadExtensions(
      [...state.profilePiPackagePaths],
      cwd,
      undefined,
      undefined, // eventBus is wired through the global one PI uses internally
    );

    const failedIds: string[] = [];
    for (const errorEntry of result.errors) {
      failedIds.push(errorEntry.path);
      emitPluginEvent("plugin/failed", {
        id: errorEntry.path,
        source: "pi-user-extensions",
        error: errorEntry.error,
      });
    }
    for (const extension of result.extensions) {
      emitPluginEvent("plugin/loaded", {
        id: extension.path,
        source: "pi-user-extensions",
        path: extension.path,
      });
    }

    return {
      loaded: result.extensions.length,
      failed: failedIds.length,
      failedIds,
    };
  } catch (error) {
    // Defensive: discoverAndLoadExtensions can throw if the runtime
    // chokes on a specifier. Surface the failure but don't break bootstrap.
    emitPluginEvent("plugin/failed", {
      id: "pi-user-extensions",
      source: "pi-user-extensions",
      error: error instanceof Error ? error.message : String(error),
    });
    return { loaded: 0, failed: state.profilePiPackagePaths.length, failedIds: ["pi-user-extensions"] };
  }
}
