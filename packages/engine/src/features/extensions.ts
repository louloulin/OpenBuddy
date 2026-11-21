import { discoverAndLoadExtensions, type PackageSource, type ResolvedPaths } from "@earendil-works/pi-coding-agent";
import type { ExtensionPackageFilters } from "@openbuddy/protocol/extensions";
import { EXTENSION_RESOURCE_KINDS } from "@openbuddy/protocol/extensions";
import type { ExtensionResources } from "@openbuddy/protocol/extensions";
import type { EngineContext } from "../engine-context.js";
import { reserveBuiltinToolNames } from "../builtin/reserved-tools.js";

/**
 * 扩展中心 (20261116-pii W2.6 / U7.3): what one extension registers.
 *
 * Loading is isolated from the live sessions (`discoverAndLoadExtensions` with just the paths we
 * ask about), so a broken extension cannot affect a running session — and the UI can preview a
 * path *before* it is added to the settings.
 */
export interface ExtensionReport {
  /** The configured path (or the path the user is previewing). */
  path: string;
  /** Absolute path Pi resolved it to (null when loading failed). */
  resolvedPath: string | null;
  ok: boolean;
  tools: string[];
  commands: string[];
  shortcuts: string[];
  /** Why this path failed to load (null when it loaded). */
  error: string | null;
}

/** Turn one package's contribution into the grouped list the 扩展中心 renders (S15). */
export function packageResources(resolved: ResolvedPaths): ExtensionResources {
  const map = (entries: ResolvedPaths["extensions"]) =>
    entries
      .filter((entry) => entry.metadata.origin === "package")
      .map((entry) => ({
        source: entry.metadata.source,
        scope: entry.metadata.scope === "project" ? "project" as const : "user" as const,
        path: entry.path,
        enabled: entry.enabled,
        ...(entry.metadata.changelogPath ? { changelogPath: entry.metadata.changelogPath } : {}),
      }));
  return {
    extensions: map(resolved.extensions),
    skills: map(resolved.skills),
    prompts: map(resolved.prompts),
    themes: map(resolved.themes),
    failures: (resolved.installFailures ?? []).map((failure) => ({ source: failure.source, message: failure.message })),
  };
}

export function packageSourceOf(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}

/**
 * Read a configured package's per-resource filters (S17 / E1). Pi's object form uses `[]` to load
 * none of a type, a pattern list to load only what matches, and omits the key to load all.
 */
export function packageFilterState(entry: PackageSource | undefined): ExtensionPackageFilters | undefined {
  if (!entry || typeof entry === "string") return undefined;
  const filters: ExtensionPackageFilters = {};
  for (const kind of EXTENSION_RESOURCE_KINDS) {
    const value = entry[kind];
    if (!Array.isArray(value)) continue;
    filters[kind] = value.length > 0 ? [...value] : false;
  }
  return Object.keys(filters).length ? filters : undefined;
}

/**
 * Apply the per-resource filters to one configured package (S17 / E1), keeping any other Pi options
 * (`autoload`, custom globs). `true` drops the filter (load everything), `false` becomes `[]` and a
 * pattern list is written verbatim so Pi applies its own glob rules. Collapses back to the plain
 * string form when nothing else remains.
 */
export function applyPackageFilters(entry: PackageSource, enabled: ExtensionPackageFilters): PackageSource {
  const next: Exclude<PackageSource, string> = typeof entry === "string" ? { source: entry } : { ...entry };
  for (const kind of EXTENSION_RESOURCE_KINDS) {
    const value = enabled[kind];
    if (value === undefined) continue;
    if (value === true) delete next[kind];
    else if (value === false) next[kind] = [];
    else next[kind] = [...value];
  }
  return Object.keys(next).length === 1 ? next.source : next;
}

/** Attach each configured package's per-resource switches to the list the UI shows (S17). */
export function withPackageFilters<T extends { source: string }>(packages: T[], configured: PackageSource[]): T[] {
  return packages.map((entry) => {
    const filters = packageFilterState(configured.find((item) => packageSourceOf(item) === entry.source));
    return filters ? { ...entry, filters } : entry;
  });
}

/** Persist per-resource switches through Pi's settings, then rebuild live sessions (S17). */
export async function setPackageFilters(
  engine: EngineContext,
  source: string,
  enabled: ExtensionPackageFilters,
  cwd: string,
): Promise<void> {
  const sdk = engine.settings.pi.manager(engine.trusted(cwd));
  const packages = sdk.getPackages();
  const index = packages.findIndex((item) => packageSourceOf(item) === source);
  if (index < 0) throw Error("not_found: package");
  packages[index] = applyPackageFilters(packages[index], enabled);
  sdk.setPackages(packages);
  await sdk.flush();
  engine.extensionsDirty = true;
  await engine.reload();
}

/** Load `paths` in an isolated loader and report each one's registrations or error. */
export async function inspectExtensions(
  engine: EngineContext,
  paths: readonly string[],
  cwd: string,
): Promise<ExtensionReport[]> {
  if (!paths.length) return [];
  // The same `ob_*` reservation the live loader applies, so a preview shows the same failure the
  // session would record (and "add" can refuse it).
  const result = reserveBuiltinToolNames(await discoverAndLoadExtensions([...paths], cwd, engine.settings.dir));
  const errors = new Map((result.errors ?? []).map((entry) => [entry.path, entry.error]));
  return paths.map((path) => {
    const ext = result.extensions.find((entry) => entry.path === path || entry.resolvedPath === path);
    // A path that produced neither an extension nor an error simply has no extension at it.
    const error = errors.get(path) ?? (ext ? null : "extension_not_found");
    return {
      path,
      resolvedPath: ext?.resolvedPath ?? null,
      ok: !!ext && !error,
      tools: ext ? [...ext.tools.keys()].sort() : [],
      commands: ext ? [...ext.commands.keys()].sort() : [],
      shortcuts: ext ? [...ext.shortcuts.keys()].sort() : [],
      error,
    };
  });
}
