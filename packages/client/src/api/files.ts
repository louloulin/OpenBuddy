// §5.3 `files` module: open_url, open_path, list_dir, plus the ob-preview:// URL helper. (read_text_file, write_text_file,
// read_file_base64, path_stat, reveal_in_folder and browse_directory have no wrapper yet; callers still use ipc.invoke directly.)
import type { FileSearchResult } from "@openbuddy/protocol/files-search";
import { invoke } from "../ipc";

/** Open a URL in the system browser (scheme-whitelisted backend command). */
export async function openUrl(url: string): Promise<void> {
  await invoke<void>("open_url", { url });
}

/** Open a local file with the system default app (the host checks the path is granted). */
export async function openPath(path: string): Promise<void> {
  await invoke<void>("open_path", { path });
}

// ---------- filesystem: directory listing (file-tree sidebar) ----------

/** A single directory entry returned by `list_dir`. */
export interface DirEntry {
  /** File/dir basename. */
  name: string;
  /** Absolute path of the entry. */
  path: string;
  /** "directory" | "file" | "other". */
  kind: string;
  /** File size in bytes (directories report 0). */
  size: number;
}

/**
 * List the immediate children of a directory (non-recursive).
 * Hidden entries and noisy build/VCS directories (.git/node_modules/…) are
 * skipped server-side. Capped at `maxEntries` (default 2000).
 */
export async function listDir(
  path: string,
  cwd?: string,
  maxEntries?: number,
): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_dir", {
    path,
    cwd: cwd ?? null,
    maxEntries: maxEntries ?? null,
  });
}

/** `@` mention (20261116-pii W1.3): fuzzy-ranked files of a task's workspace (gitignore-aware, ≤200). */
export const filesSearch = (cwd: string, query: string, limit?: number) =>
  invoke<FileSearchResult>("files_search", { cwd, query, ...(limit ? { limit } : {}) });

/** Isolated-origin URL for previewing a workspace file in a sandboxed iframe. */
export function previewUrl(absPath: string): string {
  const segments = absPath.split(/[\\/]/).filter(Boolean).map(encodeURIComponent);
  return `ob-preview://local/${segments.join("/")}`;
}

// ---------- plain file reads (B3d) ----------

export interface PathStat {
  exists?: boolean;
  size?: number;
  mtimeMs?: number;
  isDirectory?: boolean;
}

/** Stat one path without reading it (artifact reader's live deletion probe). */
export const pathStat = (path: string) => invoke<PathStat>("path_stat", { path });
/** 默认打开方式 (G1-6)：按文件类型记住「应用内预览 / 系统应用」。 */
export type DefaultOpenMap = Record<string, "embedded" | "system">;
export const defaultOpenGet = () => invoke<DefaultOpenMap>("default_open_get");
export const defaultOpenSet = (map: DefaultOpenMap) => invoke<DefaultOpenMap>("default_open_set", { defaultOpen: map });

/** 应用平台 (20261126-upup): UpUp 插件开关。 */
export interface UpupPluginsState {
  disabled: string[];
  enabled: string[];
  settingsPath: string;
  defaults: string[];
  settingsExists: boolean;
}
export const upupPluginsGet = () => invoke<UpupPluginsState>("upup_plugins_get");
export const upupPluginsSet = (next: { disabled?: string[]; enabled?: string[] }) =>
  invoke<UpupPluginsState>("upup_plugins_set", next);

/** 应用列表 (UP-2.2)：Pi 包读 `pi.app`；没有 manifest 的记为普通扩展包。 */
export interface AppEntry {
  id: string;
  name: string;
  version?: string;
  kind: "app" | "connector" | "skill-pack" | "extension";
  /** `builtin` = OpenBuddy 内置通用应用（不可启停）。 */
  source: "pi" | "pack" | "builtin";
  installedPath?: string;
  packageSource?: string;
  tagline?: string;
  category?: string;
  icon?: string;
  toolPolicy?: { readonly?: string[]; deny?: string[] };
  scenes?: string;
  sceneList?: Array<{ id: string; name: string; group?: string; prompt: string }>;
}
export const appsList = (cwd?: string) =>
  invoke<AppEntry[]>("apps_list", cwd ? { cwd } : {});

/** 内置应用源 (2026-11-27)：安装包内随附的 UpUp 目录（`resources/upup`）。 */
export interface BundledAppSource {
  /** 可安装的目录；不存在时为 null。 */
  source: string | null;
  exists: boolean;
  /** 该目录是否已经在 Pi 包记录里。 */
  installed: boolean;
  name?: string;
  version?: string;
}
export const appsBundledSource = () => invoke<BundledAppSource>("apps_bundled_source");
/** 一键安装随附应用（装进 agentDir 的包记录并打开资源）。 */
export const appsInstallBundled = () =>
  invoke<{ source: string; packages: unknown[] }>("apps_install_bundled");
/** 升级一个应用（走 Pi 包管理器；本地路径通常无更新）。 */
export const appsUpdate = (packageSource: string) =>
  invoke<{ packageSource: string; packages: unknown[] }>("apps_update", { packageSource });
/** 卸载一个应用，并清掉 UpUp 子包开关。 */
export const appsUninstall = (packageSource: string) =>
  invoke<{ packageSource: string; packages: unknown[] }>("apps_uninstall", { packageSource });

/** 应用图标（data URI；缺失或过大时 dataUri 为 null）。 */
export const appsIcon = (packageSource: string, icon: string) =>
  invoke<{ dataUri: string | null }>("apps_icon", { packageSource, icon });

/** 整体启停一个应用（Pi 包的全部资源）。 */
export const appsSetEnabled = (packageSource: string, enabled: boolean) =>
  invoke<{ packageSource: string; enabled: boolean }>("apps_set_enabled", { packageSource, enabled });

/** 工具策略 (UP-3.2)：平台红线 + 用户/应用声明的 deny / readonly。 */
export interface ToolPolicy {
  platformDenied: string[];
  denied: string[];
  readonly: string[];
}
export const appsToolPolicyGet = () => invoke<ToolPolicy>("apps_tool_policy_get");
export const appsToolPolicySet = (next: { denied?: string[]; readonly?: string[] }) =>
  invoke<ToolPolicy>("apps_tool_policy_set", next);

/** Git worktree (G4-5): isolated checkouts for code tasks. */
export interface WorktreeRow { path: string; head?: string; branch?: string; bare: boolean; main: boolean }
export const worktreeList = (cwd: string) =>
  invoke<{ gitRepo: boolean; root?: string; worktrees: WorktreeRow[] }>("worktree_list", { cwd });
export const worktreeCreate = (cwd: string, name: string) =>
  invoke<{ gitRepo: boolean; root: string; path: string; branch: string }>("worktree_create", { cwd, name });
export const worktreeRemove = (cwd: string, path: string) =>
  invoke<{ removed: string }>("worktree_remove", { cwd, path });

/** G3-7: rename inside the task workspace; the host refuses to overwrite. */
export const renamePath = (workspaceRoot: string, from: string, to: string) =>
  invoke<string>("rename_path", { workspaceRoot, from, to });

/** Reveal one path in the OS file manager (desktop native). */
export const revealInFolder = (path: string) => invoke<void>("reveal_in_folder", { path });

/** Read a text file with a byte cap; the host enforces the cap and the workspace grant. */
export const readFileBase64 = (path: string, maxBytes?: number) =>
  invoke<string>("read_file_base64", { path, ...(maxBytes ? { maxBytes } : {}) });
export const readTextFile = (path: string, maxBytes?: number) =>
  invoke<string>("read_text_file", { path, ...(maxBytes ? { maxBytes } : {}) });
