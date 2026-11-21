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
/**
 * npm's own search score (E1). `quality` / `popularity` / `maintenance` are 0–1 fractions;
 * `final` is npm's unnormalised combined number (it can exceed 1), kept verbatim for sorting.
 */
export interface ExtensionRegistryScore {
  final: number;
  quality: number;
  popularity: number;
  maintenance: number;
}

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
  /** npm search score (final + quality/popularity/maintenance), absent when npm omits it. */
  score?: ExtensionRegistryScore;
  keywords: string[];
  homepage?: string;
  repository?: string;
  npmUrl?: string;
  /** 能力分类（E1）：由 npm 真实 keywords 派生，供市场按能力筛选。 */
  categories?: ExtensionCategory[];
}

/**
 * 能力分类 (E1)：固定的九个分类，**由包自己的 npm keywords 派生**，不是人工维护的清单。
 * 一个包可以同时属于多个分类。
 */
export const EXTENSION_CATEGORIES = [
  "web",
  "search",
  "memory",
  "mcp",
  "docs",
  "dev",
  "media",
  "automation",
  "other",
] as const;
export type ExtensionCategory = (typeof EXTENSION_CATEGORIES)[number];

/** 中文标签，供界面直接显示。 */
export const EXTENSION_CATEGORY_LABELS: Record<ExtensionCategory, string> = {
  web: "网页访问",
  search: "搜索检索",
  memory: "记忆知识",
  mcp: "MCP 连接器",
  docs: "文档办公",
  dev: "开发工具",
  media: "图像多媒体",
  automation: "自动化",
  other: "其它",
};

/**
 * 包详情 (E1)：来自 npm packument 的完整性 / 维护者 / 发布时间 / git commit。
 * 只暴露审查需要的字段，不回传整个包文档。
 */
export interface ExtensionPackageDetails {
  name: string;
  version: string;
  /** npm 的 `dist.integrity`（SRI），安装时用来校验 tarball。 */
  integrity?: string;
  /** npm 的 `dist.shasum`（旧版 sha1）。 */
  shasum?: string;
  /** 包的维护者（npm 用户名）。 */
  maintainers: string[];
  /** 该版本的发布时间（ISO）。 */
  publishedAt?: string;
  /** 包声明的仓库地址。 */
  repository?: string;
  /** git 包的 commit（npm packument 的 `gitHead`）。 */
  gitHead?: string;
  license?: string;
  /** 解包后大小（字节）。 */
  unpackedSize?: number;
  /** 派生的能力分类。 */
  categories: ExtensionCategory[];
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

/** npm package names: lowercase, digits, `-`, `_`, `.`, optional `@scope/`. */
const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/** A package name the host may look up in the registry (E1: packument details). */
export function validPackageName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 214 && PACKAGE_NAME_RE.test(value);
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
