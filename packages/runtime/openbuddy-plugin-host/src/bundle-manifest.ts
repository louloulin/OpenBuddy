/**
 * Bundle manifest loader — mirrors the deepseek-harness convention of
 * declaring bundles via `package.json#openbuddy.bundle` (analogue of
 * `dsh.bundle`). The recognised shape is:
 *
 *   "openbuddy": {
 *     "bundle": {
 *       "patch": "./openbuddy.patch.yml"   // points to a cordis.patch.yml-style file
 *     }
 *   }
 *
 * `readBundleManifest(specifier, importer)` resolves the specifier (so its
 * `package.json` is locatable), reads the manifest field, and resolves the
 * patch path relative to the bundle's directory. The result is a normalised
 * `PluginBundle` ready for `composePluginBundles`.
 *
 * The default `importer` uses `import.meta.resolve` via `createRequire`, but
 * a custom importer can be supplied for tests or non-default runtimes.
 */
// Node-only helpers are loaded lazily inside each function so the
// renderer (which doesn't need bundle-manifest) can pull in plugin-host
// without dragging Node-only modules into the browser bundle.
import type { PluginBundle, PluginEntryOptions, PluginPatch } from "./index";

export interface BundleManifestField {
  patch?: string;
  /** Optional direct entries (alternative to `patch`). */
  entries?: PluginEntryOptions[];
  /** Optional direct patches (alternative to `patch`). */
  patches?: PluginPatch[][];
  /** Optional scope object for `!!js` evaluation in the patch file. */
  scope?: Record<string, unknown>;
}

export interface BundleManifest {
  specifier: string;
  /** Absolute directory of the bundle's package.json. */
  dir: string;
  field: BundleManifestField;
  /**
   * Which manifest field the bundle declared — `openbuddy` for
   * OpenBuddy-native bundles, `dsh` for deepseek-harness-conventional
   * bundles. Useful for callers that want to apply namespace-specific
   * merge rules.
   */
  manifestField?: "openbuddy" | "dsh";
}

export interface ReadBundleManifestOptions {
  /** Override the importer; defaults to Node's CJS require. */
  importer?: (specifier: string) => string | Promise<string>;
  /** Override patch-file IO for virtual filesystems and tests. */
  patchLoader?: (path: string) => Promise<string>;
  /** Runtime helpers / context exposed to `!!js` expressions. */
  scope?: Record<string, unknown>;
}

/**
 * Recognised manifest field names. We read the OpenBuddy-native
 * `openbuddy.bundle` first; the deepseek-harness-conventional
 * `dsh.bundle` is a fallback so deepseek bundles can be installed as-is
 * (no manifest rewrite required).
 */
const MANIFEST_FIELDS = ["openbuddy", "dsh"] as const;

/**
 * Resolve `specifier` to a directory containing a `package.json` and return
 * its `openbuddy.bundle` field. Throws when the field is absent.
 */
export async function readBundleManifest(
  specifier: string,
  options: ReadBundleManifestOptions = {},
): Promise<BundleManifest> {
  const importer = options.importer ?? (await defaultImporter());
  const resolved = await importer(specifier);
  const pkgPath = await findPackageJson(resolved);
  if (!pkgPath) {
    throw new Error(`bundle-manifest: cannot locate package.json from ${specifier} (resolved to ${resolved})`);
  }
  const { readFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const pkgRaw = await readFile(pkgPath, "utf-8");
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`bundle-manifest: failed to parse ${pkgPath}: ${String(error)}`);
  }
  let chosenField: string | null = null;
  let bundle: BundleManifestField | undefined;
  for (const name of MANIFEST_FIELDS) {
    const value = pkg[name] as { bundle?: BundleManifestField } | undefined;
    if (value && typeof value === "object" && value.bundle) {
      chosenField = name;
      bundle = value.bundle;
      break;
    }
  }
  if (!bundle) {
    throw new Error(`bundle-manifest: ${pkgPath} does not declare any of ${MANIFEST_FIELDS.map((n) => `"${n}.bundle"`).join(", ")}`);
  }
  return {
    specifier,
    dir: dirname(pkgPath),
    field: bundle,
    manifestField: (chosenField as "openbuddy" | "dsh") ?? "openbuddy",
  };
}

/**
 * Materialise a `PluginBundle` from a manifest. When `field.patch` is set,
 * the patch file is read and parsed as a deepseek-style patch; otherwise the
 * inline `entries` / `patches` are returned directly.
 */
export async function manifestToBundle(
  manifest: BundleManifest,
  options: ReadBundleManifestOptions & { patchLoader?: (path: string) => Promise<string> } = {},
): Promise<PluginBundle> {
  const { field, dir } = manifest;
  if (field.patch) {
    const { isAbsolute, resolve } = await import("node:path");
    const patchPath = isAbsolute(field.patch) ? field.patch : resolve(dir, field.patch);
    const source = await (options.patchLoader ?? (await defaultPatchLoader()))(patchPath);
    const { parseCordisPatch, patchRowsToOpenBuddy } = await import("./yaml-patch");
    const parsed = parseCordisPatch(source);
    const layers = parsed.layers.map((layer) => patchRowsToOpenBuddy(layer.rows, {
      ...(field.scope ?? {}),
      ...(options.scope ?? {}),
    })) as PluginPatch[][];
    return { entries: [], patches: layers };
  }
  return {
    entries: field.entries ?? [],
    patches: field.patches ?? [],
  };
}

async function defaultImporter(): Promise<(specifier: string) => string> {
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  return (specifier: string) => req.resolve(specifier);
}

async function defaultPatchLoader(): Promise<(path: string) => Promise<string>> {
  const { readFile } = await import("node:fs/promises");
  return async (path: string) => readFile(path, "utf-8");
}

/**
 * Locate the nearest `package.json` starting from `path`. The input may
 * be a directory or a file — when it's a file, we test it directly before
 * walking up its directory tree. Returns null when no package.json is
 * found within 16 directory levels (handles monorepo layouts).
 */
async function findPackageJson(path: string): Promise<string | null> {
  const { readFile } = await import("node:fs/promises");
  const { basename, dirname: dir } = await import("node:path");
  // If the input is itself a package.json, return it.
  if (basename(path) === "package.json") {
    try {
      await readFile(path, "utf-8");
      return path;
    } catch {
      return null;
    }
  }
  let current = path;
  for (let i = 0; i < 16; i++) {
    const candidate = `${current}/package.json`;
    try {
      await readFile(candidate, "utf-8");
      return candidate;
    } catch {
      // not found at this level
    }
    const parent = dir(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}
