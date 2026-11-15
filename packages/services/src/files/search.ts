import type { Dirent } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { FILES_SEARCH_MAX_RESULTS, type FileSearchHit, type FileSearchResult } from "@openbuddy/protocol/files-search";

/**
 * Workspace file search for `@` mentions (20261116-pii W1.3). Same ignore rules as Pi's `find`
 * tool: `.gitignore` / `.ignore` files (also above the workspace, up to the repository root),
 * hidden files included, `node_modules` and `.git` never. Pi runs `fd` for that (downloaded on
 * demand); the main process must not download tools on a keystroke, so the walk is done here.
 * The walk never leaves `root`: symlinked folders are not followed, symlinked files only count
 * when they resolve inside `root`.
 */

interface IgnoreRule {
  negate: boolean;
  dirOnly: boolean;
  regex: RegExp;
  /** Folder of the ignore file relative to the search root ("" = the root or above it). */
  base: string;
  /** Path from the ignore file's folder down to the search root (rules found above the root). */
  prefix: string;
}

const ALWAYS_SKIPPED = new Set([".git", "node_modules"]);
const IGNORE_FILES = [".gitignore", ".ignore"];

function globToRegex(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        out += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (c === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end < 0) out += "\\[";
      else {
        const body = glob.slice(i + 1, end).replace(/\\/g, "\\\\");
        out += `[${body.startsWith("!") ? "^" + body.slice(1) : body}]`;
        i = end;
      }
    } else if (c === "\\" && i + 1 < glob.length) out += glob[++i].replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    else out += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  return out;
}

/** Rules of one ignore file (gitignore syntax). */
export function parseIgnore(text: string, base = "", prefix = ""): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/(?<!\\)\s+$/, "");
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    if (line.startsWith("\\")) line = line.slice(1);
    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.slice(0, -1);
    if (!line) continue;
    // A slash anywhere but the end anchors the pattern to the ignore file's folder.
    const anchored = line.includes("/");
    if (line.startsWith("/")) line = line.slice(1);
    const body = globToRegex(line);
    rules.push({ negate, dirOnly, base, prefix, regex: new RegExp(anchored ? `^${body}$` : `(?:^|/)${body}$`) });
  }
  return rules;
}

/** Whether `rel` (relative to the search root, `/`-separated) is ignored; the last matching rule wins. */
export function isIgnored(rules: readonly IgnoreRule[], rel: string, isDir: boolean): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    let local = rel;
    if (rule.base) {
      if (!rel.startsWith(rule.base + "/")) continue;
      local = rel.slice(rule.base.length + 1);
    }
    if (rule.prefix) local = `${rule.prefix}/${local}`;
    if (rule.regex.test(local)) ignored = !rule.negate;
  }
  return ignored;
}

async function readRules(dir: string, base: string, prefix = ""): Promise<IgnoreRule[]> {
  const rules: IgnoreRule[] = [];
  for (const name of IGNORE_FILES) {
    try { rules.push(...parseIgnore(await readFile(join(dir, name), "utf8"), base, prefix)); } catch { /* none */ }
  }
  return rules;
}

/** Ignore files between the repository root (the nearest folder above with `.git`) and `root`. */
async function parentRules(root: string): Promise<IgnoreRule[]> {
  const exists = (path: string) => stat(path).then(() => true, () => false);
  if (await exists(join(root, ".git"))) return [];
  // Only a workspace inside a repository inherits ignore files from above it.
  const chain: string[] = [];
  for (let dir = dirname(root), depth = 0; ; depth++) {
    chain.unshift(dir);
    if (await exists(join(dir, ".git"))) break;
    const parent = dirname(dir);
    if (parent === dir || depth >= 32) return [];
    dir = parent;
  }
  const rules: IgnoreRule[] = [];
  for (const dir of chain) rules.push(...(await readRules(dir, "", relative(dir, root).split(sep).join("/"))));
  return rules;
}

interface Listing { files: FileSearchHit[]; partial: boolean; at: number }
const cache = new Map<string, Listing>();
const CACHE_MS = 10_000;

