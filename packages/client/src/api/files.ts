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
