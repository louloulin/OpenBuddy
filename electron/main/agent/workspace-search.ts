/**
 * R1 - openbuddy-workspace-search.
 *
 * Lightweight file and symbol search for the @-mention picker in the
 * Composer. Reuses whatever indexer is available locally (rg / fd / git
 * ls-files) and falls back to a bounded directory walk when nothing is
 * installed. The result is a ranked list of { kind, path, preview }
 * entries that the renderer's MentionPicker renders inline.
 *
 * This is intentionally not a full ripgrep wrapper: the picker only needs
 * the top ~30 matches per query, so we cap the work early and stream
 * results as they arrive.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";

const execFileAsync = promisify(execFile);

export interface WorkspaceSearchHit {
  /** "file" | "symbol" | "folder" */
  kind: "file" | "symbol" | "folder";
  /** Path relative to the workspace root (forward-slash normalized). */
  path: string;
  /** Absolute path (for opening the file in a preview). */
  absPath: string;
  /** One-line preview for the picker row. */
  preview: string;
  /** Match score (higher = better). */
  score: number;
}

export interface WorkspaceSearchOptions {
  /** Workspace root to search within. */
  cwd: string;
  /** Maximum results to return. Default 30. */
  limit?: number;
  /** Hard timeout in milliseconds. Default 1500. */
  timeoutMs?: number;
  /** Optional filter: only return these kinds. */
  kinds?: ReadonlyArray<WorkspaceSearchHit["kind"]>;
}

/** Cheap structural check: avoid scanning huge generated trees. */
const DEFAULT_IGNORED = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  ".moon",
  ".worktrees",
  "__snapshots__",
]);

function isBinaryPath(path: string): boolean {
  const lower = path.toLowerCase();
  return /\.(png|jpe?g|gif|webp|ico|pdf|zip|tar|gz|wasm|map|bin|so|dll|dylib|class|jar|exe|mp[34]|mov|avi|mkv|woff2?|ttf|otf|eot)$/i.test(lower);
}

/** Try `rg` first (fastest), then `git ls-files + grep`, then a directory
 *  walk. Returns hits sorted by score, capped to limit. */
