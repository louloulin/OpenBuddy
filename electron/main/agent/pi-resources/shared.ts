/**
 * P2-13: shared helpers used by multiple pi-resources sub-modules.
 *
 * Original: top of `electron/main/agent/pi-resources.ts` (now a thin re-export
 * facade). Extracted so each domain sub-module can depend on just what it
 * needs — e.g. `skills.ts` doesn't drag in the SessionManager native binding
 * from `memory.ts`.
 *
 * Path resolution delegates to `@openbuddy/storage` — a package import, so this
 * module keeps its "no relative source deps" property while sharing the one
 * canonical agent-home resolver.
 */
import { realpathSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, dirname, join, relative, resolve } from "node:path";
import { McpAuthStore, McpRegistry, agentHome, createPlatformSecretStore } from "@openbuddy/storage";

export { agentHome };

export function piRoot(): string {
  // The same root must serve both Pi session files (legacy) and MCP config
  // (new) so any agent-home override applies uniformly.
  return agentHome();
}

export function agentRoot(): string {
  return piRoot();
}

const mcpRegistryPromises = new Map<string, Promise<McpRegistry>>();
const mcpAuthStorePromises = new Map<string, Promise<McpAuthStore>>();

export function mcpRegistry(): Promise<McpRegistry> {
  const path = join(agentRoot(), "openbuddy.sqlite");
  const existing = mcpRegistryPromises.get(path);
  if (existing) return existing;
  const created = Promise.resolve(new McpRegistry(path));
  mcpRegistryPromises.set(path, created);
  return created;
}

export function mcpAuthStore(): Promise<McpAuthStore> {
  const databasePath = join(agentRoot(), "openbuddy.sqlite");
  const existing = mcpAuthStorePromises.get(databasePath);
  if (existing) return existing;
  const secretStore = createPlatformSecretStore({ service: "OpenBuddy MCP" });
  const created = Promise.resolve(new McpAuthStore({
    databasePath,
    secretStore,
    legacyPath: join(agentRoot(), "mcp-auth.json"),
  }));
  mcpAuthStorePromises.set(databasePath, created);
  return created;
}

export async function closeMcpRegistries(): Promise<void> {
  const entries = [...mcpRegistryPromises.values()];
  mcpRegistryPromises.clear();
  for (const entry of entries) await entry.then((registry) => registry.close()).catch(() => undefined);
  const authEntries = [...mcpAuthStorePromises.values()];
  mcpAuthStorePromises.clear();
  for (const entry of authEntries) await entry.then((store) => store.close()).catch(() => undefined);
}

export function workspaceRoot(cwd?: string | null): string {
  return resolve(cwd || process.cwd());
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return fallback; }
}

export async function writeJson(file: string, value: unknown, mode?: number): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
  await rename(temporary, file);
}

/**
 * Canonicalise a path without requiring it to exist.
 *
 * `fs.realpath` throws ENOENT on a missing leaf, but callers of `within()`
 * routinely validate install targets that have not been created yet. So we
 * walk up to the nearest existing ancestor, realpath that, and re-append the
 * still-unresolved tail.
 *
 * This matters on macOS, where `/var` is a symlink to `/private/var`: a root
 * the OS handed us (`/private/var/...`) and a candidate we built with `join`
 * (`/var/...`) would otherwise compare as unrelated and every check would
 * fail.
 */
function canonicalizeSync(input: string): string {
  const absolute = resolve(input);
  let current = absolute;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return tail.length ? join(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) return absolute;
      tail.push(current.slice(parent.length + 1));
      current = parent;
    }
  }
}

async function canonicalize(input: string): Promise<string> {
  const absolute = resolve(input);
  let current = absolute;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return tail.length ? join(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) return absolute;
      tail.push(current.slice(parent.length + 1));
      current = parent;
    }
  }
}

/**
 * Canonicalise everything *except* the final path segment.
 *
 * The leaf deliberately stays unresolved so a symlink sitting at the target
 * itself is reported lexically-inside and can be rejected explicitly by the
 * caller (`lstat(...).isSymbolicLink()`), rather than being silently followed
 * out of the root. Intermediate segments are fully resolved, so a symlinked
 * parent directory that escapes the root is still caught here.
 */
function canonicalizeParentSync(input: string): string {
  const absolute = resolve(input);
  const parent = dirname(absolute);
  if (parent === absolute) return absolute;
  return join(canonicalizeSync(parent), absolute.slice(parent.length + 1));
}

async function canonicalizeParent(input: string): Promise<string> {
  const absolute = resolve(input);
  const parent = dirname(absolute);
  if (parent === absolute) return absolute;
  return join(await canonicalize(parent), absolute.slice(parent.length + 1));
}

/** Lexical containment check on already-canonicalised paths. */
function isWithin(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${String.fromCharCode(47)}`) && !isAbsolute(rel));
}

/**
 * Resolve `candidate` and assert it stays inside `root`.
 *
 * The root is fully canonicalised and the candidate is canonicalised down to
 * its parent, so a mixed set of resolved / unresolved paths (the common case:
 * an OS-provided root plus a path we built with `join`) still compares
 * correctly on platforms where the tmpdir itself is behind a symlink.
 */
export function within(root: string, candidate: string): string {
  const base = canonicalizeSync(root);
  const target = canonicalizeParentSync(candidate);
  if (isWithin(base, target)) return target;
  throw new Error(`path is outside allowed root: ${target}`);
}

/**
 * Async variant, with the same semantics as `within()`. Kept because several
 * call sites already sit in async functions and prefer not to block.
 */
export async function withinReal(root: string, candidate: string): Promise<string> {
  const base = await canonicalize(root);
  const target = await canonicalizeParent(candidate);
  if (isWithin(base, target)) return target;
  throw new Error(`path is outside allowed root: ${target}`);
}

export async function assertResourcePath(candidate: string, allowedRoots: string[]): Promise<string> {
  if (!allowedRoots.length) throw new Error("no allowed resource roots");
  let lastError: unknown;
  for (const root of allowedRoots) {
    try { return await withinReal(root, candidate); } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("resource path is outside allowed roots");
}

export function safeName(value: string): string {
  const name = value.trim();
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) throw new Error("invalid resource name");
  return name;
}

export async function filesIn(root: string, suffix: string): Promise<string[]> {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => join(root, entry.name));
  } catch { return []; }
}

export async function writeTextAtomic(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, file);
}

