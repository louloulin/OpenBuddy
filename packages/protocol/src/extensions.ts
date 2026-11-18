/**
 * Pi 扩展包 (20261116-pii W2.6 P2 / S14): npm / git packages installed through Pi's
 * `DefaultPackageManager`. Sources look like `npm:@scope/pkg`, `git:https://…` or
 * `owner/repo`; local paths keep using 添加扩展文件/目录.
 */
export interface ExtensionPackage {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
  installedPath?: string;
  /**
   * Per-resource switches written through Pi's object-form package entry (S17).
   * Only resource types that are explicitly on/off appear; `false` means "do not load".
   */
  filters?: ExtensionPackageFilters;
}

export type ExtensionResourceKind = "extensions" | "skills" | "prompts" | "themes";
export type ExtensionPackageFilters = Partial<Record<ExtensionResourceKind, boolean>>;
export const EXTENSION_RESOURCE_KINDS: readonly ExtensionResourceKind[] = ["extensions", "skills", "prompts", "themes"];

export interface ExtensionPackageProgress {
  source: string;
  type: "start" | "progress" | "complete" | "error" | "result";
  action: "install" | "remove" | "update" | "clone" | "pull";
  message?: string;
}

/** 安装前预览 (W2.6 P2): what a package would register, resolved in a temporary folder. */
export interface ExtensionPackagePreview {
  source: string;
  extensions: Array<{ path: string; tools: string[]; commands: string[]; shortcuts: string[]; error: string | null }>;
  skills: string[];
  prompts: string[];
  failures: Array<{ source: string; message: string }>;
}

/** `checkForAvailableUpdates()` result for the 扩展中心. */
export interface ExtensionPackageUpdate {
  source: string;
  displayName: string;
  type: "npm" | "git";
  scope: "user" | "project";
}

/**
 * Pi 包市场搜索 (S15): a package found in the npm registry by the `pi-package` keyword.
 * Data comes from the public registry search endpoint — real names, versions and download
 * counts, never a bundled marketing list.
 */
export interface ExtensionRegistryPackage {
  name: string;
  version: string;
  description: string;
  publisher?: string;
  license?: string;
  updated?: string;
  /** npm's own weekly / monthly download counts (absent when the registry omits them). */
  weeklyDownloads?: number;
  monthlyDownloads?: number;
  keywords: string[];
  homepage?: string;
  repository?: string;
  npmUrl?: string;
}

export interface ExtensionRegistrySearch {
  query: string;
  source: "npm";
  total: number;
  /** Offset of the first row in this page (S16 pagination). */
  from: number;
  packages: ExtensionRegistryPackage[];
  fetchedAt: number;
}

/** One resource a configured package contributes (S15), as Pi resolved it. */
export interface ExtensionPackageResource {
  /** Configured package source, e.g. `npm:pi-web-access`. */
  source: string;
  scope: "user" | "project" | "temporary";
  path: string;
  enabled: boolean;
  changelogPath?: string;
}

/** Everything configured packages resolve to: extensions, skills, prompts, themes (S15). */
export interface ExtensionResources {
  extensions: ExtensionPackageResource[];
  skills: ExtensionPackageResource[];
  prompts: ExtensionPackageResource[];
  themes: ExtensionPackageResource[];
  failures: Array<{ source: string; message: string }>;
}

/** Validate the per-resource switch payload: known keys, boolean values only (S17). */
export function validPackageFilters(value: unknown): value is ExtensionPackageFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([key, on]) => (EXTENSION_RESOURCE_KINDS as readonly string[]).includes(key) && typeof on === "boolean",
  );
}

/** Search text for the registry: bounded, no control characters (empty = browse). */
export function validRegistryQuery(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length > 120) return false;
  return !/[\0\r\n]/.test(value);
}

/** Validate a package source before it reaches Pi. Local paths are intentionally rejected. */
export function validExtensionSource(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const source = value.trim();
  if (!source || source.length > 2048 || /[\0\r\n]/.test(source)) return false;
  if (/^(npm|git|github|ssh):.+/i.test(source)) return true;
  if (/^(https:\/\/|git@)/i.test(source)) return true;
  // owner/repo shorthand (no scheme, no spaces, exactly one slash)
  return /^[\w.-]+\/[\w.-]+$/.test(source);
}
