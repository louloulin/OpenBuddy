import { cp, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { homedir as osHomedir } from "node:os";
import { OPENBUDDY_PROFILES_DIR, readOpenBuddyProfile, type OpenBuddyProfile, type OpenBuddyProfileManifest, type OpenBuddyProfileOptions, type OpenBuddyPiExtensionSpec } from "./profile";
import { hasRuntimePackageExport, RUNTIME_EXPORT_CONDITIONS } from "./export-target";
import { createUnifiedPluginManifest, type UnifiedPluginManifest } from "./plugin-manifest";

import { EventEmitter as NodeEventEmitter } from "node:events";
// PR-D: Raise the default listener cap so a heavy pi-subagents fan-out
// (one listener per child session) does not flood stderr with
// MaxListenersExceededWarning at module load. 64 leaves ~5x headroom over the
// 11 listener count observed during real-pi E2E while keeping the warning useful.
if (NodeEventEmitter.defaultMaxListeners < 64) NodeEventEmitter.defaultMaxListeners = 64;
if (process.getMaxListeners() < 64) process.setMaxListeners(64);

export interface ProfilePackageInfo {
  name: string;
  version?: string;
  path: string;
  installed: boolean;
  bundle: boolean;
  client: boolean;
  /** Whether the package declares Pi resources or convention directories. */
  pi: boolean;
  /** Whether the package publishes a generated DeepSeek Harness Remote face. */
  remote: boolean;
  /** Whether the package publishes a generated DeepSeek Harness host face. */
  typert: boolean;
  /** Whether the package is a native DeepSeek/Cordis runtime plugin. */
  cordis: boolean;
  listed: boolean;
  health: "healthy" | "degraded";
  dependencies: ProfileDependencyDiagnostic[];
  manifest: UnifiedPluginManifest;
}

export type ProfileDependencyHealth = "ok" | "missing" | "version-mismatch" | "invalid";

export interface ProfileDependencyDiagnostic {
  name: string;
  requested: string;
  installed?: string;
  kind: "dependency" | "optional" | "peer";
  health: ProfileDependencyHealth;
  message: string;
}

export interface ProfilePackageOptions extends OpenBuddyProfileOptions {
  profile?: OpenBuddyProfile;
  packageManager?: ProfilePackageManager;
}

export interface ProfilePackageManager {
  install: (profileDir: string, source: string) => Promise<void>;
  remove: (profileDir: string, packageName: string) => Promise<void>;
}

const execFileAsync = promisify(execFile);

const defaultProfilePackageManager: ProfilePackageManager = {
  async install(profileDir, source) {
    try {
      await execFileAsync("pnpm", ["add", "--save-prod", "--ignore-workspace", "--ignore-scripts", "--", source], {
        cwd: profileDir,
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch (error) {
      const failure = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
      const stderr = typeof failure.stderr === "string" ? failure.stderr.trim() : "";
      const stdout = typeof failure.stdout === "string" ? failure.stdout.trim() : "";
      const details = [stderr, stdout].filter(Boolean).join("\n");
      throw new Error(`profile-package: pnpm add failed for ${source}${details ? `\n${details}` : ""}`, { cause: error });
    }
  },
  async remove(profileDir, packageName) {
    try {
      await execFileAsync("pnpm", ["remove", "--ignore-workspace", "--config.minimumReleaseAge=0", packageName], {
        cwd: profileDir,
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch (error) {
      const failure = error as { stderr?: unknown; stdout?: unknown };
      const stderr = typeof failure.stderr === "string" ? failure.stderr.trim() : "";
      const stdout = typeof failure.stdout === "string" ? failure.stdout.trim() : "";
      const details = [stderr, stdout].filter(Boolean).join("\n");
      throw new Error(`profile-package: pnpm remove failed for ${packageName}${details ? `\n${details}` : ""}`, { cause: error });
    }
  },
};

function packageName(value: unknown): string {
  if (typeof value !== "string" || !/^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`profile-package: invalid package name ${JSON.stringify(value)}`);
  }
  return value;
}

function packageTarget(profile: OpenBuddyProfile, name: string): string {
  const parts = packageName(name).split("/");
  return join(profile.dir, "node_modules", ...parts);
}

async function profileFor(options: ProfilePackageOptions): Promise<OpenBuddyProfile> {
  return options.profile ?? readOpenBuddyProfile(options);
}

function packageManagerFor(options: ProfilePackageOptions): ProfilePackageManager {
  return options.packageManager ?? defaultProfilePackageManager;
}

function directProfileDependencyNames(manifest: OpenBuddyProfileManifest): string[] {
  return [...new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ])];
}

async function localDirectorySource(source: string): Promise<string | undefined> {
  if (/^(?:file:|npm:|git(?:\+|:)|github:|https?:\/\/)/i.test(source)) return undefined;
  if (!/^(?:file:|\.{1,2}(?:[\\/]|$)|[\\/]|[A-Za-z]:[\\/])/.test(source)) return undefined;
  const candidate = resolve(source.replace(/^file:/i, ""));
  return (await stat(candidate, { throwIfNoEntry: false }))?.isDirectory() ? candidate : undefined;
}

function packageNameFromSpecifier(source: string): string | undefined {
  const npmAlias = /^npm:((?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+)/.exec(source);
  if (npmAlias) return npmAlias[1];
  const scoped = /^(@[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)(?:@.*)?$/.exec(source);
  if (scoped) return scoped[1];
  const unscoped = /^([A-Za-z0-9._-]+)(?:@.*)?$/.exec(source);
  return unscoped?.[1];
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function restoreOptionalFile(path: string, content: string | undefined): Promise<void> {
  if (content === undefined) {
    await rm(path, { force: true });
    return;
  }
  await writeFile(path, content, "utf8");
}

function dependencySource(name: string, requested: string): string {
  return /^(?:file:|git(?:\+|:)|github:|https?:\/\/)/i.test(requested)
    ? requested
    : `${name}@${requested}`;
}

async function readManifest(path: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await readFile(join(path, "package.json"), "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`profile-package: invalid manifest at ${path}`);
  return value as Record<string, unknown>;
}

async function managedDependencyFor(
  profile: OpenBuddyProfile,
  requestedName: string,
): Promise<{ name: string; requested: string } | undefined> {
  const manifest = profile.manifest;
  for (const [name, value] of Object.entries(manifest.dependencies ?? {})) {
    const requested = typeof value === "string" ? value : String(value);
    if (name === requestedName) return { name, requested };
    const path = packageTarget(profile, name);
    try {
      const installed = await readManifest(path);
      if (installed.name === requestedName) return { name, requested };
    } catch {
      // pnpm may have removed an alias target; the package-manager key still
      // remains the only safe identity available for cleanup.
    }
  }
  for (const [name, value] of Object.entries(manifest.optionalDependencies ?? {})) {
    const requested = typeof value === "string" ? value : String(value);
    if (name === requestedName) return { name, requested };
    const path = packageTarget(profile, name);
    try {
      const installed = await readManifest(path);
      if (installed.name === requestedName) return { name, requested };
    } catch {
      // See the dependency branch above.
    }
  }
  return undefined;
}

type PackageDependencyManifest = Record<string, unknown> & {
  dependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

interface ResolvedDependency {
  path: string;
}

interface DependencyDeclaration {
  name: string;
  requested: string;
  optional: boolean;
  peer: boolean;
}

function copyPackageTree(source: string, target: string): Promise<void> {
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
        if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
          return { path: current };
        }
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

function isPackageSpecifier(value: string): boolean {
  return /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(value);
}

function dependencyNames(manifest: PackageDependencyManifest): DependencyDeclaration[] {
  const optional = new Set(Object.keys(manifest.optionalDependencies ?? {}));
  const peerOptional = new Set(Object.entries(manifest.peerDependenciesMeta ?? {})
    .filter(([, metadata]) => metadata?.optional === true)
    .map(([name]) => name));
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
      case ">": return result > 0;
      case "<": return result < 0;
      default: return result === 0;
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

async function dependencyDiagnostics(
  packagePath: string,
  manifest: PackageDependencyManifest,
  anchors: readonly string[],
): Promise<ProfileDependencyDiagnostic[]> {
  const diagnostics: ProfileDependencyDiagnostic[] = [];
  for (const dependency of dependencyNames(manifest)) {
    const kind = dependencyKind(dependency);
    const resolved = isPackageSpecifier(dependency.name)
      ? await resolveDependencyPackage(packagePath, dependency.name, anchors)
      : undefined;
    if (!isPackageSpecifier(dependency.name)) {
      diagnostics.push({ name: dependency.name, requested: dependency.requested, kind, health: "invalid", message: "依赖名称不是有效的 package specifier" });
      continue;
    }
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

function dependencyAnchors(profile: OpenBuddyProfile, options: ProfilePackageOptions): string[] {
  return [...new Set([profile.packageJson, ...(options.anchors ?? [])])];
}

/**
 * Copy the source package's resolvable dependency graph into its staged copy.
 * This keeps profile packages self-contained while preserving package-manager
 * resolution semantics for nested and peer dependencies.
 */
async function materializeDependencyClosure(
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
  }

  await stage(sourceRoot, targetRoot);
}

function isBundleManifest(manifest: Record<string, unknown>): boolean {
  const dsh = manifest.dsh as Record<string, unknown> | undefined;
  const openbuddy = manifest.openbuddy as Record<string, unknown> | undefined;
  return Boolean(dsh?.bundle || openbuddy?.bundle);
}

function hasClient(manifest: Record<string, unknown>): boolean {
  const dsh = manifest.dsh as Record<string, unknown> | undefined;
  const openbuddy = manifest.openbuddy as Record<string, unknown> | undefined;
  return Boolean(dsh?.client || openbuddy?.client);
}

function hasPiManifest(manifest: Record<string, unknown>): boolean {
  const pi = manifest.pi;
  if (pi && typeof pi === "object" && !Array.isArray(pi)) {
    return ["extensions", "skills", "prompts", "themes"].some((field) => {
      const entries = (pi as Record<string, unknown>)[field];
      return Array.isArray(entries) && entries.every((entry) => typeof entry === "string");
    });
  }
  return false;
}

function hasRemoteExport(manifest: Record<string, unknown>): boolean {
  return hasRuntimePackageExport(manifest.exports, "./remote", RUNTIME_EXPORT_CONDITIONS.node);
}

function hasTypertExport(manifest: Record<string, unknown>): boolean {
  return hasRuntimePackageExport(manifest.exports, "./typert", RUNTIME_EXPORT_CONDITIONS.node);
}

function hasCordisPlugin(manifest: Record<string, unknown>): boolean {
  const name = typeof manifest.name === "string" ? manifest.name : "";
  const isKnownCordisPackage = name.startsWith("@deepseek-ai/dsh-") || name.startsWith("@cordisjs/cordis-plugin-");
  if (!isKnownCordisPackage) return false;
  const peerDependencies = manifest.peerDependencies as Record<string, unknown> | undefined;
  const dependencies = manifest.dependencies as Record<string, unknown> | undefined;
  return Boolean(peerDependencies?.["@deepseek-ai/cordis"] || peerDependencies?.["@cordisjs/core"]
    || dependencies?.["@deepseek-ai/cordis"] || dependencies?.["@cordisjs/core"]);
}

async function hasPiConventionDirectory(path: string): Promise<boolean> {
  for (const field of ["extensions", "skills", "prompts", "themes"]) {
    if ((await stat(join(path, field), { throwIfNoEntry: false }))?.isDirectory()) return true;
  }
  return false;
}

async function packageDirectories(root: string): Promise<string[]> {
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
  const checks = await Promise.all(result.map(async (path) => ((await stat(path, { throwIfNoEntry: false }))?.isDirectory() ? path : undefined)));
  return checks.filter((path): path is string => path !== undefined);
}

export async function listProfilePackages(options: ProfilePackageOptions): Promise<ProfilePackageInfo[]> {
  const profile = await profileFor(options);
  const listed = new Set(profile.bundles);
  const packages = await packageDirectories(join(profile.dir, "node_modules"));
  const result: ProfilePackageInfo[] = [];
  for (const path of packages) {
    let manifest: Record<string, unknown>;
    try { manifest = await readManifest(path); } catch { continue; }
    const name = typeof manifest.name === "string" ? manifest.name : basename(path);
    const bundle = isBundleManifest(manifest);
    const client = hasClient(manifest);
    const pi = hasPiManifest(manifest) || await hasPiConventionDirectory(path);
    const remote = hasRemoteExport(manifest);
    const typert = hasTypertExport(manifest);
    const cordis = hasCordisPlugin(manifest);
    if (!bundle && !client && !pi && !remote && !typert && !cordis) continue;
    const dependencies = await dependencyDiagnostics(path, manifest as PackageDependencyManifest, dependencyAnchors(profile, options));
    result.push({
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
      listed: listed.has(name),
      health: dependencies.every((dependency) => dependency.health === "ok") ? "healthy" : "degraded",
      dependencies,
      manifest: createUnifiedPluginManifest({
        name,
        path,
        ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
        manifest,
        listed: listed.has(name),
        health: dependencies.every((dependency) => dependency.health === "ok") ? "healthy" : "degraded",
        piConvention: await hasPiConventionDirectory(path),
      }),
    });
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}

async function updateProfileBundles(profile: OpenBuddyProfile, name: string, present: boolean): Promise<void> {
  const manifest = JSON.parse(await readFile(profile.packageJson, "utf8")) as OpenBuddyProfileManifest;
  const current = new Set<string>([
    ...(manifest.openbuddy?.profile?.bundles ?? []),
    ...(manifest.dsh?.profile?.bundles ?? []),
  ]);
  if (present) current.add(name);
  else current.delete(name);
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
 * Phase I.1: mirror of `updateProfileBundles` for `profile.piExtensions`.
 *
 * Maintains `manifest.openbuddy.profile.piExtensions` (primary) and
 * `manifest.dsh.profile.piExtensions` (legacy/dual namespace, kept in
 * sync so legacy readers still see the spec). Atomically writes via
 * `.tmp` + `rename` — identical write pattern to `updateProfileBundles`
 * so existing tooling (file watchers, reload-on-write debouncers) keeps
 * working unchanged.
 *
 * The `present` flag either inserts/updates the spec by `id` (deduped),
 * or removes it. Removal is by `id` only — any fields the user typed
 * by hand into `package.json` survive untouched.
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
  // Dedupe by id, prefer the openbuddy-side entry when both sides declared it.
  const deduped = new Map<string, OpenBuddyPiExtensionSpec | { id: string; source?: string; enabled?: boolean }>();
  for (const entry of current) {
    if (!entry?.id) continue;
    deduped.set(entry.id, { ...deduped.get(entry.id), ...entry });
  }
  if (present) {
    deduped.set(spec.id, { ...deduped.get(spec.id), ...spec });
  } else {
    deduped.delete(spec.id);
  }
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

export async function installProfilePackage(options: ProfilePackageOptions, sourcePath: string): Promise<ProfilePackageInfo> {
  const profile = await profileFor(options);
  const source = await localDirectorySource(sourcePath);
  if (!source) {
    const manager = packageManagerFor(options);
    const before = await readFile(profile.packageJson, "utf8");
    const beforeManifest = JSON.parse(before) as OpenBuddyProfileManifest;
    const lockfile = join(profile.dir, "pnpm-lock.yaml");
    const lockfileBefore = await readOptionalFile(lockfile);
    let installedName: string | undefined = packageNameFromSpecifier(sourcePath);
    if (installedName && (beforeManifest.dependencies?.[installedName] !== undefined || beforeManifest.optionalDependencies?.[installedName] !== undefined)) {
      throw new Error(`profile-package: ${installedName} is already installed; remove it before changing its source`);
    }
    try {
      await manager.install(profile.dir, sourcePath);
      const refreshed = await readOpenBuddyProfile({ ...options, profileDir: profile.dir });
      const candidates = directProfileDependencyNames(refreshed.manifest)
        .filter((name) => !beforeManifest.dependencies?.[name] && !beforeManifest.optionalDependencies?.[name] || name === installedName);
      installedName ??= candidates.length === 1 ? candidates[0] : undefined;
      const packageInfos = await listProfilePackages({ ...options, profile: refreshed });
      const resolvedInstalledName = installedName;
      const result = (resolvedInstalledName
        ? packageInfos.find((item) => item.name === resolvedInstalledName)
        : undefined)
        ?? (resolvedInstalledName
          ? packageInfos.find((item) => resolve(item.path) === resolve(packageTarget(refreshed, resolvedInstalledName)))
          : undefined)
        ?? packageInfos.find((item) => candidates.includes(item.name));
      if (!result) throw new Error(`profile-package: installed source ${sourcePath} did not provide a supported package`);
      if (result.bundle && !refreshed.bundles.includes(result.name)) {
        await updateProfileBundles(refreshed, result.name, true);
        const afterBundleUpdate = await readOpenBuddyProfile({ ...options, profileDir: profile.dir });
        return (await listProfilePackages({ ...options, profile: afterBundleUpdate })).find((item) => item.name === result.name)!;
      }
      return result;
    } catch (error) {
      try {
        const afterInstall = await readOptionalFile(profile.packageJson);
        const afterManifest = afterInstall ? JSON.parse(afterInstall) as OpenBuddyProfileManifest : beforeManifest;
        const names = [...new Set([
          ...(installedName ? [installedName] : []),
          ...directProfileDependencyNames(afterManifest).filter((name) =>
            !beforeManifest.dependencies?.[name] && !beforeManifest.optionalDependencies?.[name]),
        ])];
        for (const name of names) await manager.remove(profile.dir, name);
        await writeFile(profile.packageJson, before, "utf8");
        await restoreOptionalFile(lockfile, lockfileBefore);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "profile-package: installation rollback failed");
      }
      throw error;
    }
  }
  const sourceManifest = await readManifest(source);
  const name = packageName(sourceManifest.name);
  if (!isBundleManifest(sourceManifest) && !hasClient(sourceManifest) && !hasPiManifest(sourceManifest) && !await hasPiConventionDirectory(source) && !hasRemoteExport(sourceManifest) && !hasTypertExport(sourceManifest) && !hasCordisPlugin(sourceManifest)) {
    throw new Error(`profile-package: ${name} does not declare a supported OpenBuddy, Pi, generated Harness, or Cordis plugin surface`);
  }
  const target = packageTarget(profile, name);
  const temporary = `${target}.openbuddy-${process.pid}-${Date.now()}`;
  const backup = `${target}.backup-${process.pid}-${Date.now()}`;
  const profileManifestBefore = await readFile(profile.packageJson, "utf8");
  await mkdir(dirname(target), { recursive: true });
  await rm(temporary, { recursive: true, force: true });
  const hadPrevious = (await stat(target, { throwIfNoEntry: false })) !== undefined;
  if (hadPrevious) await rename(target, backup);
  try {
    await copyPackageTree(source, temporary);
    await materializeDependencyClosure(source, temporary, dependencyAnchors(profile, options));
    await rename(temporary, target);
    if (isBundleManifest(sourceManifest)) await updateProfileBundles(profile, name, true);
    if (hadPrevious) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
    if (hadPrevious) await rename(backup, target);
    await writeFile(profile.packageJson, profileManifestBefore, "utf8");
    throw error;
  }
  return (await listProfilePackages(options)).find((item) => item.name === name)!;
}

export async function removeProfilePackage(options: ProfilePackageOptions, name: string): Promise<void> {
  const profile = await profileFor(options);
  const target = packageTarget(profile, name);
  const managedDependency = await managedDependencyFor(profile, name);
  if (managedDependency) {
    const requested = managedDependency.requested;
    const before = await readFile(profile.packageJson, "utf8");
    const lockfile = join(profile.dir, "pnpm-lock.yaml");
    const lockfileBefore = await readOptionalFile(lockfile);
    const manager = packageManagerFor(options);
    await manager.remove(profile.dir, managedDependency.name);
    try {
      await updateProfileBundles(profile, name, false);
    } catch (error) {
      try {
        await writeFile(profile.packageJson, before, "utf8");
        await manager.install(profile.dir, dependencySource(name, String(requested)));
        await restoreOptionalFile(lockfile, lockfileBefore);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "profile-package: removal rollback failed");
      }
      throw error;
    }
    return;
  }
  if (!(await stat(target, { throwIfNoEntry: false }))) {
    await packageManagerFor(options).remove(profile.dir, packageName(name));
    return;
  }
  const packageManifest = await readManifest(target);
  const actualName = packageName(packageManifest.name ?? name);
  const backup = `${target}.remove-${process.pid}-${Date.now()}`;
  const profileManifestBefore = await readFile(profile.packageJson, "utf8");
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

/**
 * C6: Default Pi package bundle.
 *
 * Every entry has been validated end-to-end against OpenBuddy (see
 * `docs/pi-real-plugin-compatibility.md`). Opt the desktop installer in
 * through `OPENBUDDY_INSTALL_DEFAULT_PI=1` at boot, or call
 * `ensureDefaultPiPackages({ force })` from the host bootstrap.
 *
 * Versions are pinned so the bundle reproduces the same surface for every
 * user until upstream breaks ABI and we move the line forward.
 */
export const OPENBUDDY_DEFAULT_PI_PACKAGES: readonly string[] = Object.freeze([
  "npm:pi-context-prune@1.3.0",
  "npm:pi-mcp-adapter@2.31.0",
  "npm:pi-web-access@0.27.0",
  "npm:pi-goal@0.1.7",
  "npm:pi-plan-mode@0.4.8",
  "npm:pi-subagents@0.59.0",
]);

export interface DefaultPiPackageResult {
  spec: string;
  status: "installed" | "skipped" | "failed";
  error?: string;
}

/**
 * Install the curated default Pi package bundle into the user profile.
 * Already-installed packages are detected by name and skipped. Failures
 * are reported as `status: "failed"` so callers can surface a toast without
 * crashing the host.
 */
export async function ensureDefaultPiPackages(options: {
  home?: string;
  profileName?: string;
  profileDir?: string;
  force?: boolean;
} = {}): Promise<DefaultPiPackageResult[]> {
  const results: DefaultPiPackageResult[] = [];
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
      if (/already installed|EEXIST/i.test(message)) {
        results.push({ spec, status: "skipped" });
      } else {
        results.push({ spec, status: "failed", error: message });
      }
    }
  }
  return results;
}
