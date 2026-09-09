/**
 * bootstrap/init-plugin-loader.ts — Plugin loader + plugin state bootstrap stage.
 *
 * Phase 8.3 Batch D-5: split `agent-host.ts:initialize()` so the final
 * composition root reads as 8-10 stages of orchestration, not a wall of
 * inline closures. This stage owns:
 *   - constructing the Electron-flavoured `ElectronHarnessPluginLoader`
 *     (with its multi-resolution importer)
 *   - creating + hydrating the `PluginStateStore` (PI extension overrides +
 *     commit markers)
 *   - populating `state.loader`, `state.pluginState`, `state.piExtensionOverrides`,
 *     `state.pluginCommitGeneration`, `state.lastPluginCommitTransactionId`,
 *     `state.lastPluginCommitMarker`
 *
 * The loader's `importer` closure carries a lot of knowledge (openbuddy:core
 * alias, the capability plugin index, profile-relative resolves, profile
 * artifact resolver, plugin store logging). We collect all of those in
 * `InitPluginLoaderDeps` so this module stays reverse-dep free.
 *
 * Reverse-dep invariant:
 *   This module imports nothing from agent-host.ts. All deps are passed in.
 *
 * Phase L.3: DSH compat-module resolution is gone — PI
 * `discoverAndLoadExtensions` is the single source of plugin discovery and
 * the OpenBuddy importer only handles openbuddy-internal aliases
 * (`openbuddy:core`, capability plugin index, relative + profile-relative
 * npm specifiers).
 */

import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import {
  createPluginStateStore,
  type PluginStateStore,
  type PluginCommitMarker,
} from "@openbuddy/plugin-host";

import { type AgentHostState } from "../_state-shape";
import { ElectronHarnessPluginLoader } from "../profile/loader";
import { artifactPackageJsonByName } from "../profile/paths";
import { createProfileArtifactResolvers } from "../../profile-artifact-resolution";
import { resolveDeepSeekRuntimeModule } from "../../../deepseek/deepseek-runtime";

/**
 * Dependencies required to build the plugin loader.
 *
 * Most fields are read on every importer call (no snapshot capture), so
 * the loader always sees the live state. Pass `openBuddyCorePlugin` as a
 * plain value because the importer aliases `openbuddy:core` to it once
 * per call.
 */
export interface InitPluginLoaderDeps {
  state: AgentHostState;
  cwd: string;
  /** importer + logger + onEvent plumbing for the new loader instance. */
  context: import("@openbuddy/cordis").Context;
  baseUrl: string;
  /** Emit hooks the loader forwards to the host. */
  emitPluginEvent: (type: string, payload: unknown) => void;
  /** The openbuddy-core plugin (aliased as `openbuddy:core`). */
  openBuddyCorePlugin: unknown;
  /** Capability plugin index (OpenBuddy-builtin capability packages). */
  openBuddyCapabilityPluginIndex: ReadonlyMap<string, unknown>;
}

/**
 * Build the `ElectronHarnessPluginLoader` + the `PluginStateStore` and
 * hydrate the plugin-commit markers.
 *
 * Returns the loader so the caller can pass it to the downstream DSH +
 * session bootstrap stages.
 */
export async function initPluginLoader(deps: InitPluginLoaderDeps): Promise<{
  loader: ElectronHarnessPluginLoader;
  pluginState: PluginStateStore;
}> {
  const {
    state,
    cwd,
    context,
    baseUrl,
    emitPluginEvent,
    openBuddyCorePlugin,
    openBuddyCapabilityPluginIndex,
  } = deps;

  const loader = new ElectronHarnessPluginLoader({
    context,
    baseUrl,
    importer: async (specifier, requestBaseUrl): Promise<unknown> => {
      // Phase L.3: DSH compat aliases are gone — `resolveDeepSeekModule`
      // is no longer queried here. The order of resolution is now:
      //   1. `openbuddy:core` (the OpenBuddy core alias)
      //   2. `openBuddyCapabilityPluginIndex` (OpenBuddy builtin capabilities)
      //   3. `resolveDeepSeekRuntimeModule` (DSH runtime aliases that
      //      survive Phase L.3 because `deepseek-runtime.ts` is still
      //      the home of the slim DSH service shims)
      //   4. relative specifiers (handled by the harness)
      //   5. profile-relative resolves against `state.profilePackageJson`
      //   6. fallback dynamic import by specifier (may throw — see below)
      if (specifier === "openbuddy:core") return openBuddyCorePlugin;
      const capability = openBuddyCapabilityPluginIndex.get(specifier);
      if (capability) return capability;
      const runtimeAlias = resolveDeepSeekRuntimeModule(specifier);
      if (runtimeAlias !== undefined) return runtimeAlias;
      if (specifier.startsWith(".")) {
        return import(/* @vite-ignore */ new URL(specifier, requestBaseUrl ?? baseUrl).href);
      }
      if (state.profilePackageJson) {
        try {
          const resolved = createRequire(state.profilePackageJson).resolve(specifier);
          return import(/* @vite-ignore */ pathToFileURL(resolved).href);
        } catch {
          try {
            const packageJsonByName = await artifactPackageJsonByName(state.profilePackagePaths, state.cwd);
            const packageName = specifier
              .split("/")
              .slice(0, specifier.startsWith("@") ? 2 : 1)
              .join("/");
            const packageJson = packageJsonByName.get(packageName);
            if (packageJson) {
              const resolver = createProfileArtifactResolvers({
                packageJsonByName,
                profilePackageJson: state.profilePackageJson,
              });
              const resolved = await resolver.resolveModule(specifier, packageJson);
              return import(/* @vite-ignore */ pathToFileURL(resolved).href);
            }
          } catch {
            // Fall through to the host's normal dependency graph.
          }
        }
      }
      try {
        return await import(/* @vite-ignore */ specifier);
      } catch (error) {
        // Phase L.3: the legacy DSH universal loader (`deepseek-generic.ts`)
        // is gone, so unresolved `@deepseek-ai/dsh-*` specifiers (e.g. the
        // ones still listed in `host-runner-entries.ts` from earlier phases)
        // can no longer resolve. Surface the failure to the renderer
        // through the host's plugin-event bus and return a no-op plugin so
        // the loader can mark the entry as loaded without crashing the
        // whole bootstrap. Real DSH entry pruning lands in Phase L.4.
        if (specifier.startsWith("@deepseek-ai/")) {
          emitPluginEvent("plugin/failed", { id: specifier, name: specifier, error: String(error) });
          return { name: specifier, apply: () => () => undefined };
        }
        throw error;
      }
    },
    logger: (level, message) => {
      // The PluginLoader logs are surfaced as plugin/<level> events so the
      // renderer-side devtools can show them. Same contract as before the
      // extraction.
      console[level](message);
      emitPluginEvent(`plugin/${level}`, { message });
    },
    onEvent: emitPluginEvent,
  });

  state.loader = loader;

  const pluginState = createPluginStateStore();
  state.pluginState = pluginState;
  try {
    const stored = await pluginState.read();
    state.piExtensionOverrides = stored?.piExtensions ?? {};
    state.pluginCommitGeneration = stored?.commit?.generation ?? 0;
    state.lastPluginCommitTransactionId = stored?.commit?.transactionId;
    state.lastPluginCommitMarker = (stored?.commit ?? undefined) as PluginCommitMarker | undefined;
  } catch (error) {
    console.warn("[openbuddy] failed to load Pi extension overrides", error);
  }

  void cwd;

  return { loader, pluginState };
}
