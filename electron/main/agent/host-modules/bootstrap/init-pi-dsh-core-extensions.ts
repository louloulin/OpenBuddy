/**
 * bootstrap/init-pi-dsh-core-extensions.ts — DSH core extensions via PI loader.
 *
 * Phase B.3 step 2a of docs/OPENBUDDY_PI_NATIVE_PLAN.md (v6 section 24.4 + v11 section 31.2):
 *   Add a parallel PI-native loading path for the 7 DSH core capability
 *   packages alongside the existing DSH HarnessPluginLoader path.
 *   This is the transition phase before B.3 step 2b extracts each DSH
 *   core shim into a real file (so PI can loadExtensions them directly)
 *   and B.3 step 2c removes the DSH loader.
 *
 * Background:
 *   The 7 DSH core packages (@deepseek-ai/dsh-commands, dsh-goal,
 *   dsh-file-reference, etc.) are currently declared as string specifiers
 *   in DEEPSEEK_CORE_CAPABILITY_PACKAGES and resolved via
 *   loader.importer -> resolveDeepSeekModule() to local shims in
 *   deepseek-runtime.ts / cordis-runtime.ts. PI's
 *   discoverAndLoadExtensions() expects file paths, so this B.3 step 2a
 *   attempt will succeed once each shim lives at a real file path
 *   (B.3 step 2b's job).
 *
 * Strategy (Phase B.3 step 2a):
 *   - Run discoverAndLoadExtensions() in parallel with the existing
 *     loader.loadProfile() so both loaders see the DSH core entries.
 *   - Capture diagnostics (errors + extension paths) in
 *     state.dshCoreExtensionResult for renderer diagnostics.
 *   - DSH shims stay on the DSH loader until B.3 step 2c removes it.
 *
 * Reverse-dep invariant:
 *   This module imports nothing from agent-host.ts. All deps are passed in.
 *
 * Phase B.3 follow-ups:
 *   - B.3 step 2b: extract each of the 7 DSH core shims into independent
 *     files under packages/runtime/openbuddy-dsh-core/. Each exports an
 *     ExtensionFactory that PI can load via loadExtensions.
 *   - B.3 step 2c: remove ElectronHarnessPluginLoader from the
 *     agent-host bootstrap and delete state.loader.
 */

import { createExtensionRuntime, discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

import { type AgentHostState } from "../_state-shape";

export interface InitPiDshCoreExtensionsDeps {
  state: AgentHostState;
  cwd: string;
  /** Emit hooks the loader forwards to the host. */
  emitPluginEvent: (type: string, payload: unknown) => void;
  /**
   * File-system paths to the 7 DSH core packages. In B.3 step 2a these
   * are empty (DSH core still goes through HarnessPluginLoader); in B.3
   * step 2b they will point at the extracted shim files under
   * packages/runtime/openbuddy-dsh-core/{commands,goal,...}/index.ts.
   */
  dshCorePaths: readonly string[];
}

export interface PiDshCoreExtensionLoadResult {
  /** Number of DSH core extensions PI successfully loaded (B.3 step 2b > 0). */
  loaded: number;
  /** Number of DSH core extensions PI failed to load (B.3 step 2a = dsh-core-package-count until 2b extracts files). */
  failed: number;
  /** IDs of extensions that failed. */
  failedIds: string[];
}

/**
 * Phase B.3 step 2a — attempt to load DSH core packages through PI's
 * discoverAndLoadExtensions() API. Until B.3 step 2b extracts the shims
 * into real files, dshCorePaths is typically empty and this stage is
 * a no-op. When paths become available in B.3 step 2b, this stage will
 * populate state.dshCoreExtensionResult with the parallel PI load summary.
 */
export async function initPiDshCoreExtensions(
  deps: InitPiDshCoreExtensionsDeps,
): Promise<PiDshCoreExtensionLoadResult> {
  const { state, cwd, emitPluginEvent, dshCorePaths } = deps;

  // No real files yet (B.3 step 2a transition phase) -> no-op fast-path.
  if (dshCorePaths.length === 0) {
    return { loaded: 0, failed: 0, failedIds: [] };
  }

  const runtime = createExtensionRuntime();

  try {
    const result = await discoverAndLoadExtensions(
      [...dshCorePaths],
      cwd,
      undefined,
      undefined, // eventBus is wired through PI's internal global one
    );

    const failedIds: string[] = [];
    for (const errorEntry of result.errors) {
      failedIds.push(errorEntry.path);
      emitPluginEvent("plugin/failed", {
        id: errorEntry.path,
        source: "pi-dsh-core-extensions",
        error: errorEntry.error,
      });
    }
    for (const extension of result.extensions) {
      emitPluginEvent("plugin/loaded", {
        id: extension.path,
        source: "pi-dsh-core-extensions",
        path: extension.path,
      });
    }

    return {
      loaded: result.extensions.length,
      failed: failedIds.length,
      failedIds,
    };
  } catch (error) {
    emitPluginEvent("plugin/failed", {
      id: "pi-dsh-core-extensions",
      source: "pi-dsh-core-extensions",
      error: error instanceof Error ? error.message : String(error),
    });
    return { loaded: 0, failed: dshCorePaths.length, failedIds: ["pi-dsh-core-extensions"] };
  }
}
