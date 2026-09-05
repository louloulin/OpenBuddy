import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import type { PluginBundle, PluginPatch, PluginProfile } from "./index";
import { manifestToBundle, readBundleManifest, type ReadBundleManifestOptions } from "./bundle-manifest";

export interface OpenBuddyProfileManifest {
  name?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  pi?: PiPackageManifest;
  openbuddy?: { profile?: { bundles?: readonly string[]; piExtensions?: readonly OpenBuddyPiExtensionSpec[] } };
  dsh?: { profile?: { bundles?: readonly string[]; piExtensions?: readonly OpenBuddyPiExtensionSpec[] } };
}

function bundleDeclaration(manifest: Record<string, unknown>): boolean {
  for (const namespace of ["openbuddy", "dsh"] as const) {
    const value = manifest[namespace];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const bundle = (value as Record<string, unknown>).bundle;
    if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) continue;
    if (typeof (bundle as Record<string, unknown>).patch === "string") return true;
    if (Array.isArray((bundle as Record<string, unknown>).entries) || Array.isArray((bundle as Record<string, unknown>).patches)) return true;
  }
  return false;
}

async function discoverProfileDependencyBundles(
  profileDir: string,
  manifest: OpenBuddyProfileManifest,
  explicit: readonly string[],
): Promise<string[]> {
  const declared = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];
  if (!declared.length) return [...explicit];
  const explicitSet = new Set(explicit);
  const packagePaths = new Map<string, string>();
  for (const packagePath of await packageDirectories(join(profileDir, "node_modules"))) {
    let packageManifest: Record<string, unknown>;
    try {
      packageManifest = JSON.parse(await readFile(join(packagePath, "package.json"), "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    const name = typeof packageManifest.name === "string" ? packageManifest.name : undefined;
    if (name) packagePaths.set(name, packagePath);
  }
  const discovered = [...explicit];
  for (const name of declared) {
    if (explicitSet.has(name)) continue;
    const packagePath = packagePaths.get(name);
    if (!packagePath) continue;
    try {
      const packageManifest = JSON.parse(await readFile(join(packagePath, "package.json"), "utf8")) as Record<string, unknown>;
      if (bundleDeclaration(packageManifest)) discovered.push(name);
    } catch {
      // A package that disappears during a profile reload is handled by the
      // normal bundle resolver, which reports the actionable failure.
    }
  }
  return discovered;
}

export interface PiPackageManifest {
  extensions?: readonly string[];
  skills?: readonly string[];
  prompts?: readonly string[];
  themes?: readonly string[];
}

export interface PiPackageResourcePaths {
  extensions: readonly string[];
  skills: readonly string[];
  prompts: readonly string[];
  themes: readonly string[];
}

/**
 * A Pi extension can either name a host-provided built-in or point at a Pi
 * extension module/package resolved from the profile's dependency graph.
 */
export interface OpenBuddyPiExtensionSpec {
  id: string;
  source?: string;
  enabled?: boolean;
  config?: unknown;
  /**
   * Opt-in flag for high-traffic Pi packages (mcp-adapter, web-access,
   * subagents, todo). When true AND the matching compatibility adapter
   * also declares `passthrough: true`, OpenBuddy skips the adapter
   * substitution so the native Pi package runs. Falls back to the
   * canonical OpenBuddy service when the package is unavailable.
   */
  passthrough?: boolean;
}

export interface OpenBuddyProfile {
  name: string;
  dir: string;
  packageJson: string;
  manifest: OpenBuddyProfileManifest;
  bundles: readonly string[];
  piExtensions: readonly OpenBuddyPiExtensionSpec[];
  /** Profile and installed dependency roots that declare Pi resources. */
  piPackagePaths: readonly string[];
  /** Every installed profile package root, including Harness client/bundle packages. */
  packagePaths: readonly string[];
  /** Resource paths grouped for Pi's native DefaultResourceLoader options. */
  piResourcePaths: PiPackageResourcePaths;
  patchPath: string;
  homePatchPath: string;
}

export interface OpenBuddyProfileOptions {
  home?: string;
  profileName?: string;
  profileDir?: string;
  profilePatchFile?: string;
  homePatchFile?: string;
  includeHomePatch?: boolean;
  anchors?: readonly string[];
  patchLoader?: (path: string) => Promise<string>;
  scope?: Record<string, unknown>;
}

export const OPENBUDDY_PROFILES_DIR = "profiles";
export const OPENBUDDY_PROFILE_PATCH_FILE = "cordis.patch.yml";

const DEFAULT_PROFILE_PACKAGE = (name: string): string => `${JSON.stringify({
  name: `openbuddy-profile-${name}`,
  private: true,
  dependencies: {},
  openbuddy: { profile: { bundles: [] } },
  dsh: { profile: { bundles: [] } },
}, null, 2)}\n`;

const DEFAULT_PROFILE_PATCH = "# OpenBuddy user patch layer; applied after profile bundles.\n[]\n";

export function defaultOpenBuddyProfileHome(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? homedir(), ".pi", "agent");
}

function validateProfileName(name: string): void {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new Error(`profile: invalid profile name ${JSON.stringify(name)}`);
  }
}

