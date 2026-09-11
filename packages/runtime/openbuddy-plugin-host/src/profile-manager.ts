/**
 * G3 PR 1 — slim typed facade. Re-exports the public profile-package API
 * while delegating install/remove to pi's `DefaultPackageManager` via
 * `default-package-manager-adapter.ts`, dependency/manifest helpers to
 * `profile-manager-internals.ts`, and the install/remove orchestration
 * (lockfile backup, rollback, bundle auto-activate) to
 * `profile-package-executor.ts`.
 *
 * GA gate target: ≤ 200 LOC (was 806 in v3.27). See plan4.1.md §9.22.
 */
import { EventEmitter as NodeEventEmitter } from "node:events";

import { OPENBUDDY_PROFILES_DIR, readOpenBuddyProfile, type OpenBuddyProfile, type OpenBuddyProfileManifest, type OpenBuddyProfileOptions } from "./profile";
import { defaultProfilePackageManager } from "./default-package-manager-adapter";
import {
  buildProfilePackageInfo,
  dependencyAnchors,
  directProfileDependencyNames,
  isBundleManifest,
  hasClient,
  hasPiManifest,
  hasPiConventionDirectory,
  hasRemoteExport,
  hasTypertExport,
  hasCordisPlugin,
  localDirectorySource,
  packageDirectories,
  packageName,
  packageNameFromSpecifier,
  packageTarget,
  readManifest,
} from "./profile-manager-internals";
import { executeInstall, executeRemove } from "./profile-package-executor";

// PR-D: listener cap lifted to 64 for pi-subagents fan-out (see Round 12 history).
if (NodeEventEmitter.defaultMaxListeners < 64) NodeEventEmitter.defaultMaxListeners = 64;
if (process.getMaxListeners() < 64) process.setMaxListeners(64);

export type ProfileDependencyHealth = "ok" | "missing" | "version-mismatch" | "invalid";

export interface ProfileDependencyDiagnostic {
  name: string;
  requested: string;
  installed?: string;
  kind: "dependency" | "optional" | "peer";
  health: ProfileDependencyHealth;
  message: string;
}

export interface ProfilePackageInfo {
  name: string;
  version?: string;
  path: string;
  installed: boolean;
  bundle: boolean;
  client: boolean;
  pi: boolean;
  remote: boolean;
  typert: boolean;
  cordis: boolean;
  listed: boolean;
  health: "healthy" | "degraded";
  dependencies: ProfileDependencyDiagnostic[];
  manifest: import("./plugin-manifest").UnifiedPluginManifest;
}

export interface ProfilePackageOptions extends OpenBuddyProfileOptions {
  profile?: OpenBuddyProfile;
  packageManager?: ProfilePackageManager;
}

export interface ProfilePackageManager {
  install: (profileDir: string, source: string) => Promise<void>;
  remove: (profileDir: string, packageName: string) => Promise<void>;
}

export interface DefaultPiPackageResult {
  spec: string;
  status: "installed" | "skipped" | "failed";
  error?: string;
}

async function profileFor(options: ProfilePackageOptions): Promise<OpenBuddyProfile> {
  return options.profile ?? readOpenBuddyProfile(options);
}

function packageManagerFor(options: ProfilePackageOptions): ProfilePackageManager {
  return options.packageManager ?? defaultProfilePackageManager;
}

