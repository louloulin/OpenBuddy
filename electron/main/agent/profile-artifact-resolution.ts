import { readdir, readFile, realpath, stat } from "node:fs/promises";import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveProfileModuleFallback } from "./profile-module-resolution";
import { packageExportValue, resolveExportTarget, RUNTIME_EXPORT_CONDITIONS } from "@openbuddy/plugin-host";

export interface ProfileArtifactResolverOptions {
  packageJsonByName: ReadonlyMap<string, string>;
  profilePackageJson?: string;
  hostModule?: string;
}

export interface ProfileArtifactResolvers {
  resolvePackageJson: (specifier: string) => Promise<string>;
  resolveModule: (specifier: string, packageJson: string) => Promise<string>;
}

/**
 * Collect package manifests from a profile graph, including nested
 * dependencies materialized by the profile package manager. DSH bundle
 * patches can reference packages that are not direct profile dependencies;
 * those packages still publish generated `./remote` and `./typert` faces.
 */
export async function discoverProfilePackageJsons(
  roots: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const visited = new Set<string>();
  const children = async (directory: string): Promise<string[]> => {
    const nodeModules = join(directory, "node_modules");
    let entries;
    try { entries = await readdir(nodeModules, { withFileTypes: true }); } catch { return []; }
    const paths: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(nodeModules, entry.name);
      if (entry.name.startsWith("@")) {
        let scoped;
        try { scoped = await readdir(path, { withFileTypes: true }); } catch { continue; }
        for (const child of scoped) {
          if (!child.name.startsWith(".")) paths.push(join(path, child.name));
        }
      } else {
        paths.push(path);
      }
    }
    return paths;
  };
  const readManifest = async (directory: string): Promise<{ path: string; name: string } | undefined> => {
    const packageJson = join(directory, "package.json");
    try {
      const manifest = JSON.parse(await readFile(packageJson, "utf8")) as { name?: unknown };
      return typeof manifest.name === "string" ? { path: packageJson, name: manifest.name } : undefined;
    } catch {
      return undefined;
    }
  };
  const canonical = async (directory: string): Promise<string | undefined> => {
    try { return await realpath(directory); } catch { return undefined; }
  };
  const queue: string[] = [];
  for (const root of roots) {
    const manifest = await readManifest(root);
    if (manifest && !result.has(manifest.name)) result.set(manifest.name, manifest.path);
    queue.push(root);
  }
  while (queue.length > 0) {
    const directory = queue.shift()!;
    const identity = await canonical(directory);
    if (!identity || visited.has(identity)) continue;
    visited.add(identity);
    for (const child of await children(directory)) {
      const manifest = await readManifest(child);
      if (manifest && !result.has(manifest.name)) result.set(manifest.name, manifest.path);
      queue.push(child);
    }
  }
  return result;
}

function uniqueAnchors(anchors: readonly (string | undefined)[]): string[] {
  return [...new Set(anchors.filter((anchor): anchor is string => Boolean(anchor)))];
}

function packageNameOfSpecifier(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

async function packageRootFromResolved(resolved: string): Promise<string | undefined> {
  let directory = dirname(resolved);
  for (let index = 0; index < 32; index += 1) {
    const candidate = join(directory, "package.json");
    if ((await stat(candidate, { throwIfNoEntry: false }))?.isFile()) return candidate;    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

async function nodeModulesPackageJson(specifier: string, anchor: string): Promise<string | undefined> {
  let directory = dirname(anchor);
  for (let index = 0; index < 32; index += 1) {
    const candidates = [
      join(directory, "node_modules", specifier, "package.json"),
      join(directory, "node_modules", ".pnpm", "node_modules", specifier, "package.json"),
    ];
    for (const candidate of candidates) {
      if ((await stat(candidate, { throwIfNoEntry: false }))?.isFile()) return candidate;    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

function packageSubpath(specifier: string, packageName: string): string | undefined {
  if (specifier === packageName) return undefined;
  if (!specifier.startsWith(`${packageName}/`)) return undefined;
  return `./${specifier.slice(packageName.length + 1)}`;
}

async function resolveManifestExport(specifier: string, packageJson: string): Promise<string | undefined> {
  let manifest: { name?: unknown; exports?: unknown };
  try {
    manifest = JSON.parse(await readFile(packageJson, "utf8")) as { name?: unknown; exports?: unknown };  } catch {
    return undefined;
  }
  if (typeof manifest.name !== "string") return undefined;
  const subpath = packageSubpath(specifier, manifest.name);
  const exportsField = manifest.exports;
  const target = resolveExportTarget(
    packageExportValue(exportsField, subpath),
    RUNTIME_EXPORT_CONDITIONS.generic,
  );
  if (!target || !target.startsWith(".")) return undefined;
  const candidate = resolve(dirname(packageJson), target);
  const packageRoot = dirname(packageJson);
  const withinPackage = relative(packageRoot, candidate);
  if (withinPackage === ".." || withinPackage.startsWith(`..${sep}`) || isAbsolute(withinPackage)) return undefined;
  const candidates = [candidate, `${candidate}.js`, `${candidate}.mjs`, `${candidate}.cjs`, `${candidate}.ts`, join(candidate, "index.js"), join(candidate, "index.mjs"), join(candidate, "index.cjs")];
  for (const item of candidates) {
    if ((await stat(item, { throwIfNoEntry: false }))?.isFile()) return item;  }
  return undefined;
}

export function createProfileArtifactResolvers(options: ProfileArtifactResolverOptions): ProfileArtifactResolvers {
  const hostModule = options.hostModule ?? fileURLToPath(import.meta.url);
  const packageJsonFor = (specifier: string): string | undefined => options.packageJsonByName.get(specifier);
  const resolvePackageJson = async (specifier: string): Promise<string> => {
    const packageName = packageNameOfSpecifier(specifier);
    const direct = packageJsonFor(specifier) ?? packageJsonFor(packageName);
    if (direct) return direct;
    const anchors = uniqueAnchors([
      ...options.packageJsonByName.values(),
      options.profilePackageJson,
      hostModule,
    ]);
    let lastError: unknown;
    for (const anchor of anchors) {
      const installed = await nodeModulesPackageJson(packageName, anchor);
      if (installed) return installed;
      const resolver = createRequire(anchor);
      try {
        return resolver.resolve(`${packageName}/package.json`);
      } catch (error) {
        lastError = error;
        try {
          const resolved = resolver.resolve(specifier);
          const packageJson = await packageRootFromResolved(resolved);
          if (packageJson) return packageJson;
        } catch (nestedError) {
          lastError = nestedError;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Cannot resolve package.json for ${specifier}`);
  };
  const resolveModule = async (specifier: string, packageJson: string): Promise<string> => {
    const packageName = packageNameOfSpecifier(specifier);
    const anchors = uniqueAnchors([
      packageJson,
      packageJsonFor(packageName),
      options.profilePackageJson,
      hostModule,
    ]);
    let lastError: unknown;
    for (const anchor of anchors) {
      try { return createRequire(anchor).resolve(specifier); }
      catch (error) { lastError = error; }
    }
    const exported = await resolveManifestExport(specifier, packageJson);
    if (exported) return exported;
    const fallback = await resolveProfileModuleFallback(specifier, packageJson);
    if (fallback) return fallback;
    throw lastError instanceof Error ? lastError : new Error(`Cannot resolve module ${specifier}`);
  };
  return { resolvePackageJson, resolveModule };
}

export function toModuleUrl(path: string): string {
  return pathToFileURL(path).href;
}
