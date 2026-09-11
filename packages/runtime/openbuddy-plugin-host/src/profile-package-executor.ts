/**
 * G3 PR 1 — install / remove executor.
 *
 * Owns the orchestration concerns the slim typed facade shouldn't carry:
 *   - lockfile + package.json backup before any install
 *   - rollback when the package manager succeeds but the resulting tree
 *     doesn't expose a supported manifest surface
 *   - dependency closure materialization for local-directory installs
 *   - bundle auto-activation when the installed manifest declares one
 *   - dual-namespace mirror writes (openbuddy + dsh) on bundle updates
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { OpenBuddyProfile, OpenBuddyProfileManifest } from "./profile";
import type { ProfilePackageInfo, ProfilePackageManager } from "./profile-manager";
import {
  copyPackageTree,
  dependencyAnchors,
  directProfileDependencyNames,
  isBundleManifest,
  manifestHasDeclaredDependency,
  materializeDependencyClosure,
  packageNameFromSpecifier,
  packageTarget,
  updateProfileBundles,
} from "./profile-manager-internals";

async function readOptionalFile(path: string): Promise<string | undefined> {
  try { return await readFile(path, "utf8"); } catch { return undefined; }
}

function dependencySource(name: string, requested: string): string {
  return /^(?:file:|git(?:\+|:)|github:|https?:\/\/)/i.test(requested) ? requested : `${name}@${requested}`;
}

interface InstallArgs {
  profile: OpenBuddyProfile;
  manager: ProfilePackageManager;
  source: string;
  localSource?: string; // when set, this is a local-directory install
  listPackages: () => Promise<ProfilePackageInfo[]>;
  refresh: () => Promise<OpenBuddyProfile>;
}

export async function executeInstall(args: InstallArgs): Promise<ProfilePackageInfo> {
  const { profile, manager, source, localSource, listPackages, refresh } = args;

  if (localSource) {
    return await executeLocalDirectoryInstall({ profile, source: localSource, listPackages });
  }

  // registry / file: / git+ install path
  const before = await readFile(profile.packageJson, "utf8");
  const beforeManifest = JSON.parse(before) as OpenBuddyProfileManifest;
  const lockfile = join(profile.dir, "pnpm-lock.yaml");
  const lockfileBefore = await readOptionalFile(lockfile);
  let installedName: string | undefined = packageNameFromSpecifier(source);
  if (installedName && manifestHasDeclaredDependency(beforeManifest, installedName)) {
    throw new Error(`profile-package: ${installedName} is already installed; remove it before changing its source`);
  }
  try {
    await manager.install(profile.dir, source);
    const refreshed = await refresh();
    const candidates = directProfileDependencyNames(refreshed.manifest)
      .filter((name) => !manifestHasDeclaredDependency(beforeManifest, name) || name === installedName);
    installedName ??= candidates.length === 1 ? candidates[0] : undefined;
    const packageInfos = await listPackages();
    const resolvedInstalledName = installedName;
    const result = (resolvedInstalledName ? packageInfos.find((item) => item.name === resolvedInstalledName) : undefined)
      ?? (resolvedInstalledName ? packageInfos.find((item) => resolve(item.path) === resolve(packageTarget(refreshed, resolvedInstalledName))) : undefined)
      ?? packageInfos.find((item) => candidates.includes(item.name));
    if (!result) throw new Error(`profile-package: installed source ${source} did not provide a supported package`);
    if (result.bundle && !refreshed.bundles.includes(result.name)) {
      await updateProfileBundles(refreshed, result.name, true);
      const afterBundleUpdate = await refresh();
      const after = (await listPackages()).find((item) => item.name === result.name);
      if (!after) throw new Error(`profile-package: installed bundle ${result.name} disappeared after activation`);
      return after;
    }
    return result;
  } catch (error) {
    try {
      const afterInstall = await readOptionalFile(profile.packageJson);
      const afterManifest = afterInstall ? JSON.parse(afterInstall) as OpenBuddyProfileManifest : beforeManifest;
      const names = [...new Set([
        ...(installedName ? [installedName] : []),
        ...directProfileDependencyNames(afterManifest).filter((name) => !manifestHasDeclaredDependency(beforeManifest, name)),
      ])];
      for (const name of names) await manager.remove(profile.dir, name);
      await writeFile(profile.packageJson, before, "utf8");
      if (lockfileBefore !== undefined) await writeFile(lockfile, lockfileBefore, "utf8");
      else await rm(lockfile, { force: true });
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "profile-package: installation rollback failed");
    }
    throw error;
  }
}

async function executeLocalDirectoryInstall(args: {
  profile: OpenBuddyProfile;
  source: string;
  listPackages: () => Promise<ProfilePackageInfo[]>;
}): Promise<ProfilePackageInfo> {
  const { profile, source, listPackages } = args;
  const target = `${profile.dir}/node_modules/${source.split("/").pop()}`;
  const temporary = `${target}.openbuddy-${process.pid}-${Date.now()}`;
  const backup = `${target}.backup-${process.pid}-${Date.now()}`;
  const profileManifestBefore = await readFile(profile.packageJson, "utf8");
  await mkdir(dirname(target), { recursive: true });
  await rm(temporary, { recursive: true, force: true });
  const hadPrevious = (await stat(target, { throwIfNoEntry: false })) !== undefined;
  if (hadPrevious) await rename(target, backup);
  try {
    await copyPackageTree(source, temporary);
    await materializeDependencyClosure(source, temporary, dependencyAnchors(profile));
    await rename(temporary, target);
    // re-read manifest from staged target so manifest-flags round-trip
    const stagedManifest = JSON.parse(await readFile(`${target}/package.json`, "utf8")) as Record<string, unknown>;
    if (isBundleManifest(stagedManifest)) await updateProfileBundles(profile, stagedManifest.name as string, true);
    if (hadPrevious) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
    if (hadPrevious) await rename(backup, target);
    await writeFile(profile.packageJson, profileManifestBefore, "utf8");
    throw error;
  }
  const listed = await listPackages();
  const found = listed.find((item) => item.path === target);
  if (!found) throw new Error(`profile-package: local install at ${target} not detected after stage`);
  return found;
}

interface RemoveArgs {
  profile: OpenBuddyProfile;
  manager: ProfilePackageManager;
  name: string;
  listPackages: () => Promise<ProfilePackageInfo[]>;
  readPackageManifest: (name: string) => Promise<Record<string, unknown>>;
}

export async function executeRemove(args: RemoveArgs): Promise<void> {
  const { profile, manager, name, readPackageManifest } = args;
  const target = packageTarget(profile, name);
  const before = await readFile(profile.packageJson, "utf8");
  const lockfile = join(profile.dir, "pnpm-lock.yaml");
  const lockfileBefore = await readOptionalFile(lockfile);

  // First try the managed-dependency path: pnpm-tracked dep that resolves
  // through the profile's package.json. We delegate to manager.remove + bundle
  // update, restoring state on failure.
  const manifest = JSON.parse(before) as OpenBuddyProfileManifest;
  const aliasKey = name in (manifest.dependencies ?? {})
    ? name
    : name in (manifest.optionalDependencies ?? {})
    ? name
    : undefined;
  if (aliasKey && aliasKey !== name) {
    const requested = String((manifest.dependencies ?? manifest.optionalDependencies ?? {})[aliasKey]);
    await manager.remove(profile.dir, aliasKey);
    try {
      await updateProfileBundles(profile, name, false);
    } catch (error) {
      try {
        await writeFile(profile.packageJson, before, "utf8");
        await manager.install(profile.dir, dependencySource(name, requested));
        if (lockfileBefore !== undefined) await writeFile(lockfile, lockfileBefore, "utf8");
        else await rm(lockfile, { force: true });
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "profile-package: removal rollback failed");
      }
      throw error;
    }
    return;
  }

  if (!(await stat(target, { throwIfNoEntry: false }))) {
    await manager.remove(profile.dir, name);
    return;
  }

  const packageManifest = await readPackageManifest(name);
  const actualName = typeof packageManifest.name === "string" ? packageManifest.name : name;
  const backup = `${target}.remove-${process.pid}-${Date.now()}`;
  const profileManifestBefore = before;
  await rename(target, backup);
  try {
    if (isBundleManifest(packageManifest)) await updateProfileBundles(profile, actualName, false);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    await rename(backup, target);
    await writeFile(profile.packageJson, profileManifestBefore, "utf8");
    throw error;
  }
}