/** Every non-ignored file under `root` (bounded by `maxFiles` and `budgetMs`). */
export async function listWorkspaceFiles(root: string, opts: { maxFiles?: number; budgetMs?: number } = {}): Promise<Listing> {
  const cached = cache.get(root);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached;
  const maxFiles = opts.maxFiles ?? 20_000;
  const deadline = Date.now() + (opts.budgetMs ?? 1500);
  const files: FileSearchHit[] = [];
  let partial = false;
  const queue: Array<{ dir: string; rel: string; rules: IgnoreRule[] }> = [{ dir: root, rel: "", rules: [...(await parentRules(root)), ...(await readRules(root, ""))] }];
  walk: while (queue.length) {
    const { dir, rel, rules } = queue.shift()!;
    let entries: Dirent[];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= maxFiles || Date.now() > deadline) { partial = true; break walk; }
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ALWAYS_SKIPPED.has(entry.name) || isIgnored(rules, path, true)) continue;
        queue.push({ dir: full, rel: path, rules: [...rules, ...(await readRules(full, path))] });
        continue;
      }
      if (entry.isSymbolicLink()) {
        // Folders behind links are not followed; a linked file must stay inside the workspace.
        const target = await realpath(full).catch(() => "");
        if (!target.startsWith(root + sep) || !(await stat(target).then((s) => s.isFile(), () => false))) continue;
      } else if (!entry.isFile()) continue;
      if (isIgnored(rules, path, false)) continue;
      const info = await stat(full).catch(() => undefined);
      if (!info) continue;
      files.push({ path, name: entry.name, size: info.size, mtimeMs: info.mtimeMs });
    }
  }
  const listing = { files, partial, at: Date.now() };
  cache.set(root, listing);
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
  return listing;
}

/** Fuzzy score of `query` against a workspace path; null when it does not match. Higher is better. */
export function fuzzyScore(query: string, path: string): number | null {
  const q = query.toLowerCase();
  const p = path.toLowerCase();
  const name = p.slice(p.lastIndexOf("/") + 1);
  const depth = p.split("/").length - 1;
  const penalty = depth * 2 + p.length * 0.05;
  if (!q) return -penalty;
  if (name === q) return 1000 - penalty;
  if (name.startsWith(q)) return 800 - (name.length - q.length) - penalty;
  const inName = name.indexOf(q);
  if (inName >= 0) return 600 - inName - penalty;
  const inPath = p.indexOf(q);
  if (inPath >= 0) return 400 - inPath * 0.5 - penalty;
  const subsequence = (target: string) => {
    let score = 0, at = -1, run = 0;
    for (const c of q) {
      const next = target.indexOf(c, at + 1);
      if (next < 0) return null;
      run = next === at + 1 ? run + 1 : 0;
      // Contiguous letters and letters right after a separator count more.
      score += 1 + run * 2 + (next === 0 || "/._- ".includes(target[next - 1]) ? 3 : 0);
      at = next;
    }
    return score;
  };
  const inNameSeq = subsequence(name);
  if (inNameSeq !== null) return 200 + inNameSeq - penalty;
  const inPathSeq = subsequence(p);
  return inPathSeq !== null ? 100 + inPathSeq - penalty : null;
}

/** `files_search`: fuzzy-ranked files of `cwd` (an absolute, already authorized workspace). */
export async function searchFiles(cwd: string, query: string, limit = FILES_SEARCH_MAX_RESULTS): Promise<FileSearchResult> {
  const root = await realpath(cwd);
  if (!(await stat(root)).isDirectory()) throw Error("invalid_payload: cwd is not a folder");
  const { files, partial } = await listWorkspaceFiles(root);
  const max = Math.max(1, Math.min(limit, FILES_SEARCH_MAX_RESULTS));
  const q = query.trim().replace(/\\/g, "/");
  // Nothing typed yet: the most recently changed files first.
  const hits = q
    ? files.flatMap((file) => { const score = fuzzyScore(q, file.path); return score === null ? [] : [{ file, score }]; })
      .sort((a, b) => b.score - a.score || a.file.path.length - b.file.path.length || a.file.path.localeCompare(b.file.path))
      .map((x) => x.file)
    : [...files].sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { cwd: root, hits: hits.slice(0, max), partial };
}

/** Forget cached listings (tests; a workspace that just changed a lot). */
export function clearFileSearchCache() {
  cache.clear();
}
