/**
 * host-modules/profile/remote-contributions.ts — remote-contribution discovery domain.
 *
 * Phase: bridges the missing `discoverRemote` wiring that the
 * profile-artifact-reconciler (host-modules/profile-artifact-reconciler.ts)
 * declared as an optional dep. Mirror of profile/renderer-manifest.ts:
 *
 *   1. Read state.profilePackagePaths via artifactPackageJsonByName
 *   2. Discover `exports["./remote"]` modules for each package via
 *      `discoverRemoteManifestEntries` (openbuddy-plugin-host)
 *   3. Dynamic-import each moduleUrl, pick `TYPERT_REMOTE ?? default`,
 *      run through `serializeRemoteContribution` so descriptors are normalized
 *   4. Return Map<packageName, RemoteContribution> with the wire shape
 *      `{package, descriptors}` consumed by `state.remoteDispatcher.register`.
 *
 * Conventions mirror profile/renderer-manifest.ts: zero agent-host imports,
 * takes state + profileArtifactModuleUrl as DI.
 */

import {
  discoverRemoteManifestEntries,
  serializeRemoteContribution,
} from "@openbuddy/plugin-host";

import { type AgentHostState } from "../_state-shape";
import { artifactPackageJsonByName } from "./paths";
import { createProfileArtifactResolvers } from "../../profile-artifact-resolution";

export type ProfileArtifactModuleUrl = (path: string) => string;

/**
 * Discover all profile-aware `exports["./remote"]` modules and import them,
 * returning a Map keyed by package name. Map values are the SERIALIZED form
 * (`{package, descriptors}`) expected by `state.remoteDispatcher.register` in
 * host-modules/profile-artifact-reconciler.ts installProfileArtifacts().
 */
export async function discoverProfileRemoteContributionsImpl(
  state: AgentHostState,
  profileArtifactModuleUrl: ProfileArtifactModuleUrl,
): Promise<Map<string, unknown>> {
  const additionalPackageJson = await artifactPackageJsonByName(state.profilePackagePaths, state.cwd);
  const additionalPackages = [...additionalPackageJson.keys()];
  if (additionalPackages.length === 0) return new Map();

  const resolvers = createProfileArtifactResolvers({
    packageJsonByName: additionalPackageJson,
    profilePackageJson: state.profilePackageJson,
  });
  const entries = await discoverRemoteManifestEntries({
    additionalPackages,
    resolvePackageJson: resolvers.resolvePackageJson,
    resolveModule: async (specifier, packageJson) => {
      const resolved = await resolvers.resolveModule(specifier, packageJson);
      return profileArtifactModuleUrl(resolved);
    },
  });

  const contributions = new Map<string, unknown>();
  for (const entry of entries) {
    if (!entry.moduleUrl) continue;
    try {
      const url = new URL(entry.moduleUrl);
      const module = await import(url.href) as Record<string, unknown>;
      const value = module.TYPERT_REMOTE ?? module.default;
      if (!value) continue;
      const serialized = serializeRemoteContribution(value) as { package?: string };
      const packageName = serialized.package ?? entry.packageName;
      contributions.set(packageName, serialized);
    } catch {
      // Skip modules that fail to load (missing exports, syntax errors, …).
      // The reconciler treats an empty Map as a no-op, so the worst case is
      // that this profile doesn't get a remote contribution — same as the
      // pre-wiring fallback `async () => new Map()`.
    }
  }
  return contributions;
}
