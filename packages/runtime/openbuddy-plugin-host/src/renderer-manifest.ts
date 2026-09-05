import type { PluginEntryOptions } from "./index";
import { resolveExportTarget, RUNTIME_EXPORT_CONDITIONS } from "./export-target";

export interface RendererPluginManifestEntry {
  id: string;
  /** Original package identity used by dsh.client.external graph edges. */
  moduleId?: string;
  /** Stable host-side key used for controlled module resolution. */
  moduleKey?: string;
  name: string;
  inject?: string[];
  external?: string[];
  immediately?: boolean;
  config?: unknown;
  disabled?: boolean;
  /** Resolved browser-loadable module URL when the host can provide one. */
  moduleUrl?: string;
}

export interface RendererPluginBootEntry {
  id: string;
  url: string;
  /** Stable bundle revision consumed by DeepSeek-style boot manifest parsers. */
  rev: string;
  inject?: string[];
  external?: string[];
  immediately?: boolean;
}

export interface RendererPluginBootGraph {
  rev: string;
  entries: RendererPluginBootEntry[];
}

export interface DiscoverRendererPluginOptions {
  platform?: string;
  /** Additional package names discovered from a profile's installed tree. */
  additionalPackages?: readonly string[];
  resolvePackageJson?: (specifier: string) => string | Promise<string>;
  readPackageJson?: (path: string) => Promise<Record<string, unknown>>;
  resolveModule?: (specifier: string, packageJson: string) => string | Promise<string>;
}

type ClientDeclaration = {
  platform: string;
  inject?: unknown;
  external?: unknown;
  immediately?: unknown;
  module?: unknown;
};

function stringArray(packageName: string, field: string, value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`renderer-manifest: ${packageName} ${field} must be an array of strings`);
  }
  return [...value] as string[];
}

