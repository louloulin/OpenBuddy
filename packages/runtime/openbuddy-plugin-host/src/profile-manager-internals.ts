/**
 * G3 PR 1 — internal helpers extracted from profile-manager.ts.
 *
 * The typed facade (`profile-manager.ts`) only carries the public surface
 * (`installProfilePackage`, `removeProfilePackage`, `listProfilePackages`,
 * `updateProfileExtensions`, `ensureDefaultPiPackages`). The semver parser,
 * dependency resolver, manifest inspection, and bundle / pi / remote /
 * typert / cordis detector all live here so the typed facade stays under
 * the GA-gate ceiling (≤ 200 LOC).
 *
 * Spec: plan4.1.md §3 PR 1.
 */
import { cp, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";

import { hasRuntimePackageExport, RUNTIME_EXPORT_CONDITIONS } from "./export-target";
import { createUnifiedPluginManifest, type UnifiedPluginManifest } from "./plugin-manifest";
import type { OpenBuddyProfile, OpenBuddyProfileManifest, OpenBuddyPiExtensionSpec } from "./profile";

import type {
  ProfileDependencyDiagnostic,
  ProfilePackageInfo,
} from "./profile-manager";

// ---------- package-name + spec helpers ----------

export function packageName(value: unknown): string {
  if (typeof value !== "string" || !/^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`profile-package: invalid package name ${JSON.stringify(value)}`);
  }
  return value;
}

export function packageTarget(profile: OpenBuddyProfile, name: string): string {
  const parts = packageName(name).split("/");
  return join(profile.dir, "node_modules", ...parts);
}

