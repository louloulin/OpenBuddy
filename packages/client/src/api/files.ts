// §5.3 `files` module: open_url, list_dir, plus the ob-preview:// URL helper. (read_text_file, write_text_file, read_file_base64,
// path_stat, open_path, reveal_in_folder and browse_directory have no wrapper yet; callers still use ipc.invoke directly.)
import type { FileSearchResult } from "@openbuddy/protocol/files-search";
import { invoke } from "../ipc";

/** Open a URL in the system browser (scheme-whitelisted backend command). */
export async function openUrl(url: string): Promise<void> {
  await invoke<void>("open_url", { url });
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