async function defaultResolvePackageJson(specifier: string): Promise<string> {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  try {
    return require.resolve(`${specifier}/package.json`);
  } catch {
    const { dirname, join } = await import("node:path");
    const resolved = require.resolve(specifier);
    let directory = dirname(resolved);
    for (let index = 0; index < 8; index += 1) {
      const candidate = join(directory, "package.json");
      try {
        await (await import("node:fs/promises")).access(candidate);
        return candidate;
      } catch {
        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
    }
    throw new Error(`renderer-manifest: cannot locate package.json for ${specifier}`);
  }
}

async function defaultReadPackageJson(path: string): Promise<Record<string, unknown>> {
  const raw = await (await import("node:fs/promises")).readFile(path, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function clientDeclaration(packageName: string, pkg: Record<string, unknown>): ClientDeclaration | undefined {
  for (const key of ["dsh", "openbuddy"]) {
    const root = pkg[key];
    if (!root || typeof root !== "object") continue;
    const client = (root as Record<string, unknown>).client;
    if (client === undefined) continue;
    if (!client || typeof client !== "object") {
      throw new Error(`renderer-manifest: ${packageName} ${key}.client must be an object`);
    }
    const declaration = client as Record<string, unknown>;
    if (typeof declaration.platform !== "string") {
      throw new Error(`renderer-manifest: ${packageName} ${key}.client.platform must be a string`);
    }
    stringArray(packageName, `${key}.client.inject`, declaration.inject);
    stringArray(packageName, `${key}.client.external`, declaration.external);
    if (declaration.immediately !== undefined && typeof declaration.immediately !== "boolean") {
      throw new Error(`renderer-manifest: ${packageName} ${key}.client.immediately must be a boolean`);
    }
    if (declaration.module !== undefined && typeof declaration.module !== "string") {
      throw new Error(`renderer-manifest: ${packageName} ${key}.client.module must be a string`);
    }
    return declaration as ClientDeclaration;
  }
  return undefined;
}

function hasClientExport(packageName: string, pkg: Record<string, unknown>): boolean {
  const exportsField = pkg.exports;
  if (exportsField === undefined) {
    throw new Error(`renderer-manifest: ${packageName} declares dsh.client but exports no "./client" entry`);
  }
  const target = resolveExportTarget(
    typeof exportsField === "object" && !Array.isArray(exportsField)
      ? (exportsField as Record<string, unknown>)["./client"]
      : undefined,
    RUNTIME_EXPORT_CONDITIONS.browser,
  );
  if (target === undefined) {
    throw new Error(`renderer-manifest: ${packageName} declares dsh.client but exports no "./client" entry`);
  }
  return true;
}

/** Discover the browser face declared by DeepSeek-style `dsh.client` metadata. */
export async function discoverRendererPluginEntries(
  entries: readonly PluginEntryOptions[],
  options: DiscoverRendererPluginOptions = {},
): Promise<RendererPluginManifestEntry[]> {
  const platform = options.platform ?? "web";
  const resolvePackageJson = options.resolvePackageJson ?? defaultResolvePackageJson;
  const readPackageJson = options.readPackageJson ?? defaultReadPackageJson;
  const resolveModule = options.resolveModule;
  const flattened: PluginEntryOptions[] = [];
  const flatten = (items: readonly PluginEntryOptions[], prefix = ""): void => {
    for (const entry of items) {
      const id = prefix ? `${prefix}:${entry.id}` : entry.id;
      flattened.push({ ...entry, id });
      if (entry.children?.length) flatten(entry.children, id);
    }
  };
  flatten(entries);
  const knownNames = new Set(flattened.map((entry) => entry.name));
  for (const name of options.additionalPackages ?? []) {
    if (!name || knownNames.has(name)) continue;
    knownNames.add(name);
    flattened.push({ id: name, name });
  }
  const idsByName = new Map(flattened.map((entry) => [entry.name, entry.id]));
  const discovered: RendererPluginManifestEntry[] = [];

  for (const entry of flattened) {
    let declaration: ClientDeclaration | undefined;
    let packageJson: Record<string, unknown> | undefined;
    let packageJsonPath: string | undefined;
    try {
      packageJsonPath = await resolvePackageJson(entry.name);
    } catch {
      continue;
    }
    try {
      packageJson = await readPackageJson(packageJsonPath);
    } catch {
      continue;
    }
    declaration = clientDeclaration(entry.name, packageJson);
    if (!declaration || declaration.platform !== platform) continue;
    hasClientExport(entry.name, packageJson);
    const inject = stringArray(entry.name, "dsh.client.inject", declaration.inject)?.map((dependency) => idsByName.get(dependency) ?? dependency);
    const external = stringArray(entry.name, "dsh.client.external", declaration.external);
    const moduleName = typeof declaration.module === "string"
      ? declaration.module
      : `${entry.name}/client`;
    let moduleUrl: string | undefined;
    if (resolveModule) {
      try { moduleUrl = await resolveModule(moduleName, packageJsonPath!); }
      catch { /* browser may still resolve the package name in development */ }
    }
    discovered.push({
      id: entry.id,
      ...(resolveModule ? { moduleId: entry.name } : {}),
      ...(resolveModule ? { moduleKey: entry.id } : {}),
      name: moduleName,
      ...(moduleUrl ? { moduleUrl } : {}),
      ...(inject === undefined ? {} : { inject }),
      ...(external === undefined ? {} : { external }),
      ...(typeof declaration.immediately === "boolean" ? { immediately: declaration.immediately } : {}),
      ...(entry.config === undefined ? {} : { config: entry.config }),
      ...(entry.disabled === undefined ? {} : { disabled: entry.disabled }),
    });
  }
  return discovered;
}

function bootRevision(entries: readonly RendererPluginBootEntry[]): string {
  const source = JSON.stringify(entries);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `openbuddy-client-${(hash >>> 0).toString(16)}`;
}

function moduleRevision(url: string): string {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

/** Compose a DeepSeek-style browser boot graph from discovered renderer faces. */
export function composeRendererPluginBootGraph(
  entries: readonly RendererPluginManifestEntry[],
): RendererPluginBootGraph {
  const byIdentity = new Map<string, RendererPluginManifestEntry>();
  for (const entry of entries) {
    for (const identity of [entry.id, entry.moduleId, entry.name, entry.moduleKey]) {
      if (identity) byIdentity.set(identity.replace(/\/client$/, ""), entry);
    }
  }
  const ordered: RendererPluginBootEntry[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (entry: RendererPluginManifestEntry): void => {
    if (visited.has(entry.id)) return;
    if (visiting.has(entry.id)) throw new Error(`renderer-manifest: client external cycle at ${entry.id}`);
    if (!entry.moduleUrl) throw new Error(`renderer-manifest: client module URL missing for ${entry.id}`);
    visiting.add(entry.id);
    for (const dependency of entry.external ?? []) {
      const dependencyEntry = byIdentity.get(dependency.replace(/\/client$/, ""));
      if (dependencyEntry) visit(dependencyEntry);
    }
    visiting.delete(entry.id);
    visited.add(entry.id);
    ordered.push({
      id: entry.id,
      url: entry.moduleUrl,
      rev: moduleRevision(entry.moduleUrl),
      ...(entry.inject ? { inject: [...entry.inject] } : {}),
      ...(entry.external?.length ? { external: [...entry.external] } : {}),
      ...(entry.immediately ? { immediately: true } : {}),
    });
  };
  for (const entry of entries) visit(entry);
  return { rev: bootRevision(ordered), entries: ordered };
}
