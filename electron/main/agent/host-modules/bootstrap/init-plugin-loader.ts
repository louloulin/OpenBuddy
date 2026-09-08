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
 * The loader's `importer` closure carries a lot of knowledge (DeepSeek
 * compatibility modules, openbuddy:core alias, the capability plugin
 * index, profile-relative resolves, deepseek artifact resolver, plugin
 * store logging). We collect all of those in `InitPluginLoaderDeps` so
 * this module stays reverse-dep free.
 *
 * Reverse-dep invariant:
 *   This module imports nothing from agent-host.ts. All deps are passed in.
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
  /** DS module resolution: returns a module if `specifier` matches a
   *  DeepSeek-compat alias, otherwise undefined. */
  resolveDeepSeekModule: (specifier: string) => unknown;
  /** The openbuddy-core plugin (aliased as `openbuddy:core`). */
  openBuddyCorePlugin: unknown;
  /** Capability plugin index (DeepSeek-aliased capability packages). */
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
    resolveDeepSeekModule,
    openBuddyCorePlugin,
    openBuddyCapabilityPluginIndex,
  } = deps;

  const loader = new ElectronHarnessPluginLoader({
    context,
    baseUrl,
    importer: async (specifier, requestBaseUrl): Promise<unknown> => {
      const compatibilityModule = resolveDeepSeekModule(specifier);
      if (compatibilityModule !== undefined) return compatibilityModule;
      if (specifier === "openbuddy:core") return openBuddyCorePlugin;
      const capability = openBuddyCapabilityPluginIndex.get(specifier);
      if (capability) return capability;
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
      return import(/* @vite-ignore */ specifier);
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
