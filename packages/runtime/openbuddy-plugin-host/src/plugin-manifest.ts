import { hasRuntimePackageExport, RUNTIME_EXPORT_CONDITIONS } from "./export-target";

export const unifiedPluginManifestSchema = "openbuddy.plugin.v1" as const;
export const unifiedPluginSurfaceKinds = ["bundle", "pi", "renderer", "remote", "typert", "cordis"] as const;
export type UnifiedPluginSurfaceKind = (typeof unifiedPluginSurfaceKinds)[number];
export type UnifiedPluginManifestNamespace = "openbuddy" | "dsh" | "pi";

export interface UnifiedPluginManifestSurface {
  kind: UnifiedPluginSurfaceKind;
  namespace: UnifiedPluginManifestNamespace;
  resources?: string[];
}

export interface UnifiedPluginManifestInput {
  name: string;
  path: string;
  version?: string;
  manifest: Record<string, unknown>;
  listed?: boolean;
  health?: "healthy" | "degraded";
  loaded?: readonly UnifiedPluginSurfaceKind[];
  /** Native Pi packages may omit `pi` metadata and use convention folders. */
  piConvention?: boolean;
}

export interface UnifiedPluginManifest {
  schema: typeof unifiedPluginManifestSchema;
  name: string;
  path: string;
  version?: string;
  namespaces: UnifiedPluginManifestNamespace[];
  surfaces: UnifiedPluginManifestSurface[];
  listed: boolean;
  health: "healthy" | "degraded";
  loaded: UnifiedPluginSurfaceKind[];
  missing: UnifiedPluginSurfaceKind[];
}

const resourceKeys = ["extensions", "skills", "prompts", "themes"] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function namespaceValue(manifest: Record<string, unknown>, namespace: UnifiedPluginManifestNamespace): Record<string, unknown> | undefined {
  return record(manifest[namespace]);
}

function hasObjectField(manifest: Record<string, unknown>, namespace: UnifiedPluginManifestNamespace, field: string): boolean {
  return Boolean(record(namespaceValue(manifest, namespace)?.[field]));
}

function clientNamespace(manifest: Record<string, unknown>): UnifiedPluginManifestNamespace | undefined {
  if (hasObjectField(manifest, "openbuddy", "client")) return "openbuddy";
  if (hasObjectField(manifest, "dsh", "client")) return "dsh";
  return undefined;
}

function bundleNamespace(manifest: Record<string, unknown>): UnifiedPluginManifestNamespace | undefined {
  if (hasObjectField(manifest, "openbuddy", "bundle")) return "openbuddy";
  if (hasObjectField(manifest, "dsh", "bundle")) return "dsh";
  return undefined;
}

function piResources(manifest: Record<string, unknown>): string[] {
  const declaration = record(manifest.pi);
  if (!declaration) return [];
  return resourceKeys.flatMap((key) => {
    const values = declaration[key];
    return Array.isArray(values) && values.every((value) => typeof value === "string")
      ? values as string[]
      : [];
  });
}

function hasPiDeclaration(manifest: Record<string, unknown>): boolean {
  const declaration = record(manifest.pi);
  return Boolean(declaration) && resourceKeys.some((key) => Array.isArray(declaration?.[key])
    && (declaration?.[key] as unknown[]).every((value) => typeof value === "string"));
}

function manifestWithState(
  manifest: UnifiedPluginManifest,
  loaded: readonly UnifiedPluginSurfaceKind[],
  health: UnifiedPluginManifest["health"] = manifest.health,
): UnifiedPluginManifest {
  const normalizedLoaded = unifiedPluginSurfaceKinds.filter((kind) => loaded.includes(kind));
  return {
    ...manifest,
    health,
    loaded: normalizedLoaded,
    missing: [...new Set(manifest.surfaces.map((surface) => surface.kind).filter((kind) => !normalizedLoaded.includes(kind)))],
  };
}

function hasExport(manifest: Record<string, unknown>, subpath: string): boolean {
  return hasRuntimePackageExport(manifest.exports, subpath, RUNTIME_EXPORT_CONDITIONS.generic);
}

function hasCordisPluginSurface(name: string, manifest: Record<string, unknown>): boolean {
  const isKnownCordisPackage = name.startsWith("@deepseek-ai/dsh-") || name.startsWith("@cordisjs/cordis-plugin-");
  if (!isKnownCordisPackage) return false;
  const peerDependencies = record(manifest.peerDependencies);
  const dependencies = record(manifest.dependencies);
  return Boolean(peerDependencies?.["@deepseek-ai/cordis"] || peerDependencies?.["@cordisjs/core"]
    || dependencies?.["@deepseek-ai/cordis"] || dependencies?.["@cordisjs/core"]);
}

/** Normalize OpenBuddy, DeepSeek Harness, and native Pi package metadata. */
export function createUnifiedPluginManifest(input: UnifiedPluginManifestInput): UnifiedPluginManifest {
  const surfaces: UnifiedPluginManifestSurface[] = [];
  const bundle = bundleNamespace(input.manifest);
  if (bundle) surfaces.push({ kind: "bundle", namespace: bundle });

  const client = clientNamespace(input.manifest);
  if (client) surfaces.push({ kind: "renderer", namespace: client });

  if (hasPiDeclaration(input.manifest) || input.piConvention === true) {
    surfaces.push({ kind: "pi", namespace: "pi", resources: piResources(input.manifest) });
  }

  if (hasExport(input.manifest, "./remote")) surfaces.push({ kind: "remote", namespace: "dsh" });
  if (hasExport(input.manifest, "./typert")) surfaces.push({ kind: "typert", namespace: "dsh" });
  if (hasCordisPluginSurface(input.name, input.manifest)) surfaces.push({ kind: "cordis", namespace: "dsh" });

  const namespaces = [...new Set(surfaces.map((surface) => surface.namespace))]
    .filter((namespace): namespace is UnifiedPluginManifestNamespace => namespace === "openbuddy" || namespace === "dsh" || namespace === "pi");
  const loaded = unifiedPluginSurfaceKinds.filter((kind) => input.loaded?.includes(kind));
  const missing = surfaces.map((surface) => surface.kind).filter((kind) => !loaded.includes(kind));
  return manifestWithState({
    schema: unifiedPluginManifestSchema,
    name: input.name,
    path: input.path,
    ...(input.version ? { version: input.version } : {}),
    namespaces,
    surfaces,
    listed: input.listed === true,
    health: input.health ?? "healthy",
    loaded,
    missing: [...new Set(missing)],
  }, loaded, input.health ?? "healthy");
}

/** Apply runtime state to a previously normalized package manifest. */
export function updateUnifiedPluginManifest(
  manifest: UnifiedPluginManifest,
  state: { loaded?: readonly UnifiedPluginSurfaceKind[]; health?: UnifiedPluginManifest["health"]; listed?: boolean } = {},
): UnifiedPluginManifest {
  return {
    ...manifestWithState(manifest, state.loaded ?? manifest.loaded, state.health ?? manifest.health),
    ...(state.listed === undefined ? {} : { listed: state.listed }),
  };
}
