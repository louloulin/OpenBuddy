// §5.3 `extensions` module: agent_extensions_list / inspect / add / remove / set_enabled.
// 扩展中心 (pii W2.6): `list` also reports what each path registers and where it failed to load.
import type {
  ExtensionPackage,
  ExtensionPackageDetails,
  ExtensionPackageFilters,
  ExtensionPackagePreview,
  ExtensionPackageProgress,
  ExtensionPackageUpdate,
  ExtensionRegistrySearch,
  ExtensionResources,
} from "@openbuddy/protocol/extensions";
import { invoke, listen, type UnlistenFn } from "../ipc";

/** One configured extension path: what it registers, or why it failed (isolated load). */
export interface ExtensionReport {
  path: string;
  resolvedPath: string | null;
  ok: boolean;
  tools: string[];
  commands: string[];
  shortcuts: string[];
  error: string | null;
}

export interface ExtensionsConfig {
  enabled: boolean;
  paths: string[];
  /** Paths configured but switched off in 扩展中心 (W2.6). */
  disabled?: string[];
  projectTrusted: boolean;
  /** Per-path previews (W2.6). */
  items?: Array<ExtensionReport & { enabled?: boolean }>;
  /** Paths that failed to load in the last opened session. */
  errors?: Array<{ path: string; error: string }>;
}
export const agentExtensionsList = (cwd?: string) => invoke<ExtensionsConfig>("agent_extensions_list", { cwd: cwd ?? null });
/** Preview what one path would register, before it is added (isolated loader). */
export const agentExtensionsInspect = (path: string, cwd?: string) =>
  invoke<ExtensionReport>("agent_extensions_inspect", { path, cwd: cwd ?? null });
export const agentExtensionsAdd = (path: string) => invoke<ExtensionsConfig>("agent_extensions_add", { path });
export const agentExtensionsRemove = (path: string) => invoke<ExtensionsConfig>("agent_extensions_remove", { path });
export const agentExtensionsSetEnabled = (enabled: boolean) => invoke<ExtensionsConfig>("agent_extensions_set_enabled", { enabled });
/** Per-extension switch (W2.6): a disabled path stays configured but is not loaded. */
export const agentExtensionsSetPathEnabled = (path: string, enabled: boolean) =>
  invoke<ExtensionsConfig>("agent_extensions_set_path_enabled", { path, enabled });

// ---------- 扩展包 (W2.6 P2 / S14) ----------

/** npm / git packages configured through Pi's DefaultPackageManager. */
export const agentExtensionsPackages = (cwd?: string) =>
  invoke<ExtensionPackage[]>("agent_extensions_packages", { cwd: cwd ?? null });
export const agentExtensionsInstallPackage = (source: string, cwd?: string) =>
  invoke<ExtensionPackage[]>("agent_extensions_install_package", { source, cwd: cwd ?? null });
export const agentExtensionsRemovePackage = (source: string, cwd?: string) =>
  invoke<ExtensionPackage[]>("agent_extensions_remove_package", { source, cwd: cwd ?? null });
export const agentExtensionsUpdatePackages = (source?: string, cwd?: string) =>
  invoke<ExtensionPackage[]>("agent_extensions_update_packages", { ...(source ? { source } : {}), cwd: cwd ?? null });

/** Resolve + inspect a package in a temporary folder, without persisting it (W2.6 P2). */
export const agentExtensionsPreviewPackage = (source: string, cwd?: string) =>
  invoke<ExtensionPackagePreview>("agent_extensions_preview_package", { source, cwd: cwd ?? null });

/** npm / git packages with a newer version available. */
export const agentExtensionsCheckUpdates = (cwd?: string) =>
  invoke<ExtensionPackageUpdate[]>("agent_extensions_check_updates", { cwd: cwd ?? null });

// ---------- Pi 包市场与包资源 (S15) ----------

/** Search the real npm registry for packages tagged `pi-package`; empty query browses. */
export const agentExtensionsSearchRegistry = (query = "", offset = 0, cwd?: string) =>
  invoke<ExtensionRegistrySearch>("agent_extensions_search_registry", { query, ...(offset ? { offset } : {}), cwd: cwd ?? null });

/** One package's integrity / maintainers / publish time / git commit (E1). */
export const agentExtensionsPackageDetails = (name: string) =>
  invoke<ExtensionPackageDetails>("agent_extensions_package_details", { name });

/** Extensions / skills / prompts / themes that configured packages contribute (Pi-resolved). */
export const agentExtensionsResources = (cwd?: string) =>
  invoke<ExtensionResources>("agent_extensions_resources", { cwd: cwd ?? null });

/** Per-package resource switches (S17): `false` writes Pi's object-form `[]` filter. */
export const agentExtensionsSetPackageResources = (
  source: string,
  resources: ExtensionPackageFilters,
  cwd?: string,
) => invoke<ExtensionPackage[]>("agent_extensions_set_package_resources", { source, resources, cwd: cwd ?? null });

/** Install / update progress (`agent://extension-progress`). */
export function onExtensionProgress(cb: (event: ExtensionPackageProgress) => void): Promise<UnlistenFn> {
  return listen<ExtensionPackageProgress>("agent://extension-progress", (event) => cb(event.payload));
}
