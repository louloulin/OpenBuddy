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

export function within(root: string, candidate: string): string {
  const base = resolve(root);
  const target = resolve(candidate);
  const rel = relative(base, target);
  if (rel === "" || (rel !== ".." && !rel.startsWith(`..${String.fromCharCode(47)}`) && !isAbsolute(rel))) return target;
  throw new Error(`path is outside allowed root: ${target}`);
}

export async function withinReal(root: string, candidate: string): Promise<string> {
  const realRoot = await realpath(resolve(root));
  const realCandidate = await realpath(resolve(candidate));
  return within(realRoot, realCandidate);
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