export function packageNameFromSpecifier(source: string): string | undefined {
  const npmAlias = /^npm:((?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+)/.exec(source);
  if (npmAlias) return npmAlias[1];
  const scoped = /^(@[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)(?:@.*)?$/.exec(source);
  if (scoped) return scoped[1];
  const unscoped = /^([A-Za-z0-9._-]+)(?:@.*)?$/.exec(source);
  return unscoped?.[1];
}

export function isPackageSpecifier(value: string): boolean {
  return /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(value);
}

export async function localDirectorySource(source: string): Promise<string | undefined> {
  if (/^(?:file:|npm:|git(?:\+|:)|github:|https?:\/\/)/i.test(source)) return undefined;
  if (!/^(?:file:|\.{1,2}(?:[\\/]|$)|[\\/]|[A-Za-z]:[\\/])/.test(source)) return undefined;
  const candidate = resolve(source.replace(/^file:/i, ""));
  return (await stat(candidate, { throwIfNoEntry: false }))?.isDirectory() ? candidate : undefined;
}

// ---------- manifest IO ----------

export async function readManifest(path: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await readFile(join(path, "package.json"), "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`profile-package: invalid manifest at ${path}`);
  }
  return value as Record<string, unknown>;
}

export type PackageDependencyManifest = Record<string, unknown> & {
  dependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

// ---------- bundle / pi / remote / typert / cordis detectors ----------

export function isBundleManifest(manifest: Record<string, unknown>): boolean {
  const dsh = manifest.dsh as Record<string, unknown> | undefined;
  const openbuddy = manifest.openbuddy as Record<string, unknown> | undefined;
  return Boolean(dsh?.bundle || openbuddy?.bundle);
}

export function hasClient(manifest: Record<string, unknown>): boolean {
  const dsh = manifest.dsh as Record<string, unknown> | undefined;
  const openbuddy = manifest.openbuddy as Record<string, unknown> | undefined;
  return Boolean(dsh?.client || openbuddy?.client);
}

export function hasPiManifest(manifest: Record<string, unknown>): boolean {
  const pi = manifest.pi;
  if (pi && typeof pi === "object" && !Array.isArray(pi)) {
    return ["extensions", "skills", "prompts", "themes"].some((field) => {
      const entries = (pi as Record<string, unknown>)[field];
      return Array.isArray(entries) && entries.every((entry) => typeof entry === "string");
    });
  }
  return false;
}

export function hasRemoteExport(manifest: Record<string, unknown>): boolean {
  return hasRuntimePackageExport(manifest.exports, "./remote", RUNTIME_EXPORT_CONDITIONS.node);
}

export function hasTypertExport(manifest: Record<string, unknown>): boolean {
  return hasRuntimePackageExport(manifest.exports, "./typert", RUNTIME_EXPORT_CONDITIONS.node);
}

export function hasCordisPlugin(manifest: Record<string, unknown>): boolean {
  const name = typeof manifest.name === "string" ? manifest.name : "";
  const isKnownCordisPackage = name.startsWith("@deepseek-ai/dsh-") || name.startsWith("@cordisjs/cordis-plugin-");
  if (!isKnownCordisPackage) return false;
  const peerDependencies = manifest.peerDependencies as Record<string, unknown> | undefined;
  const dependencies = manifest.dependencies as Record<string, unknown> | undefined;
  return Boolean(
    peerDependencies?.["@deepseek-ai/cordis"] || peerDependencies?.["@cordisjs/core"]
      || dependencies?.["@deepseek-ai/cordis"] || dependencies?.["@cordisjs/core"],
  );
}

export async function hasPiConventionDirectory(path: string): Promise<boolean> {
  for (const field of ["extensions", "skills", "prompts", "themes"]) {
    if ((await stat(join(path, field), { throwIfNoEntry: false }))?.isDirectory()) return true;
  }
  return false;
}

// ---------- node_modules walker + dependency diagnostics ----------

interface ResolvedDependency {
  path: string;
}

interface DependencyDeclaration {
  name: string;
  requested: string;
  optional: boolean;
  peer: boolean;
}

export function copyPackageTree(source: string, target: string): Promise<void> {
  return cp(source, target, {
    recursive: true,
    force: true,
    filter: (path) => basename(path) !== "node_modules",
  });
}

async function resolveDependencyPackage(
  sourceRoot: string,
  dependency: string,
  anchors: readonly string[],
): Promise<ResolvedDependency | undefined> {
  for (const anchor of [join(sourceRoot, "package.json"), ...anchors]) {
    let entry: string;
    try {
      entry = createRequire(anchor).resolve(dependency);
    } catch {
      continue;
    }
    if (entry.startsWith("node:") || entry === dependency) continue;
    let current = resolve(entry);
    while (true) {
      const manifestPath = join(current, "package.json");
      try {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
        if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) return { path: current };
      } catch {
        // Continue walking toward the package root when the resolved entry is nested.
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return undefined;
}

function dependencyNames(manifest: PackageDependencyManifest): DependencyDeclaration[] {
  const optional = new Set(Object.keys(manifest.optionalDependencies ?? {}));
  const peerOptional = new Set(
    Object.entries(manifest.peerDependenciesMeta ?? {})
      .filter(([, metadata]) => metadata?.optional === true)
      .map(([name]) => name),
  );
  const names = new Map<string, { requested: string; optional: boolean }>();
  for (const [name, requested] of Object.entries(manifest.dependencies ?? {})) {
    names.set(name, { requested: typeof requested === "string" ? requested : String(requested), optional: optional.has(name) });
  }
  for (const [name, requested] of Object.entries(manifest.optionalDependencies ?? {})) {
    names.set(name, { requested: typeof requested === "string" ? requested : String(requested), optional: true });
  }
  const peers = new Set(Object.keys(manifest.peerDependencies ?? {}));
  for (const [name, requested] of Object.entries(manifest.peerDependencies ?? {})) {
    names.set(name, { requested: typeof requested === "string" ? requested : String(requested), optional: peerOptional.has(name) });
  }
  return [...names].map(([name, declaration]) => ({
    name,
    requested: declaration.requested,
    optional: declaration.optional,
    peer: peers.has(name),
  }));
}

function dependencyKind(dependency: DependencyDeclaration): ProfileDependencyDiagnostic["kind"] {
  if (dependency.peer) return "peer";
  if (dependency.optional) return "optional";
  return "dependency";
}

function parsedVersion(value: string): [number, number, number] | undefined {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(value.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareVersions(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

function satisfiesVersion(installed: string, requested: string): boolean | undefined {
  const normalized = requested.trim();
  if (normalized === "*" || normalized === "latest" || normalized === "") return true;
  if (normalized.startsWith("workspace:") || normalized.startsWith("npm:")) return undefined;
  const installedVersion = parsedVersion(installed);
  if (!installedVersion) return undefined;
  const comparator = /^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?(?:\.\d+)?(?:[-+].*)?)$/.exec(normalized);
  if (comparator) {
    const requestedVersion = parsedVersion(comparator[2]);
    if (!requestedVersion) return undefined;
    const result = compareVersions(installedVersion, requestedVersion);
    switch (comparator[1]) {
      case ">=": return result >= 0;
      case "<=": return result <= 0;
      case ">":  return result > 0;
      case "<":  return result < 0;
      default:   return result === 0;
    }
  }
  const range = /^(\^|~)\s*(\d+(?:\.\d+)?(?:\.\d+)?(?:[-+].*)?)$/.exec(normalized);
  if (!range) return undefined;
  const requestedVersion = parsedVersion(range[2]);
  if (!requestedVersion || compareVersions(installedVersion, requestedVersion) < 0) return false;
  if (range[1] === "~") return installedVersion[0] === requestedVersion[0] && installedVersion[1] === requestedVersion[1];
  if (requestedVersion[0] > 0) return installedVersion[0] === requestedVersion[0];
  if (requestedVersion[1] > 0) return installedVersion[0] === 0 && installedVersion[1] === requestedVersion[1];
  return installedVersion[0] === 0 && installedVersion[1] === 0 && installedVersion[2] === requestedVersion[2];
}

export async function dependencyDiagnostics(
  packagePath: string,
  manifest: PackageDependencyManifest,
  anchors: readonly string[],
): Promise<ProfileDependencyDiagnostic[]> {
  const diagnostics: ProfileDependencyDiagnostic[] = [];
  for (const dependency of dependencyNames(manifest)) {
    const kind = dependencyKind(dependency);
    if (!isPackageSpecifier(dependency.name)) {
      diagnostics.push({ name: dependency.name, requested: dependency.requested, kind, health: "invalid", message: "依赖名称不是有效的 package specifier" });
      continue;
    }
    const resolved = await resolveDependencyPackage(packagePath, dependency.name, anchors);
    if (!resolved) {
      diagnostics.push({
        name: dependency.name,
        requested: dependency.requested,
        kind,
        health: "missing",
        message: kind === "dependency" ? `缺少必需依赖 ${dependency.name}` : `未提供${kind === "peer" ? " peer" : " optional"} 依赖 ${dependency.name}`,
      });
      continue;
    }
    let installedManifest: Record<string, unknown>;
    try {
      installedManifest = await readManifest(resolved.path);
    } catch {
      diagnostics.push({ name: dependency.name, requested: dependency.requested, kind, health: "invalid", message: `无法读取已安装依赖 ${dependency.name} 的 manifest` });
      continue;
    }
    const installed = typeof installedManifest.version === "string" ? installedManifest.version : undefined;
    const match = installed ? satisfiesVersion(installed, dependency.requested) : undefined;
    if (!installed || match === undefined) {
      diagnostics.push({ name: dependency.name, requested: dependency.requested, ...(installed ? { installed } : {}), kind, health: "invalid", message: `依赖 ${dependency.name} 的版本范围无法诊断` });
    } else if (!match) {
      diagnostics.push({ name: dependency.name, requested: dependency.requested, installed, kind, health: "version-mismatch", message: `需要 ${dependency.requested}，实际为 ${installed}` });
    } else {
      diagnostics.push({ name: dependency.name, requested: dependency.requested, installed, kind, health: "ok", message: `已满足 ${dependency.requested}` });
    }
  }
  return diagnostics;
}

export function dependencyAnchors(profile: OpenBuddyProfile, anchors: readonly string[] = []): string[] {
  return [...new Set([profile.packageJson, ...anchors])];
}

export async function materializeDependencyClosure(
  sourceRoot: string,
  targetRoot: string,
  anchors: readonly string[],
): Promise<void> {
  const active = new Set<string>();
  const stage = async (sourcePackage: string, targetPackage: string): Promise<void> => {
    const canonicalSource = await realpath(sourcePackage);
    if (active.has(canonicalSource)) return;
    active.add(canonicalSource);
    try {
      const manifest = await readManifest(sourcePackage) as PackageDependencyManifest;
      for (const dependency of dependencyNames(manifest)) {
        if (!isPackageSpecifier(dependency.name)) {
          const owner = typeof manifest.name === "string" ? manifest.name : sourcePackage;
          throw new Error(`profile-package: invalid dependency ${dependency.name} declared by ${owner}`);
        }
        const resolved = await resolveDependencyPackage(sourcePackage, dependency.name, anchors);
        if (!resolved) {
          if (dependency.optional || dependency.peer) continue;
          const owner = typeof manifest.name === "string" ? manifest.name : sourcePackage;
          throw new Error(`profile-package: missing dependency ${dependency.name} required by ${owner}`);
        }
        const dependencyTarget = join(targetPackage, "node_modules", ...dependency.name.split("/"));
        await rm(dependencyTarget, { recursive: true, force: true });
        await mkdir(dirname(dependencyTarget), { recursive: true });
        await copyPackageTree(resolved.path, dependencyTarget);
        await stage(resolved.path, dependencyTarget);
      }
    } finally {
      active.delete(canonicalSource);
    }
  };
  await stage(sourceRoot, targetRoot);
}

export async function packageDirectories(root: string): Promise<string[]> {
  const result: string[] = [];
  let rows: string[];
  try { rows = await readdir(root); } catch { return result; }
  for (const row of rows) {
    const path = join(root, row);
    if (row.startsWith("@")) {
      let scoped: string[] = [];
      try { scoped = await readdir(path); } catch { continue; }
      for (const child of scoped) result.push(join(path, child));
    } else result.push(path);
  }
  const checks = await Promise.all(
    result.map(async (path) => ((await stat(path, { throwIfNoEntry: false }))?.isDirectory() ? path : undefined)),
  );
  return checks.filter((path): path is string => path !== undefined);
}

export async function buildProfilePackageInfo(args: {
  path: string;
  manifest: Record<string, unknown>;
  listed: boolean;
  anchors: readonly string[];
}): Promise<ProfilePackageInfo> {
  const { path, manifest, listed, anchors } = args;
  const name = typeof manifest.name === "string" ? manifest.name : basename(path);
  const bundle = isBundleManifest(manifest);
  const client = hasClient(manifest);
  const pi = hasPiManifest(manifest) || await hasPiConventionDirectory(path);
  const remote = hasRemoteExport(manifest);
  const typert = hasTypertExport(manifest);
  const cordis = hasCordisPlugin(manifest);
  const dependencies = await dependencyDiagnostics(path, manifest as PackageDependencyManifest, anchors);
  const piConvention = await hasPiConventionDirectory(path);
  return {
    name,
    ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
    path,
    installed: true,
    bundle,
    client,
    pi,
    remote,
    typert,
    cordis,
    listed,
    health: dependencies.every((dependency) => dependency.health === "ok") ? "healthy" : "degraded",
    dependencies,
    manifest: createUnifiedPluginManifest({
      name,
      path,
      ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
      manifest,
      listed,
      health: dependencies.every((dependency) => dependency.health === "ok") ? "healthy" : "degraded",
      piConvention,
    }) as UnifiedPluginManifest,
  };
}

export function directProfileDependencyNames(manifest: OpenBuddyProfileManifest): string[] {
  return [...new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ])];
}

export function manifestHasDeclaredDependency(
  manifest: OpenBuddyProfileManifest,
  name: string,
): boolean {
  return Boolean(manifest.dependencies?.[name] || manifest.optionalDependencies?.[name]);
}

// ---------- profile-package.json dual-namespace mutators ----------

/**
 * Maintain `manifest.openbuddy.profile.bundles` (primary) and mirror into
 * `manifest.dsh.profile.bundles` (legacy). Atomic via `.tmp` + `rename`
 * so file watchers stay in sync.
 */
export async function updateProfileBundles(profile: OpenBuddyProfile, name: string, present: boolean): Promise<void> {
  const manifest = JSON.parse(await readFile(profile.packageJson, "utf8")) as OpenBuddyProfileManifest;
  const current = new Set<string>([
    ...(manifest.openbuddy?.profile?.bundles ?? []),
    ...(manifest.dsh?.profile?.bundles ?? []),
  ]);
  if (present) current.add(name); else current.delete(name);
  const bundles = [...current];
  const next: OpenBuddyProfileManifest = {
    ...manifest,
    openbuddy: { ...(manifest.openbuddy ?? {}), profile: { ...(manifest.openbuddy?.profile ?? {}), bundles } },
    dsh: { ...(manifest.dsh ?? {}), profile: { ...(manifest.dsh?.profile ?? {}), bundles } },
  };
  const temporary = `${profile.packageJson}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temporary, profile.packageJson);
}

/**
 * Maintain `manifest.openbuddy.profile.piExtensions` (primary) and mirror
 * into `manifest.dsh.profile.piExtensions` (legacy). Dedupes by `id`.
 */
export async function updateProfileExtensions(
  profile: OpenBuddyProfile,
  spec: OpenBuddyPiExtensionSpec | { id: string; source?: string; enabled?: boolean; config?: Record<string, unknown>; passthrough?: boolean },
  present: boolean,
): Promise<void> {
  const manifest = JSON.parse(await readFile(profile.packageJson, "utf8")) as OpenBuddyProfileManifest;
  const current: Array<OpenBuddyPiExtensionSpec | { id: string; source?: string; enabled?: boolean }> = [
    ...(manifest.openbuddy?.profile?.piExtensions ?? []),
    ...(manifest.dsh?.profile?.piExtensions ?? []),
  ];
  const deduped = new Map<string, OpenBuddyPiExtensionSpec | { id: string; source?: string; enabled?: boolean }>();
  for (const entry of current) {
    if (!entry?.id) continue;
    deduped.set(entry.id, { ...deduped.get(entry.id), ...entry });
  }
  if (present) deduped.set(spec.id, { ...deduped.get(spec.id), ...spec });
  else deduped.delete(spec.id);
  const piExtensions = [...deduped.values()];
  const next: OpenBuddyProfileManifest = {
    ...manifest,
    openbuddy: { ...(manifest.openbuddy ?? {}), profile: { ...(manifest.openbuddy?.profile ?? {}), piExtensions } },
    dsh: { ...(manifest.dsh ?? {}), profile: { ...(manifest.dsh?.profile ?? {}), piExtensions } },
  };
  const temporary = `${profile.packageJson}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temporary, profile.packageJson);
}
