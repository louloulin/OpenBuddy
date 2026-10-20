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
import { HostCoreSecretStoreBridge } from "../agent-secret-store-bridge";

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
  // P2.1-secrets — host-core IPC 优先,失败静默降级到 platform store。
  // host 句柄由 electron/main/index.ts 在 bootHostCore() 之后通过
  // attachHostCoreSecretStore() 注入;此处只在模块加载时读取一次当前状态。
  const fallbackSecretStore = createPlatformSecretStore({ service: "OpenBuddy MCP" });
  const secretStore = new HostCoreSecretStoreBridge(fallbackSecretStore);
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

/** 最近一次已下发给 host-core 的 workspace 根,用于去重。 */
let lastSyncedWorkspaceRoot: string | null = null;

export function workspaceRoot(cwd?: string | null): string {
  const root = resolve(cwd || process.cwd());
  void syncWorkspaceRootToHostCore(root);
  return root;
}

/**
 * 让 host-core 侧知道当前 workspace 根,它的 workspace/secrets 判定都以它为基准。
 *
 * workspaceRoot() 是同步函数(被 skills / agents / mcp / memory / marketplace 的
 * 资源解析共用),因此这里 fire-and-forget:同 root 不重复下发,host-core 不可用
 * 时静默跳过。失败不影响任何调用方 —— 本地路径解析不依赖 host-core。
 */
async function syncWorkspaceRootToHostCore(root: string): Promise<void> {
  if (lastSyncedWorkspaceRoot === root) return;
  lastSyncedWorkspaceRoot = root;
  try {
    const { workspaceSetRootViaBridge } = await import("../agent-workspace-bridge");
    await workspaceSetRootViaBridge(root);
  } catch {
    // 同步失败无需重试:下次 root 变化时会再试。
  }
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
  void shadowCheckWorkspace(candidate);
  let lastError: unknown;
  for (const root of allowedRoots) {
    try { return await withinReal(root, candidate); } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("resource path is outside allowed roots");
}

/**
 * 影子模式:让 host-core 也判定一次同一条路径,只对比不拦截。
 *
 * host-core 的 `workspace.check` 返回的是自己的 CheckResult 语义(含 ignored /
 * exists),与本地 `withinReal` 的 realpath 边界检查不等价,因此这里刻意**不**
 * 用它的结论做任何放行/拒绝 —— 真正的判定仍在上面的 withinReal。目的是让
 * host-core 侧的能力在真实流量下被验证,确认两边一致后再讨论是否切换。
 *
 * 由 OPENBUDDY_WORKSPACE_SHADOW=1 开启;host-core 不可用时静默跳过。
 */
async function shadowCheckWorkspace(candidate: string): Promise<void> {
  if (process.env.OPENBUDDY_WORKSPACE_SHADOW !== "1") return;
  try {
    const { workspaceCheckViaBridge } = await import("../agent-workspace-bridge");
    const verdict = await workspaceCheckViaBridge(candidate);
    if (verdict) {
      console.debug("[workspace-shadow] host-core verdict", {
        candidate,
        inWorkspace: verdict.inWorkspace,
        exists: verdict.exists,
        ignored: verdict.ignored,
      });
    }
  } catch {
    // 影子模式永不影响主路径。
  }
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

