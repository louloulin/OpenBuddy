/**
 * bootstrap/dsh-core-extension-paths.ts — Resolve PI-native DSH core extension paths.
 *
 * Phase B.3 step 2b of docs/OPENBUDDY_PI_NATIVE_PLAN.md (v13 §33.2):
 *   Maps the abstract `@openbuddy/dsh-core` extension names onto the
 *   concrete file paths that PI `discoverAndLoadExtensions()` accepts.
 *   The same resolver honours an optional `state.dshCoreExtensionPathsOverride`
 *   (used by tests and profile-level overrides) so the production loader
 *   path is testable without bundling the real package layout.
 *
 * Why a separate module (vs. inline in init-deepseek.ts)?
 *   1. `init-pipeline-builder.ts` and `init-pipeline.test.ts` import
 *      the dep shape; keeping the resolver out of init-deepseek avoids
 *      a circular import with `state.dshCoreExtensionPaths` field.
 *   2. The override behaviour belongs in a single, easy-to-test
 *      function. Adding `vi.mock(...)` for `init-deepseek` is heavy;
 *      mocking `dsh-core-extension-paths.ts` is trivial.
 *
 * Reverse-dep invariant:
 *   This module imports nothing from electron/main/. All deps are
 *   static (file-URL imports) and the AgentHostState shape only.
 */

import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import type { AgentHostState } from "../_state-shape";

const DSH_CORE_EXTENSIONS = [
  // Phase B.3 step 2b only extracts goals + message-feedback (the
  // other 5 DSH core packages were already migrated to PI runtime by
  // L.4). When B.3 step 2c retires the DSH loader entirely, additional
  // entries can be appended without touching init-deepseek.ts.
  "goals",
  "message-feedback",
] as const;

const PACKAGE_SOURCE_ROOT = "@openbuddy/dsh-core";

/**
 * Default resolution: import each `@openbuddy/dsh-core/{name}` module
 * via its source TS file path. We use `import.meta.dirname` so the
 * lookup is independent of the current working directory and matches
 * the workspace's `tsconfig.json#paths` + `pnpm-workspace` resolution
 * rules. Falls back to skipping the extension if the source file is
 * not present (e.g., when only the bundled dist is available — PI's
 * `discoverAndLoadExtensions` then no-ops for that extension).
 */
function defaultResolveDshCoreExtensionPath(name: string): string | undefined {
  // The resolver lives at
  // `electron/main/agent/host-modules/bootstrap/`, so five `..`
  // segments land at the repo root where
  // `packages/runtime/openbuddy-dsh-core/src/{name}.ts` lives.
  const repoRoot = resolvePath(import.meta.dirname, "..", "..", "..", "..", "..");
  const tsSourcePath = resolvePath(repoRoot, "packages/runtime/openbuddy-dsh-core/src", `${name}.ts`);
  if (existsSync(tsSourcePath)) return tsSourcePath;
  return undefined;
}

/**
 * Resolve the DSH core extension paths that PI `discoverAndLoadExtensions()`
 * will pick up during `init-pi-dsh-core-extensions`.
 *
 * Resolution order (first hit wins):
 *   1. `state.dshCoreExtensionPathsOverride` if present — used by tests
 *      and by profile-level overrides (`profile.piDshCorePaths`).
 *   2. Default `@openbuddy/dsh-core` source paths via Node's package
 *      resolver (development: TS source; production: dist JS).
 *
 * Returns an empty list when no extensions are resolvable so
 * `init-pi-dsh-core-extensions` keeps its no-op fast-path.
 */
export function resolveDshCoreExtensionPaths(state: Pick<AgentHostState, "dshCoreExtensionPathsOverride">): readonly string[] {
  if (state.dshCoreExtensionPathsOverride && state.dshCoreExtensionPathsOverride.length > 0) {
    return [...state.dshCoreExtensionPathsOverride];
  }
  const resolved: string[] = [];
  for (const name of DSH_CORE_EXTENSIONS) {
    const path = defaultResolveDshCoreExtensionPath(name);
    if (path) resolved.push(path);
  }
  return resolved;
}

/**
 * Exported so tests can mirror the production resolution without
 * importing the internal `defaultResolveDshCoreExtensionPath`.
 */
export const __DSH_CORE_EXTENSIONS = DSH_CORE_EXTENSIONS;
export const __PACKAGE_SOURCE_ROOT = PACKAGE_SOURCE_ROOT;