export function resolveOpenBuddyProfileDir(name: string, home: string): string {
  validateProfileName(name);
  return join(home, OPENBUDDY_PROFILES_DIR, name);
}

/**
 * Create the Harness-style profile scaffold without overwriting user files.
 * The desktop host always has a profile to layer user bundles and patches on;
 * keeping both manifest namespaces makes a profile consumable by OpenBuddy
 * and by DeepSeek-style tooling without a migration step.
 */
export async function ensureOpenBuddyProfile(options: {
  home?: string;
  profileName?: string;
  profileDir?: string;
} = {}): Promise<{ dir: string; created: boolean }> {
  const dir = options.profileDir
    ? resolve(options.profileDir)
    : resolveOpenBuddyProfileDir(options.profileName ?? "desktop", options.home ?? defaultOpenBuddyProfileHome());
  validateProfileName(options.profileName ?? "desktop");
  await mkdir(dir, { recursive: true });
  const packageJson = join(dir, "package.json");
  const patchPath = join(dir, OPENBUDDY_PROFILE_PATCH_FILE);
  let created = false;
  if (!(await fileExists(packageJson))) {
    try {
      await writeFile(packageJson, DEFAULT_PROFILE_PACKAGE(options.profileName ?? basename(dir)), { flag: "wx" });
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  if (!(await fileExists(patchPath))) {
    try {
      await writeFile(patchPath, DEFAULT_PROFILE_PATCH, { flag: "wx" });
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  return { dir, created };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const PI_RESOURCE_DIRECTORIES = ["extensions", "skills", "prompts", "themes"] as const;

async function packageDirectories(root: string): Promise<string[]> {
  const result: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return result;
  }
  for (const entry of entries) {
    const path = join(root, entry);
    if (entry.startsWith("@")) {
      let scopedEntries: string[];
      try {
        scopedEntries = await readdir(path);
      } catch {
        continue;
      }
      result.push(...scopedEntries.map((scopedEntry) => join(path, scopedEntry)));
    } else {
      result.push(path);
    }
  }
  const checks = await Promise.all(result.map(async (path) => ((await stat(path, { throwIfNoEntry: false }))?.isDirectory() ? path : undefined)));
  return checks.filter((path): path is string => path !== undefined);
}

function hasGlob(value: string): boolean {
  return /[*?[\]{}]/u.test(value);
}

function resourcePathForEntry(root: string, entry: string): string | undefined {
  const normalized = entry.trim();
  if (!normalized || normalized.startsWith("!") || normalized.startsWith("-")) return undefined;
  const pattern = normalized.startsWith("+") ? normalized.slice(1) : normalized;
  if (!pattern) return undefined;
  if (!hasGlob(pattern)) return resolve(root, pattern);
  const wildcardIndex = pattern.search(/[*?[\]{}]/u);
  const prefix = pattern.slice(0, wildcardIndex);
  const slash = Math.max(prefix.lastIndexOf("/"), prefix.lastIndexOf("\\"));
  return resolve(root, slash >= 0 ? prefix.slice(0, slash) || "." : ".");
}

async function extensionPathForEntry(root: string, entry: string): Promise<string | undefined> {
  const path = resourcePathForEntry(root, entry);
  if (!path) return undefined;
  return (await stat(path, { throwIfNoEntry: false }))?.isDirectory() ? root : path;
}

function overridePattern(value: string): boolean {
  return value.startsWith("!") || value.startsWith("+") || value.startsWith("-");
}

function resourceGlobRegex(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//u, "");
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]!;
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        if (normalized[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    if (character === "[") {
      const end = normalized.indexOf("]", index + 1);
      if (end > index + 1) {
        source += normalized.slice(index, end + 1);
        index = end;
        continue;
      }
    }
    if (character === "{") {
      const end = normalized.indexOf("}", index + 1);
      if (end > index + 1) {
        const alternatives = normalized.slice(index + 1, end).split(",").map((value) =>
          value.replace(/[.+^${}()|\\]/gu, "\\$&"),
        );
        if (alternatives.length > 1) {
          source += `(?:${alternatives.join("|")})`;
          index = end;
          continue;
        }
      }
    }
    source += character.replace(/[.+^${}()|\\]/gu, "\\$&");
  }
  return new RegExp(`${source}$`, "u");
}

async function resourceFiles(root: string, resource: typeof PI_RESOURCE_DIRECTORIES[number]): Promise<string[]> {
  const directory = join(root, resource);
  const result: string[] = [];
  const walk = async (current: string): Promise<void> => {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const valid = resource === "extensions"
        ? /\.(?:js|ts)$/u.test(entry.name)
        : resource === "themes"
          ? entry.name.endsWith(".json")
          : entry.name.endsWith(".md");
      if (valid) result.push(path);
    }
  };
  await walk(directory);
  return result;
}

async function filteredResourcePaths(
  root: string,
  resource: typeof PI_RESOURCE_DIRECTORIES[number],
  entries: readonly string[],
): Promise<string[]> {
  const sourceEntries = entries.filter((entry) => !overridePattern(entry));
  const overrides = entries.filter(overridePattern);
  const allFiles = await resourceFiles(root, resource);
  const matches = (file: string, pattern: string): boolean => {
    const relativePath = relative(root, file).replaceAll("\\", "/");
    const normalizedPattern = pattern.replaceAll("\\", "/").replace(/^\.\//u, "");
    if (resourceGlobRegex(normalizedPattern).test(relativePath)) return true;
    if (resource !== "skills" || basename(file) !== "SKILL.md") return false;
    const skillDirectory = relative(root, dirname(file)).replaceAll("\\", "/");
    return resourceGlobRegex(normalizedPattern).test(skillDirectory)
      || resourceGlobRegex(normalizedPattern).test(basename(dirname(file)));
  };
  const candidates = new Set<string>();
  for (const file of allFiles) {
    const included = sourceEntries.length === 0 || sourceEntries.some((entry) => {
      const pattern = entry.replaceAll("\\", "/").replace(/^\.\//u, "");
      if (hasGlob(pattern)) return matches(file, pattern);
      const exact = resolve(root, entry);
      return file === exact || file.startsWith(`${exact}/`);
    });
    if (included) candidates.add(file);
  }
  for (const entry of overrides.filter((value) => value.startsWith("+"))) {
    const pattern = entry.slice(1);
    for (const file of allFiles) {
      if (matches(file, pattern)) candidates.add(file);
    }
  }
  const enabled = [...candidates].filter((file) => {
    const excluded = overrides.some((entry) => entry.startsWith("!") && matches(file, entry.slice(1)));
    const forceExcluded = overrides.some((entry) => entry.startsWith("-") && matches(file, entry.slice(1)));
    const forceIncluded = overrides.some((entry) => entry.startsWith("+") && matches(file, entry.slice(1)));
    return (forceIncluded || !excluded) && !forceExcluded;
  });
  return enabled.sort().map((file) => resource === "skills" && basename(file) === "SKILL.md" ? dirname(file) : file);
}

async function packageResourcePaths(root: string): Promise<PiPackageResourcePaths | undefined> {
  let manifest: { pi?: PiPackageManifest } | undefined;
  try {
    manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { pi?: PiPackageManifest };
  } catch {
    // Convention directories are still valid Pi packages without package.json.
  }
  const declared = manifest?.pi;
  const result = {} as Record<keyof PiPackageResourcePaths, string[]>;
  for (const resource of PI_RESOURCE_DIRECTORIES) {
    const entries = declared?.[resource];
    if (declared && typeof declared === "object" && entries !== undefined) {
      const validEntries = Array.isArray(entries) && entries.every((entry): entry is string => typeof entry === "string") ? entries : [];
      if (validEntries.some((entry) => hasGlob(entry) || overridePattern(entry))) {
        result[resource] = await filteredResourcePaths(root, resource, validEntries);
      } else {
        const declaredPaths = (await Promise.all(
          validEntries.map(async (entry) => resource === "extensions" ? await extensionPathForEntry(root, entry) : resourcePathForEntry(root, entry)),
        )).filter((path): path is string => Boolean(path));
        const conventional = join(root, resource);
        const allDeclaredPathsOutsideRoot = declaredPaths.length > 0 && declaredPaths.every((path) => {
          const relativePath = relative(root, path);
          return relativePath.startsWith("..") || relativePath.startsWith("/") || relativePath.startsWith("\\");
        });
        result[resource] = allDeclaredPathsOutsideRoot && (await stat(conventional, { throwIfNoEntry: false }))?.isDirectory()
          ? [resource === "extensions" ? root : conventional]
          : declaredPaths;
      }
      continue;
    }
    const conventional = join(root, resource);
    result[resource] = (await stat(conventional, { throwIfNoEntry: false }))?.isDirectory()
      ? [resource === "extensions" ? root : conventional]
      : [];
  }
  const hasResources = PI_RESOURCE_DIRECTORIES.some((resource) => result[resource].length > 0);
  return hasResources ? result : undefined;
}

/** Discover Pi package resources and map them to the loader's typed path options. */
export async function discoverPiPackageResources(profileDir: string): Promise<{ packagePaths: string[]; resources: PiPackageResourcePaths }> {
  const candidates = await discoverProfilePackagePaths(profileDir);
  const packagePaths: string[] = [];
  const resources: Record<keyof PiPackageResourcePaths, string[]> = { extensions: [], skills: [], prompts: [], themes: [] };
  for (const candidate of candidates) {
    const packageResources = await packageResourcePaths(candidate);
    if (!packageResources) continue;
    packagePaths.push(candidate);
    for (const resource of PI_RESOURCE_DIRECTORIES) resources[resource].push(...packageResources[resource]);
  }
  return {
    packagePaths,
    resources: {
      extensions: [...new Set(resources.extensions)],
      skills: [...new Set(resources.skills)],
      prompts: [...new Set(resources.prompts)],
      themes: [...new Set(resources.themes)],
    },
  };
}

/** Discover the profile root and its direct installed package roots. */
export async function discoverProfilePackagePaths(profileDir: string): Promise<string[]> {
  return [resolve(profileDir), ...(await packageDirectories(join(profileDir, "node_modules")))];
}

/** Discover profile roots that Pi can resolve using its native package rules. */
export async function discoverPiPackagePaths(profileDir: string): Promise<string[]> {
  return (await discoverPiPackageResources(profileDir)).packagePaths;
}

export async function readOpenBuddyProfile(options: OpenBuddyProfileOptions): Promise<OpenBuddyProfile> {
  const dir = options.profileDir
    ? resolve(options.profileDir)
    : resolveOpenBuddyProfileDir(options.profileName ?? "desktop", options.home ?? defaultOpenBuddyProfileHome());
  const packageJson = join(dir, "package.json");
  const raw = await readFile(packageJson, "utf8");
  const manifest = JSON.parse(raw) as OpenBuddyProfileManifest;
  const openBuddyBundles = manifest.openbuddy?.profile?.bundles;
  const deepSeekBundles = manifest.dsh?.profile?.bundles;
  const declaredBundles = openBuddyBundles?.length
    ? openBuddyBundles
    : deepSeekBundles ?? openBuddyBundles ?? [];
  const bundles = await discoverProfileDependencyBundles(dir, manifest, declaredBundles);
  const openBuddyExtensions = manifest.openbuddy?.profile?.piExtensions;
  const deepSeekExtensions = manifest.dsh?.profile?.piExtensions;
  const piExtensions = openBuddyExtensions?.length
    ? openBuddyExtensions
    : deepSeekExtensions ?? openBuddyExtensions ?? [];
  const piResources = await discoverPiPackageResources(dir);
  const packagePaths = await discoverProfilePackagePaths(dir);
  const patchPath = resolve(dir, options.profilePatchFile ?? OPENBUDDY_PROFILE_PATCH_FILE);
  const homePatchPath = resolve(options.home ?? dirname(dirname(dir)), options.homePatchFile ?? OPENBUDDY_PROFILE_PATCH_FILE);
  return {
    name: manifest.name ?? options.profileName ?? dirname(dir),
    dir,
    packageJson,
    manifest,
    bundles,
    piExtensions,
    piPackagePaths: piResources.packagePaths,
    packagePaths,
    piResourcePaths: piResources.resources,
    patchPath,
    homePatchPath,
  };
}

export async function resolvePackageFromAnchors(specifier: string, anchors: readonly string[]): Promise<string> {
  const failures: string[] = [];
  for (const anchor of anchors) {
    const resolver = createRequire(anchor);
    try {
      return resolver.resolve(specifier);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      for (const searchPath of resolver.resolve.paths(specifier) ?? []) {
        const packageJson = join(searchPath, specifier, "package.json");
        try {
          if ((await stat(packageJson, { throwIfNoEntry: false }))?.isFile()) return packageJson;
        } catch {
          // Continue to the next Node resolution anchor.
        }
      }
    }
  }
  throw new Error(`profile: cannot resolve ${JSON.stringify(specifier)} from ${anchors.join(", ")}; ${failures.join(" | ")}`);
}

async function readPatch(path: string, loader?: (path: string) => Promise<string>): Promise<string | undefined> {
  if (!(await fileExists(path))) return undefined;
  return loader ? loader(path) : readFile(path, "utf8");
}

export async function materializeOpenBuddyProfile(
  options: OpenBuddyProfileOptions,
): Promise<{ profile: OpenBuddyProfile; bundle: PluginProfile }> {
  const profile = await readOpenBuddyProfile(options);
  const anchors = options.anchors?.length ? [...options.anchors] : [profile.packageJson];
  const manifestOptions: ReadBundleManifestOptions = {
    importer: async (specifier) => resolvePackageFromAnchors(specifier, anchors),
    patchLoader: options.patchLoader,
    scope: options.scope,
  };
  const bundles: PluginBundle[] = [];
  for (const specifier of profile.bundles) {
    const manifest = await readBundleManifest(specifier, manifestOptions);
    bundles.push(await manifestToBundle(manifest, manifestOptions));
  }
  const layers: PluginPatch[][] = [];
  for (const path of [profile.patchPath, ...(options.includeHomePatch === false ? [] : [profile.homePatchPath])]) {
    const source = await readPatch(path, options.patchLoader);
    if (source?.trim()) {
      const { parseCordisPatch, patchRowsToOpenBuddy } = await import("./yaml-patch");
      const parsed = parseCordisPatch(source);
      for (const layer of parsed.layers) {
        layers.push(patchRowsToOpenBuddy(layer.rows, { ...(options.scope ?? {}), dshHomePath: (sub: string) => join(options.home ?? dirname(dirname(profile.dir)), sub) }) as PluginPatch[]);
      }
    }
  }
  const entries = bundles.flatMap((bundle) => bundle.entries.map((entry) => ({ ...entry })));
  return { profile, bundle: { entries, patches: [...bundles.flatMap((bundle) => bundle.patches ?? []), ...layers] } };
}