export async function listProfilePackages(options: ProfilePackageOptions): Promise<ProfilePackageInfo[]> {
  const profile = await profileFor(options);
  const listed = new Set(profile.bundles);
  const packages = await packageDirectories(`${profile.dir}/node_modules`);
  const anchors = dependencyAnchors(profile, options.anchors);
  const result: ProfilePackageInfo[] = [];
  for (const path of packages) {
    let manifest: Record<string, unknown>;
    try { manifest = await readManifest(path); } catch { continue; }
    const name = typeof manifest.name === "string" ? manifest.name : path.split("/").pop()!;
    const supported = isBundleManifest(manifest) || hasClient(manifest) || hasPiManifest(manifest)
      || await hasPiConventionDirectory(path) || hasRemoteExport(manifest) || hasTypertExport(manifest)
      || hasCordisPlugin(manifest);
    if (!supported) continue;
    result.push(await buildProfilePackageInfo({ path, manifest, listed: listed.has(name), anchors }));
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}

export async function installProfilePackage(options: ProfilePackageOptions, sourcePath: string): Promise<ProfilePackageInfo> {
  const profile = await profileFor(options);
  const manager = packageManagerFor(options);
  const local = await localDirectorySource(sourcePath);
  if (!local) {
    const installedName = await executeInstall({
      profile, manager, source: sourcePath,
      listPackages: () => listProfilePackages(options),
      refresh: () => readOpenBuddyProfile({ ...options, profileDir: profile.dir }),
    });
    return installedName;
  }
  // local directory install (file: / ./) path
  const sourceManifest = await readManifest(local);
  const name = packageName(sourceManifest.name);
  const supported = isBundleManifest(sourceManifest) || hasClient(sourceManifest) || hasPiManifest(sourceManifest)
    || await hasPiConventionDirectory(local) || hasRemoteExport(sourceManifest) || hasTypertExport(sourceManifest)
    || hasCordisPlugin(sourceManifest);
  if (!supported) throw new Error(`profile-package: ${name} does not declare a supported OpenBuddy, Pi, generated Harness, or Cordis plugin surface`);
  const info = await executeInstall({
    profile, manager, localSource: local, source: sourcePath,
    listPackages: () => listProfilePackages(options),
    refresh: () => readOpenBuddyProfile({ ...options, profileDir: profile.dir }),
  });
  return info;
}

export async function removeProfilePackage(options: ProfilePackageOptions, name: string): Promise<void> {
  const profile = await profileFor(options);
  const manager = packageManagerFor(options);
  await executeRemove({
    profile, manager, name,
    listPackages: () => listProfilePackages(options),
    readPackageManifest: (n) => readManifest(packageTarget(profile, n)),
  });
}

export const OPENBUDDY_DEFAULT_PI_PACKAGES: readonly string[] = Object.freeze([
  "npm:pi-context-prune@1.3.0",
  "npm:pi-mcp-adapter@2.31.0",
  "npm:pi-web-access@0.27.0",
  "npm:pi-goal@0.1.7",
  "npm:pi-plan-mode@0.4.8",
  "npm:pi-subagents@0.59.0",
]);

export async function ensureDefaultPiPackages(options: {
  home?: string;
  profileName?: string;
  profileDir?: string;
  force?: boolean;
} = {}): Promise<DefaultPiPackageResult[]> {
  const { homedir: osHomedir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = options.profileDir ?? join(
    process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? osHomedir(), ".pi", "agent"),
    OPENBUDDY_PROFILES_DIR,
    options.profileName ?? "desktop",
  );
  const profileOptions = { ...options, profileDir: dir };
  let manifest: OpenBuddyProfileManifest | undefined;
  try {
    const profile = await readOpenBuddyProfile(profileOptions);
    manifest = profile.manifest;
  } catch {
    manifest = undefined;
  }
  const installed = new Set(Object.keys(manifest?.dependencies ?? {}));
  const results: DefaultPiPackageResult[] = [];
  for (const spec of OPENBUDDY_DEFAULT_PI_PACKAGES) {
    const name = packageNameFromSpecifier(spec);
    if (!options.force && name && installed.has(name)) {
      results.push({ spec, status: "skipped" });
      continue;
    }
    try {
      await installProfilePackage(profileOptions as ProfilePackageOptions, spec);
      results.push({ spec, status: "installed" });
    } catch (error) {
      const message = (error as Error)?.message ?? String(error);
      if (/already installed|EEXIST/i.test(message)) results.push({ spec, status: "skipped" });
      else results.push({ spec, status: "failed", error: message });
    }
  }
  return results;
}

// Re-export profile-bundle/extension mutators for callers that imported
// them from this module historically (Round 32 G3 PR 1 typed-facade).
export { updateProfileBundles, updateProfileExtensions } from "./profile-manager-internals";
