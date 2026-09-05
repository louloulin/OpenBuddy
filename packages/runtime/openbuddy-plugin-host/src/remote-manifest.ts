import { resolveExportTarget, RUNTIME_EXPORT_CONDITIONS } from "./export-target";

export interface RemoteManifestEntry {
  packageName: string;
  packageJson: string;
  moduleName: string;
  moduleUrl?: string;
}

export interface DiscoverRemoteManifestOptions {
  additionalPackages?: readonly string[];
  resolvePackageJson?: (specifier: string) => string | Promise<string>;
  readPackageJson?: (path: string) => Promise<Record<string, unknown>>;
  resolveModule?: (specifier: string, packageJson: string) => string | Promise<string>;
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
    throw new Error(`remote-manifest: cannot locate package.json for ${specifier}`);
  }
}

async function defaultReadPackageJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8")) as Record<string, unknown>;
}

function remoteExport(_packageName: string, pkg: Record<string, unknown>): string | undefined {
  const exportsField = pkg.exports;
  if (!exportsField || typeof exportsField !== "object" || Array.isArray(exportsField)) return undefined;
  return resolveExportTarget(
    (exportsField as Record<string, unknown>)["./remote"],
    RUNTIME_EXPORT_CONDITIONS.node,
  );
}

/** Discover generated DeepSeek Harness `exports["./remote"]` artifacts. */
export async function discoverRemoteManifestEntries(
  options: DiscoverRemoteManifestOptions = {},
): Promise<RemoteManifestEntry[]> {
  const resolvePackageJson = options.resolvePackageJson ?? defaultResolvePackageJson;
  const readPackageJson = options.readPackageJson ?? defaultReadPackageJson;
  const resolveModule = options.resolveModule;
  const result: RemoteManifestEntry[] = [];
  const seen = new Set<string>();
  for (const packageName of options.additionalPackages ?? []) {
    if (!packageName || seen.has(packageName)) continue;
    seen.add(packageName);
    let packageJson: string;
    try { packageJson = await resolvePackageJson(packageName); } catch { continue; }
    const manifest = await readPackageJson(packageJson);
    if (!remoteExport(packageName, manifest)) continue;
    const moduleName = `${packageName}/remote`;
    const moduleUrl = resolveModule ? await resolveModule(moduleName, packageJson) : undefined;
    result.push({ packageName, packageJson, moduleName, ...(moduleUrl ? { moduleUrl } : {}) });
  }
  return result;
}
