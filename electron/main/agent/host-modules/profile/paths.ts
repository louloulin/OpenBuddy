/**
 * host-modules/profile/paths.ts — profile + artifact path helpers.
 *
 * Stage F-2: 从 agent-host.ts:1267-1311 抽出。6 个 helper 全部围绕
 * `state.profileOptions / state.profilePackagePaths` 的解析与展平:
 *   - profilePatchPaths:  静态 watch paths(profile patch + home patch)
 *   - profileResourceWatchPaths: profilePatchPaths + profile dir + 所有 package
 *   - packageRootForLoaderSpecifier: specifier → package name
 *   - marketplaceArtifactPackagePaths: cwd 内已启用的 marketplace plugin 根路径
 *   - artifactPackagePaths: profile + marketplace 合并去重
 *   - artifactPackageJsonByName: 用 profile-artifact-resolution 解析 package.json
 *
 * 设计:
 *   - 没有 module-level mutable
 *   - state 通过参数注入(避免循环依赖)
 *   - async helpers 都走参数(避免硬依赖 pi-resources/discoverProfilePackageJsons
 *     module load 时机)
 */

import { resolve, join } from "node:path";
import {
  defaultOpenBuddyProfileHome,
  type OpenBuddyProfileOptions,
} from "@openbuddy/plugin-host";

import { discoverProfilePackageJsons } from "../../profile-artifact-resolution";

const OVERRIDE_PATCH_FILE = "cordis.patch.yml";

export function profilePatchPaths(
  profileOptions: OpenBuddyProfileOptions | null | undefined,
  piHome: () => string,
): string[] {
  const paths = new Set<string>();
  if (profileOptions) {
    const profileDir = profileOptions.profileDir
      ? resolve(profileOptions.profileDir)
      : join(
          profileOptions.home ?? defaultOpenBuddyProfileHome(),
          "profiles",
          profileOptions.profileName ?? "desktop",
        );
    paths.add(join(profileDir, profileOptions.profilePatchFile ?? "cordis.patch.yml"));
    paths.add(join(profileDir, "package.json"));
    paths.add(
      join(
        profileOptions.home ?? defaultOpenBuddyProfileHome(),
        profileOptions.homePatchFile ?? "cordis.patch.yml",
      ),
    );
  }
  paths.add(join(piHome(), OVERRIDE_PATCH_FILE));
  return [...paths];
}

export function packageRootForLoaderSpecifier(
  specifier: string,
  packageNames: Iterable<string>,
): string | undefined {
  for (const packageName of packageNames) {
    if (specifier === packageName || specifier.startsWith(`${packageName}/`)) return packageName;
  }
  return undefined;
}

export function profileResourceWatchPaths(
  profileOptions: OpenBuddyProfileOptions | null | undefined,
  profilePackagePaths: readonly string[],
  piHome: () => string,
): string[] {
  const paths = new Set(profilePatchPaths(profileOptions, piHome));
  if (profileOptions) {
    const profileDir = profileOptions.profileDir
      ? resolve(profileOptions.profileDir)
      : join(
          profileOptions.home ?? defaultOpenBuddyProfileHome(),
          "profiles",
          profileOptions.profileName ?? "desktop",
        );
    paths.add(profileDir);
  }
  for (const packagePath of profilePackagePaths) paths.add(packagePath);
  return [...paths];
}

export async function marketplaceArtifactPackagePaths(cwd: string | null): Promise<string[]> {
  // P2-13: listPlugins lives in the heavy marketplace module. Lazy-load
  // so the cold-start path doesn't pay for the HTML parser + tarball unpack
  // until a renderer actually asks for marketplace plugin paths.
  const { listPlugins } = await import("../../pi-resources/marketplace");
  const plugins = await listPlugins(cwd);
  return plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.root);
}

export async function artifactPackagePaths(
  profilePackagePaths: readonly string[],
  cwd: string | null,
): Promise<string[]> {
  return [...new Set([...profilePackagePaths, ...(await marketplaceArtifactPackagePaths(cwd))])];
}

export async function artifactPackageJsonByName(
  profilePackagePaths: readonly string[],
  cwd: string | null,
): Promise<Map<string, string>> {
  return discoverProfilePackageJsons(await artifactPackagePaths(profilePackagePaths, cwd));
}