export async function workspaceSearch(
  query: string,
  opts: WorkspaceSearchOptions,
): Promise<{ hits: WorkspaceSearchHit[]; duration_ms: number; source: "rg" | "grep" | "walk" | "none" }> {
  const start = performance.now();
  const limit = Math.max(1, Math.min(opts.limit ?? 30, 100));
  const timeoutMs = Math.max(100, Math.min(opts.timeoutMs ?? 1500, 10_000));
  const cwd = resolve(opts.cwd);
  if (!existsSync(cwd)) {
    return { hits: [], duration_ms: performance.now() - start, source: "none" };
  }
  const q = query.trim();

  // Empty query: return recent files (top-level + 1-deep walk)
  if (q.length === 0) {
    return await listTopLevel(cwd, limit, start);
  }

  // Try rg first
  try {
    const { stdout } = await execFileAsync(
      "rg",
      ["--files", "--hidden", "-g", "!node_modules", "-g", "!.git", cwd],
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
    );
    const allFiles = stdout.split("\n").filter(Boolean);
    const hits = scoreAndFilter(allFiles, q, cwd, limit, opts.kinds);
    return { hits, duration_ms: performance.now() - start, source: "rg" };
  } catch {
    // rg not installed or failed; fall through
  }

  // Try git ls-files
  try {
    const { stdout } = await execFileAsync("git", ["ls-files"], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    const files = stdout.split("\n").filter(Boolean);
    const hits = scoreAndFilter(files, q, cwd, limit, opts.kinds);
    return { hits, duration_ms: performance.now() - start, source: "grep" };
  } catch {
    // not a git repo
  }

  // Fallback: bounded walk
  const hits = await walkAndFilter(cwd, q, limit, timeoutMs, opts.kinds);
  return { hits, duration_ms: performance.now() - start, source: "walk" };
}

function scoreAndFilter(
  paths: readonly string[],
  q: string,
  cwd: string,
  limit: number,
  kinds?: ReadonlyArray<WorkspaceSearchHit["kind"]>,
): WorkspaceSearchHit[] {
  const lower = q.toLowerCase();
  const hits: WorkspaceSearchHit[] = [];
  for (const abs of paths) {
    const normalized = abs.replace(/\\/g, "/");
    const rel = relative(cwd, normalized).replace(/\\/g, "/");
    if (rel.startsWith("..")) continue;
    if (DEFAULT_IGNORED.has(rel.split("/")[0] ?? "")) continue;
    const fileName = rel.split("/").pop() ?? rel;
    const score = scoreMatch(fileName, rel, lower);
    if (score <= 0) continue;
    const kind: WorkspaceSearchHit["kind"] = abs.endsWith(sep) || rel.endsWith(sep) ? "folder" : isBinaryPath(rel) ? "file" : "file";
    if (kinds && !kinds.includes(kind)) continue;
    hits.push({
      kind,
      path: rel,
      absPath: normalized,
      preview: rel,
      score,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return hits.slice(0, limit);
}

function scoreMatch(fileName: string, rel: string, lower: string): number {
  const fileNameLower = fileName.toLowerCase();
  const relLower = rel.toLowerCase();
  if (fileNameLower === lower) return 1000;
  if (fileNameLower.startsWith(lower)) return 500 + (lower.length / fileNameLower.length) * 100;
  if (fileNameLower.includes(lower)) return 200 + (lower.length / fileNameLower.length) * 50;
  if (relLower.includes(lower)) return 50 + (lower.length / relLower.length) * 20;
  // Subsequence match (e.g. "abc" matches "a_b_c")
  if (isSubsequence(lower, fileNameLower)) return 10;
  return 0;
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) {
    if (hay[j] === needle[i]) i++;
  }
  return i === needle.length;
}

async function listTopLevel(
  cwd: string,
  limit: number,
  start: number,
): Promise<{ hits: WorkspaceSearchHit[]; duration_ms: number; source: "walk" }> {
  const hits: WorkspaceSearchHit[] = [];
  try {
    const entries = (await readdir(cwd, { withFileTypes: true })) as unknown as ReadonlyArray<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    for (const entry of entries) {
      if (DEFAULT_IGNORED.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      const abs = join(cwd, entry.name);
      hits.push({
        kind: entry.isDirectory() ? "folder" : "file",
        path: entry.name,
        absPath: abs,
        preview: entry.name,
        score: 100,
      });
      if (hits.length >= limit) break;
    }
  } catch {
    // best-effort
  }
  return { hits, duration_ms: performance.now() - start, source: "walk" };
}

async function walkAndFilter(
  cwd: string,
  q: string,
  limit: number,
  timeoutMs: number,
  kinds?: ReadonlyArray<WorkspaceSearchHit["kind"]>,
): Promise<WorkspaceSearchHit[]> {
  const out: WorkspaceSearchHit[] = [];
  const deadline = Date.now() + timeoutMs;
  const lower = q.toLowerCase();
  const stack: string[] = [cwd];
  while (stack.length > 0 && out.length < limit && Date.now() < deadline) {
    const dir = stack.pop()!;
    let entries: ReadonlyArray<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      const raw = await readdir(dir, { withFileTypes: true });
      entries = raw as unknown as ReadonlyArray<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (out.length >= limit) break;
      if (DEFAULT_IGNORED.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      const rel = relative(cwd, abs).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        stack.push(abs);
        if (rel.toLowerCase().includes(lower) && (!kinds || kinds.includes("folder"))) {
          out.push({ kind: "folder", path: rel, absPath: abs, preview: rel, score: 50 });
        }
      } else if (entry.isFile()) {
        if (rel.toLowerCase().includes(lower) && (!kinds || kinds.includes("file"))) {
          out.push({ kind: "file", path: rel, absPath: abs, preview: rel, score: 25 });
        }
      }
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
