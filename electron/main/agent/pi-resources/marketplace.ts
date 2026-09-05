/**
 * P2-13: Plugin marketplace sub-module.
 *
 * Owns the plugin registry (`<agentRoot>/plugins/`, project `.pi/plugins/`)
 * scan, the pi.dev remote catalog fetcher + parser, and install/uninstall
 * mutations. ~800 lines in the original monolith; this split means the
 * HTML-parsing regexes and the `parseHookConfig` compat-adapter machinery
 * only reach the runtime when the user opens the marketplace panel.
 *
 * `mcp.ts` imports `listMarketplaceMcpServers` from here to merge
 * plugin-contributed MCP servers into the user config view.
 */
import { cp, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile as defaultExecFile } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";
import {
  ensureOpenBuddyProfile,
  parseHookConfig,
  readOpenBuddyProfile,
  updateProfileExtensions,
} from "@openbuddy/plugin-host";
/**
 * P2-13 stage 2: lazily resolve `findCompatibilityAdapterForPackageName`
 * from `../pi-extensions` so marketplace.ts has zero static runtime dep on
 * any other `.ts` workspace source. Each call awaits the import — V8's
 * module cache makes the second-and-onwards cost ~0 µs.
 */
async function findCompatibilityAdapterForPackageName(pluginName: string) {
  const mod = await import("../pi-extensions");
  return mod.findCompatibilityAdapterForPackageName(pluginName);
}
import {
  agentHome,
  agentRoot,
  assertResourcePath,
  readJson,
  safeName,
  within,
  workspaceRoot,
  writeJson,
} from "./shared";

type MarketplaceSource =
  | { name: string; kind: "local"; path: string; builtIn?: boolean }
  | { name: string; kind: "remote"; url: string; builtIn?: boolean };

/**
 * Built-in remote marketplaces. The first entry — `pi.dev` — is the official
 * Pi package catalog (https://pi.dev/packages). It is registered automatically
 * on first scan and marked built-in so the UI prevents the user from removing
 * it. Custom registries can be added through `marketplaceAddSource`.
 */
const BUILTIN_MARKETPLACE_SOURCES: MarketplaceSource[] = [
  { name: "pi.dev", kind: "remote", url: "https://pi.dev/packages", builtIn: true },
];

export type PluginRecord = {
  name: string;
  id?: string;
  root: string;
  scope: "user" | "project";
  trusted: boolean;
  enabled: boolean;
  version?: string;
  description?: string;
  skillCount: number;
  skillNames: string[];
  agentCount: number;
  agentNames: string[];
  hookCount: number;
  hookPoints: string[];
  hookDiagnostics: Array<{ level: string; message: string; event?: string; matcher?: string }>;
  mcpServerCount: number;
};

export interface PiPluginResourcePaths {
  plugin: PluginRecord;
  extensions: string[];
  skills: string[];
  prompts: string[];
  themes: string[];
}

export interface PiPluginAgentFile {
  plugin: PluginRecord;
  path: string;
  content: string;
}

export interface PiDevPackagePage {
  /** Page number (1-based) used to disambiguate paginated sources. */
  pageNumber: number;
  /** Total packages quoted in `packages-count` (e.g. "1-50 / 5573" → 5573). */
  totalPackages?: number;
  /** Last paginated link observed (e.g. the `>112<` rendered on page 112). */
  totalPages?: number;
  /** All cards on this page (or up to the largest page actually loaded). */
  packages: RemoteCatalogEntry[];
}

export interface MarketplaceMcpServer {
  name: string;
  config: Record<string, unknown>;
  plugin: PluginRecord;
}

type McpConfig = { mcpServers?: Record<string, Record<string, unknown>> } & Record<string, unknown>;

interface RemoteCatalogEntry {
  name: string;
  version?: string;
  description?: string;
  homepage?: string;
  tags?: string[];
  tarball?: string;
  repoUrl?: string;
  /** npm registry package page (derived from the pi.dev card's `npm` link when present). */
  npmUrl?: string;
  /** Git repo URL surfaced by pi.dev so we can clone when a tarball is unavailable. */
  repoHomepage?: string;
  /** Weekly download band pi.dev quotes (e.g. `17.1K/mo`). Pre-rendered so the UI
   *  never has to call npm just for the popularity column. */
  downloads?: string;
  /** Relative "Xh ago / Xd ago" timestamp surfaced by pi.dev. */
  updatedRelative?: string;
  /** Package author / maintainer as rendered on pi.dev. */
  author?: string;
  /** pi.dev package type badge (`extension`, `skill`, `theme`, `provider`, `prompt`). */
  type?: string;
  /** Source page that contributed this entry (1-based). Useful for diagnostics
   *  when a single fetch truncates mid-page. */
  sourcePage?: number;
}

interface RemoteCatalogCache {
  sourceUrl: string;
  fetchedAt: string;
  entries: RemoteCatalogEntry[];
  /** Authoritative total package count quoted by the source (e.g. `5573`). */
  totalPackages?: number;
  /** Total paginated pages observed at scan time (e.g. `112`). */
  totalPages?: number;
}

/**
 * Cache for the remote catalog index. The pi.dev HTML is large and changes
 * only when packages are added; refresh once per hour by default and let the
 * caller force a refetch.
 */
const REMOTE_CACHE_TTL_MS = 60 * 60 * 1000;
const REMOTE_REQUEST_TIMEOUT_MS = 12_000;

/** Concurrency cap for the per-page HTML fetches. pi.dev serves 50 cards per
 *  page, so we batch in groups of 4 to keep the worker pool warm without
 *  tripping rate-limits or duplicating an entire page on transient blips. */
const REMOTE_PAGE_FETCH_CONCURRENCY = 4;

/** pi.dev renders exactly 50 cards per paginated page (verified against page-112:
 *  "5551-5573 / 5573" → 23 cards; page-1 → "1-50 / 5573" → 50 cards). */
const REMOTE_CARDS_PER_PAGE = 50;

async function readRemoteCache(sourceUrl: string): Promise<RemoteCatalogCache | undefined> {
  const file = join(agentRoot(), "marketplace-cache.json");
  const stored = await readJson<{ caches?: RemoteCatalogCache[] }>(file, {});
  return stored.caches?.find((entry) => entry.sourceUrl === sourceUrl);
}

async function writeRemoteCache(
  sourceUrl: string,
  entries: RemoteCatalogEntry[],
  totals: { totalPackages?: number; totalPages?: number } = {},
): Promise<void> {
  const file = join(agentRoot(), "marketplace-cache.json");
  const stored = await readJson<{ caches?: RemoteCatalogCache[] }>(file, {});
  const caches = (stored.caches ?? []).filter((entry) => entry.sourceUrl !== sourceUrl);
  caches.push({
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    entries,
    ...(totals.totalPackages !== undefined ? { totalPackages: totals.totalPackages } : {}),
    ...(totals.totalPages !== undefined ? { totalPages: totals.totalPages } : {}),
  });
  await writeJson(file, { caches });
}

export async function listMarketplaceMcpServers(cwd?: string | null): Promise<MarketplaceMcpServer[]> {
  const result: MarketplaceMcpServer[] = [];
  for (const plugin of await listPlugins(cwd)) {
    if (!plugin.enabled) continue;
    const config = await readJson<McpConfig>(join(plugin.root, "mcp.json"), { mcpServers: {} });
    for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
      if (!server || typeof server !== "object" || Array.isArray(server)) continue;
      result.push({ name, config: { ...server }, plugin });
    }
  }
  return result.sort((left, right) => left.name.localeCompare(right.name) || left.plugin.name.localeCompare(right.plugin.name));
}

async function manifestResourcePaths(
  root: string,
  manifest: Record<string, unknown>,
  field: "extensions" | "skills" | "prompts" | "themes",
): Promise<string[]> {
  const pi = manifest.pi;
  const declared = pi && typeof pi === "object" && !Array.isArray(pi)
    ? (pi as Record<string, unknown>)[field]
    : undefined;
  if (Array.isArray(declared) && declared.every((entry) => typeof entry === "string")) {
    const candidates = declared.map((entry) => resolve(root, entry));
    const checks = await Promise.all(candidates.map(async (entry) => ((await stat(entry, { throwIfNoEntry: false })) ? entry : undefined)));
    return checks.filter((entry): entry is string => entry !== undefined);
  }
  const convention = join(root, field);
  return (await stat(convention, { throwIfNoEntry: false }))?.isDirectory() ? [convention] : [];
}

/** Resolve Pi-native resources declared by installed marketplace plugins. */
export async function listPiPluginResourcePaths(cwd?: string | null): Promise<PiPluginResourcePaths[]> {
  const plugins = await listPlugins(cwd);
  const result: PiPluginResourcePaths[] = [];
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    const manifest = await readJson<Record<string, unknown>>(join(plugin.root, "package.json"), {});
    const [extensions, skills, prompts, themes] = await Promise.all([
      manifestResourcePaths(plugin.root, manifest, "extensions"),
      manifestResourcePaths(plugin.root, manifest, "skills"),
      manifestResourcePaths(plugin.root, manifest, "prompts"),
      manifestResourcePaths(plugin.root, manifest, "themes"),
    ]);
    result.push({ plugin, extensions, skills, prompts, themes });
  }
  return result;
}

/** Resolve context files declared by enabled marketplace plugins. */
export async function listPiPluginAgentFiles(cwd?: string | null): Promise<PiPluginAgentFile[]> {
  const result: PiPluginAgentFile[] = [];
  for (const plugin of await listPlugins(cwd)) {
    if (!plugin.enabled) continue;
    const root = join(plugin.root, "agents");
    let entries: import("node:fs").Dirent[] = [];
    try { entries = await readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".md")).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(root, entry.name);
      try {
        result.push({ plugin, path, content: await readFile(path, "utf8") });
      } catch {
        // Ignore files removed while the plugin is being refreshed.
      }
    }
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

async function directoryCount(root: string, suffix?: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && (!suffix || entry.name.endsWith(suffix))).map((entry) => entry.name);
  } catch { return []; }
}

async function manifestHookSummary(root: string, manifest: Record<string, unknown>): Promise<{
  count: number;
  points: string[];
  diagnostics: Array<{ level: string; message: string; event?: string; matcher?: string }>;
}> {
  const declarations: unknown[] = [];
  for (const namespaceName of ["openbuddy", "dsh"]) {
    const namespace = manifest[namespaceName];
    if (namespace && typeof namespace === "object" && !Array.isArray(namespace)) {
      const hooks = (namespace as Record<string, unknown>).hooks;
      if (hooks !== undefined) declarations.push(hooks);
    }
  }
  const summaries = [];
  for (const declaration of declarations) {
    let value = declaration;
    if (typeof declaration === "string") {
      try { value = JSON.parse(await readFile(resolve(root, declaration), "utf8")) as unknown; } catch { }
    }
    summaries.push(parseHookConfig(value));
  }
  const points = [...new Set(summaries.flatMap((summary) => Object.keys(summary.config.events)))];
  const diagnostics = summaries.flatMap((summary) => summary.diagnostics);
  const count = summaries.reduce((total, summary) => total + Object.values(summary.config.events).flatMap((groups) => groups ?? []).reduce((groupTotal, group) => groupTotal + group.hooks.length, 0), 0);
  return { count, points, diagnostics };
}

async function scanPluginRoot(root: string, scope: "user" | "project"): Promise<PluginRecord[]> {
  let entries: import("node:fs").Dirent[] = [];
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const settings = await readJson<Record<string, unknown>>(join(agentRoot(), "settings.json"), {});
  const disabled = new Set(Array.isArray(settings.disabledPlugins) ? settings.disabledPlugins.filter((value): value is string => typeof value === "string") : []);
  const result: PluginRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginRoot = join(root, entry.name);
    const manifest = await readJson<Record<string, unknown>>(join(pluginRoot, "package.json"), {});
    const skills = await readdir(join(pluginRoot, "skills"), { withFileTypes: true }).catch(() => [] as import("node:fs").Dirent[]);
    const agents = await directoryCount(join(pluginRoot, "agents"), ".md");
    const mcp = await readJson<Record<string, unknown>>(join(pluginRoot, "mcp.json"), {});
    const hookSummary = await manifestHookSummary(pluginRoot, manifest);
    const conventionHooks = await directoryCount(join(pluginRoot, "hooks"));
    result.push({
      name: typeof manifest.name === "string" ? manifest.name : entry.name,
      id: typeof manifest.id === "string" ? manifest.id : entry.name,
      root: pluginRoot,
      scope,
      trusted: manifest.trusted !== false,
      enabled: !disabled.has(entry.name) && !disabled.has(String(manifest.name ?? entry.name)),
      version: typeof manifest.version === "string" ? manifest.version : undefined,
      description: typeof manifest.description === "string" ? manifest.description : undefined,
      skillCount: skills.filter((item) => item.isDirectory()).length,
      skillNames: skills.filter((item) => item.isDirectory()).map((item) => item.name),
      agentCount: agents.length,
      agentNames: agents.map((name) => name.replace(/\.md$/, "")),
      hookCount: hookSummary.count || conventionHooks.length,
      hookPoints: hookSummary.points,
      hookDiagnostics: hookSummary.diagnostics,
      mcpServerCount: mcp.mcpServers && typeof mcp.mcpServers === "object" ? Object.keys(mcp.mcpServers).length : 0,
    });
  }
  return result;
}

export async function listPlugins(cwd?: string | null): Promise<PluginRecord[]> {
  const roots: Array<[string, "user" | "project"]> = [[join(agentRoot(), "plugins"), "user"]];
  if (cwd) roots.push([join(workspaceRoot(cwd), ".pi", "plugins"), "project"]);
  return (await Promise.all(roots.map(([root, scope]) => scanPluginRoot(root, scope)))).flat().sort((a, b) => a.name.localeCompare(b.name));
}

export async function setPluginEnabled(name: string, enabled: boolean): Promise<void> {
  const file = join(agentRoot(), "settings.json");
  const settings = await readJson<Record<string, unknown>>(file, {});
  const disabled = new Set(Array.isArray(settings.disabledPlugins) ? settings.disabledPlugins.filter((value): value is string => typeof value === "string") : []);
  if (enabled) disabled.delete(name); else disabled.add(name);
  settings.disabledPlugins = [...disabled];
  await writeJson(file, settings);
}

export async function marketplaceRead(): Promise<{ sources: MarketplaceSource[] }> {
  const stored = await readJson<{ sources?: MarketplaceSource[] }>(join(agentRoot(), "marketplaces.json"), {});
  const storedSources = Array.isArray(stored.sources) ? stored.sources : [];
  // Always surface built-in remote sources even if the on-disk file is stale
  // or empty. New built-ins added in a future release appear without a
  // destructive migration step.
  const merged: MarketplaceSource[] = [...storedSources];
  for (const builtin of BUILTIN_MARKETPLACE_SOURCES) {
    if (!merged.some((entry) => entry.kind === "remote" && entry.kind === "remote" && builtin.kind === "remote" && entry.url === builtin.url)) {
      merged.push(builtin);
    }
  }
  return { sources: merged };
}

export async function marketplaceWrite(value: { sources: MarketplaceSource[] }): Promise<void> {
  await writeJson(join(agentRoot(), "marketplaces.json"), value);
}

export async function marketplaceEnsureBuiltins(): Promise<{ sources: MarketplaceSource[] }> {
  const config = await marketplaceRead();
  // Persist back so removal of a built-in from the on-disk file is corrected
  // on next launch; this is also where a user-added custom source gets
  // preserved across upgrades.
  await marketplaceWrite(config);
  return config;
}

export async function marketplaceAddSource(sourcePath: string): Promise<void> {
  const trimmed = sourcePath.trim();
  if (!trimmed) throw new Error("marketplace source is required");
  const isRemote = /^https?:\/\//i.test(trimmed);
  if (isRemote) {
    // The marketplace surface is intentionally restricted to the built-in
    // pi.dev registry (see BUILTIN_MARKETPLACE_SOURCES). User-supplied remote
    // URLs are rejected to avoid a malicious catalog pointing at hostile
    // packages; local filesystem marketplaces are still allowed because they
    // are user-trusted by construction.
    throw new Error(`remote marketplace sources are not supported: ${trimmed}`);
  }
  const absolute = await realpath(resolve(trimmed));
  if (!(await stat(absolute)).isDirectory()) throw new Error("marketplace source must be a directory");
  const current = await marketplaceRead();
  if (!current.sources.some((source) => source.kind === "local" && source.path === absolute)) {
    current.sources.push({ name: absolute.split("/").pop() ?? absolute, kind: "local", path: absolute });
  }
  await marketplaceWrite(current);
}

export async function marketplaceRemoveSource(sourcePath: string): Promise<void> {
  const current = await marketplaceRead();
  const absolute = await realpath(resolve(sourcePath)).catch(() => resolve(sourcePath));
  current.sources = current.sources.filter((source) => {
    if (source.builtIn) return true; // never drop a built-in remote source
    if (source.kind === "local") return source.path !== absolute;
    return source.url !== sourcePath;
  });
  await marketplaceWrite(current);
}

export async function marketplaceScan(
  options: { force?: boolean; maxPages?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ sources: Array<Record<string, unknown>> }> {
  const config = await marketplaceEnsureBuiltins();
  const sources: Array<Record<string, unknown>> = [];
  const installed = await listPlugins();
  for (const source of config.sources) {
    if (source.kind === "local") {
      try {
        const plugins = await scanPluginRoot(join(source.path, "plugins"), "user");
        sources.push({
          sourceName: source.name,
          sourceKind: source.kind,
          sourceKindValue: "local" as const,
          sourceUrlOrPath: source.path,
          builtIn: source.builtIn === true,
          plugins: plugins.map((plugin) => ({
            ...plugin,
            relativePath: plugin.root.slice(join(source.path, "plugins").length + 1),
            hasHooks: plugin.hookCount > 0,
            hasAgents: plugin.agentCount > 0,
            hasMcp: plugin.mcpServerCount > 0,
            installStatus: installed.some((item) => item.name === plugin.name) ? "installed" : "available",
          })),
        });
      } catch (error) {
        sources.push({
          sourceName: source.name,
          sourceKind: source.kind,
          sourceKindValue: "local" as const,
          sourceUrlOrPath: source.path,
          builtIn: source.builtIn === true,
          plugins: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }
    // Remote (e.g. pi.dev) source.
    // On the default (no-force) path, surface the cache as its own source
    // row so the UI can render a "上次更新" badge and a distinct "来自缓存"
    // affordance. The "remote" row stays for cases where the cache is stale
    // or force=true — the consumer decides which to display.
    if (!options.force) {
      const cached = await readRemoteCache(source.url);
      if (cached && Date.now() - Date.parse(cached.fetchedAt) < REMOTE_CACHE_TTL_MS) {
        sources.push({
          sourceName: "openbuddy://cached-remote",
          sourceKind: "cache",
          sourceKindValue: "cache" as const,
          sourceUrlOrPath: source.url,
          builtIn: source.builtIn === true,
          refreshedAt: cached.fetchedAt,
          ...(cached.totalPackages !== undefined ? { totalPackages: cached.totalPackages } : {}),
          ...(cached.totalPages !== undefined ? { totalPages: cached.totalPages } : {}),
          cacheOrigin: source.name,
          plugins: cached.entries.map((entry) => {
            const existing = installed.find((item) => item.name === entry.name);
            return {
              name: entry.name,
              version: entry.version,
              description: entry.description,
              homepage: entry.homepage,
              tags: entry.tags,
              relativePath: entry.name,
              skillCount: 0,
              hasHooks: false,
              hasAgents: false,
              hasMcp: false,
              installStatus: existing ? "installed" : "available",
              installedVersion: existing?.version,
              remoteUrl: entry.tarball,
              remoteRef: entry.version,
            };
          }),
        });
        // Cache hit — skip the remote scan entirely (the cache row replaces it).
        continue;
      }
      // No fresh cache. When the caller did NOT supply a fetchImpl AND did
      // NOT set force, the production code path would fall through to real
      // `fetch`, which (a) blocks the IPC channel on a slow remote scan
      // and (b) trips the undici AbortSignal strict-type check under
      // Node 22+. Surface an empty remote row instead of silently hanging.
      // Callers that want a live scan must explicitly opt in with
      // { force: true, fetchImpl }.
      if (options.fetchImpl === undefined) {
        sources.push({
          sourceName: source.name,
          sourceKind: source.kind,
          sourceKindValue: "remote" as const,
          sourceUrlOrPath: source.url,
          builtIn: source.builtIn === true,
          plugins: [],
          requiresFetch: true,
        });
        continue;
      }
    }
    try {
      const remote = await marketplaceScanRemote(source.url, {
        ...(options.force !== undefined ? { force: options.force } : {}),
        ...(options.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
        ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      });
      sources.push({
        sourceName: source.name,
        sourceKind: source.kind,
        sourceKindValue: "remote" as const,
        sourceUrlOrPath: source.url,
        builtIn: source.builtIn === true,
        refreshedAt: remote.refreshedAt,
        ...(remote.totalPackages !== undefined ? { totalPackages: remote.totalPackages } : {}),
        ...(remote.totalPages !== undefined ? { totalPages: remote.totalPages } : {}),
        plugins: remote.entries.map((entry) => {
          const existing = installed.find((item) => item.name === entry.name);
          return {
            name: entry.name,
            version: entry.version,
            description: entry.description,
            homepage: entry.homepage,
            tags: entry.tags,
            relativePath: entry.name,
            skillCount: 0,
            hasHooks: false,
            hasAgents: false,
            hasMcp: false,
            installStatus: existing ? "installed" : "available",
            installedVersion: existing?.version,
            remoteUrl: entry.tarball,
            remoteRef: entry.version,
          };
        }),
      });
    } catch (error) {
      // Fall back to the last-good cache so the panel can still render and the
      // user can see what was previously available.
      const cached = await readRemoteCache(source.url);
      sources.push({
        sourceName: source.name,
        sourceKind: source.kind,
        sourceKindValue: "remote" as const,
        sourceUrlOrPath: source.url,
        builtIn: source.builtIn === true,
        refreshedAt: cached?.fetchedAt,
        ...(cached?.totalPackages !== undefined ? { totalPackages: cached.totalPackages } : {}),
        ...(cached?.totalPages !== undefined ? { totalPages: cached.totalPages } : {}),
        plugins: (cached?.entries ?? []).map((entry) => {
          const existing = installed.find((item) => item.name === entry.name);
          return {
            name: entry.name,
            version: entry.version,
            description: entry.description,
            homepage: entry.homepage,
            tags: entry.tags,
            relativePath: entry.name,
            skillCount: 0,
            hasHooks: false,
            hasAgents: false,
            hasMcp: false,
            installStatus: existing ? "installed" : "available",
            installedVersion: existing?.version,
            remoteUrl: entry.tarball,
            remoteRef: entry.version,
          };
        }),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { sources };
}

/**
 * Fetch a remote catalog and aggregate every package card on every page.
 *
 * pi.dev is a server-rendered paginated index:
 *   - Page 1 URL:                https://pi.dev/packages
 *   - Subsequent pages:          https://pi.dev/packages?page=N  (50 cards each)
 *   - Total quoted in DOM:       <span class="packages-count">1-50 / 5573</span>
 *   - Last page link rendered:   <a class="pagination-page" href="/packages?page=112">112</a>
 *
 * A single card already contains the fields the panel needs (description,
 * author, downloads, updated, links, type badge) so we no longer fan out
 * one npm-registry request per package. That cut a 5,000-package scan
 * from ~5K HTTP calls to ~112 HTML fetches (one per page) and brought the
 * user-visible "数量也不对" complaint from "50" to "5573" in one pass.
 *
 * The legacy npm-registry enrichment path is still wired up for callers
 * who want a tarball/version pair (e.g. non-pi.dev sources). For pi.dev we
 * skip it: pi.dev cards link to https://www.npmjs.com/package/<name>, which
 * we surface directly, and `pi install npm:<name>` is the install command
 * the panel already teaches the user.
 */
export async function marketplaceScanRemote(
  sourceUrl: string,
  options: { force?: boolean; fetchImpl?: typeof fetch; maxPages?: number } = {},
): Promise<{ entries: RemoteCatalogEntry[]; refreshedAt: string; totalPackages?: number; totalPages?: number }> {
  if (!options.force) {
    const cached = await readRemoteCache(sourceUrl);
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < REMOTE_CACHE_TTL_MS) {
      return {
        entries: cached.entries,
        refreshedAt: cached.fetchedAt,
        ...(cached.totalPackages !== undefined ? { totalPackages: cached.totalPackages } : {}),
        ...(cached.totalPages !== undefined ? { totalPages: cached.totalPages } : {}),
      };
    }
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  // Fetch page 1 once so the legacy anchor-only fallback (used when a
  // minimal catalog has no card-body markup) doesn't double-fetch it.
  const firstPage = await fetchRemoteCatalogPage(sourceUrl, 1, fetchImpl);
  if (firstPage === undefined) {
    // Persist an empty cache when the caller forced the fetch — otherwise
    // every subsequent default-path scan would refetch the broken upstream.
    // On the default path we leave the cache file alone so an empty
    // marketplace row never materializes; the next default scan will try
    // again, and the user can manually force a refresh if needed.
    if (options.force) {
      await writeRemoteCache(sourceUrl, []);
      return { entries: [], refreshedAt: new Date().toISOString() };
    }
    return { entries: [], refreshedAt: new Date(0).toISOString() };
  }
  let aggregate: { entries: RemoteCatalogEntry[]; totalPackages?: number; totalPages?: number };
  if (looksLikeFullPiDevHtml(firstPage.html)) {
    // Full pi.dev layout → reuse the cached page-1 HTML inside the aggregator
    // by passing it inline. This both saves a second HTTP request and keeps
    // the aggregator's cache key stable for tests asserting fetch counts.
    aggregate = await aggregateFromFirstHtml(firstPage.html, sourceUrl, fetchImpl, { maxPages: options.maxPages });
  } else {
    // Anchor-only HTML → legacy path. Don't talk to npm registry unless we
    // actually got names; pi-dev's `packages-count` element lets us skip
    // paged refetch when we already have everything we need.
    const names = parsePiDevPackageNames(firstPage.html);
    const legacyEntries: RemoteCatalogEntry[] = [];
    await Promise.all(names.map(async (name) => {
      try {
        const meta = await fetchNpmMetadata(name, fetchImpl);
        if (meta) legacyEntries.push(meta);
      } catch { /* per-package failures are tolerated */ }
    }));
    aggregate = { entries: legacyEntries };
  }
  aggregate.entries.sort((a, b) => a.name.localeCompare(b.name));
  const refreshedAt = new Date().toISOString();
  // Persist first so the value we return matches what we cached (avoids
  // a 1ms drift that would surprise tests asserting cache round-trip).
  await writeRemoteCache(sourceUrl, aggregate.entries, {
    ...(aggregate.totalPackages !== undefined ? { totalPackages: aggregate.totalPackages } : {}),
    ...(aggregate.totalPages !== undefined ? { totalPages: aggregate.totalPages } : {}),
  });
  const stored = await readRemoteCache(sourceUrl);
  const cachedRefreshedAt = stored?.fetchedAt ?? refreshedAt;
  return {
    entries: aggregate.entries,
    refreshedAt: cachedRefreshedAt,
    ...(aggregate.totalPackages !== undefined ? { totalPackages: aggregate.totalPackages } : {}),
    ...(aggregate.totalPages !== undefined ? { totalPages: aggregate.totalPages } : {}),
  };
}

/** Detect a fully-rendered pi.dev page (vs. an anchor-only minimal HTML
 *  exposed by older layouts or unit-test fixtures). The full page always
 *  carries the `packages-count` element with the "1-50 / N" headline. */
export function looksLikeFullPiDevHtml(html: string): boolean {
  return /<span class="packages-count"/.test(html);
}

/** Aggregate a full pi.dev catalog starting from an already-fetched first
 *  page. Used by both `marketplaceScanRemote` (to avoid double-fetching
 *  page 1) and `fetchAndAggregateRemoteCatalog` (which fetches page 1
 *  itself). */
export async function aggregateFromFirstHtml(
  firstHtml: string,
  sourceUrl: string,
  fetchImpl: typeof fetch,
  options: { maxPages?: number } = {},
): Promise<{ entries: RemoteCatalogEntry[]; totalPackages?: number; totalPages?: number }> {
  const indexes: PiDevPackagePage[] = [];
  const first = parsePiDevPackagesFromHtml(firstHtml, 1);
  indexes.push(first);
  const totalPages = first.totalPages;
  const targetPages = computeTargetPages(first.totalPackages, totalPages, options.maxPages);
  if (targetPages.length > 0) {
    await mapWithConcurrency(targetPages, REMOTE_PAGE_FETCH_CONCURRENCY, async (pageNumber) => {
      const pageHtml = await fetchRemoteCatalogPage(sourceUrl, pageNumber, fetchImpl);
      if (pageHtml === undefined) return;
      indexes.push(parsePiDevPackagesFromHtml(pageHtml.html, pageNumber));
    });
  }
  const merged = new Map<string, RemoteCatalogEntry>();
  for (const page of indexes) {
    for (const entry of page.packages) {
      // First writer wins so pagination 1 (which has the full `?page=N` link
      // stripped) overrides a later partial render.
      if (!merged.has(entry.name)) merged.set(entry.name, { ...entry });
    }
  }
  return {
    entries: [...merged.values()],
    ...(first.totalPackages !== undefined ? { totalPackages: first.totalPackages } : {}),
    ...(totalPages !== undefined ? { totalPages } : {}),
  };
}

/** Fetch every paginated index page for a pi.dev-style catalog and merge the
 *  per-card metadata into a single entries array. Honors the displayed
 *  `packages-count` so the panel can render an honest "N packages" headline
 *  even when one page is missing on a flaky network. */
export async function fetchAndAggregateRemoteCatalog(
  sourceUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ entries: RemoteCatalogEntry[]; totalPackages?: number; totalPages?: number }> {
  const firstHtml = await fetchRemoteCatalogPage(sourceUrl, 1, fetchImpl);
  if (firstHtml === undefined) {
    return { entries: [] };
  }
  return aggregateFromFirstHtml(firstHtml.html, sourceUrl, fetchImpl);
}

function computeTargetPages(totalPackages: number | undefined, totalPages: number | undefined, maxPages?: number): number[] {
  const cap = (value: number): number => (maxPages && maxPages > 0 ? Math.min(value, maxPages) : value);
  if (totalPages !== undefined && totalPages > 1) {
    return Array.from({ length: cap(totalPages) - 1 }, (_, i) => i + 2);
  }
  if (totalPackages !== undefined) {
    // pi.dev ships 50 cards per page; clamp to a sane upper bound so a forged
    // `count="1000000"` DOM can't trick us into spinning up 20k HTTP requests.
    const pages = Math.min(2000, Math.max(1, Math.ceil(totalPackages / REMOTE_CARDS_PER_PAGE)));
    if (pages <= 1) return [];
    return Array.from({ length: cap(pages) - 1 }, (_, i) => i + 2);
  }
  return [];
}

async function fetchRemoteCatalogPage(
  sourceUrl: string,
  pageNumber: number,
  fetchImpl: typeof fetch,
): Promise<{ html: string } | undefined> {
  const pageUrl = pageNumber <= 1
    ? sourceUrl
    : joinPageUrl(sourceUrl, pageNumber);
  try {
    const response = await fetchImpl(pageUrl, {
      signal: AbortSignal.timeout(REMOTE_REQUEST_TIMEOUT_MS),
      headers: { "user-agent": "openbuddy-marketplace/1.0 (+https://pi.dev)" },
    });
    if (!response.ok) {
      // Logged-but-ignored: aggregate() tolerates individual page failures so
      // a flaky proxy at page 90 doesn't blank the entire panel. We still
      // emit a structured warning so users can diagnose from logs.
      console.warn(`[openbuddy-marketplace] remote page ${pageNumber} HTTP ${response.status}`);
      return undefined;
    }
    return { html: await response.text() };
  } catch (error) {
    console.warn(`[openbuddy-marketplace] remote page ${pageNumber} fetch failed`, error);
    return undefined;
  }
}

/** Page-number-aware URL construction. pi.dev uses `?page=N` (omitted on
 *  page 1). We rebuild the URL so unrelated query strings on `sourceUrl` are
 *  preserved (e.g. `?name=foo`). */
function joinPageUrl(sourceUrl: string, pageNumber: number): string {
  const url = new URL(sourceUrl);
  if (pageNumber <= 1) {
    url.searchParams.delete("page");
  } else {
    url.searchParams.set("page", String(pageNumber));
  }
  return url.toString();
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Extract every pi.dev package card on a single index page. pi.dev renders the
 * list as `<div class="packages-card-body">…</div>` siblings, each anchoring to
 * `/packages/<name>` with a `data-package-path` attribute (the canonical,
 * no-query-string name). The card body already carries description, author,
 * downloads, last-updated, npm/repo/report links, and the install command,
 * so callers don't have to call the npm registry just to render the panel.
 */
export function parsePiDevPackagesFromHtml(html: string, pageNumber: number = 1): PiDevPackagePage {
  const totalPackages = parsePackagesCount(html);
  const totalPages = parseLastPaginationPage(html);
  const cardRegex = /<div class="packages-card-body">([\s\S]*?)<\/div>\s*(?=<div class="packages-card-body"|<\/div>\s*<\/main|<\/body>)/g;
  const packages: RemoteCatalogEntry[] = [];
  let cardMatch: RegExpExecArray | null;
  while ((cardMatch = cardRegex.exec(html)) !== null) {
    const body = cardMatch[1] ?? "";
    const pathMatch = /data-package-path="\/packages\/([^"]+)"/.exec(body);
    if (!pathMatch) continue;
    const name = decodePiPathComponent(pathMatch[1] ?? "");
    if (!name) continue;
    packages.push({
      name,
      description: readTextAfterClass(body, "packages-desc") ?? undefined,
      author: readFirstMetaSpan(body),
      downloads: readMetaSpan(body, 1),
      updatedRelative: readMetaSpan(body, 2),
      type: readBadgeType(body),
      npmUrl: readLinkByLabel(body, "npm") ?? undefined,
      repoUrl: readLinkByLabel(body, "repo") ?? undefined,
      repoHomepage: readLinkByLabel(body, "report") ?? undefined,
      ...(pageNumber ? { sourcePage: pageNumber } : {}),
    });
  }
  const result: PiDevPackagePage = {
    pageNumber,
    packages,
    ...(totalPackages !== undefined ? { totalPackages } : {}),
    ...(totalPages !== undefined ? { totalPages } : {}),
  };
  return result;
}

/** Decode a URL-path component while preserving scoped `@scope/name` form.
 *  pi.dev encodes `@` as `%40`; we mirror that back to `@scope/name`. */
function decodePiPathComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Parse "<a>-<b> / <total>" from the `packages-count` element. pi.dev emits
 *  `<span class="packages-count">1-50 / 5573</span>`. */
function parsePackagesCount(html: string): number | undefined {
  const match = /<span class="packages-count"[^>]*>\s*[\d,]+\s*-\s*[\d,]+\s*\/\s*([\d,]+)/.exec(html);
  if (!match) return undefined;
  const raw = (match[1] ?? "").replace(/,/g, "");
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Last paginated page link pi.dev renders, e.g. `<a class="pagination-page" href="/packages?page=112">112</a>`. */
function parseLastPaginationPage(html: string): number | undefined {
  // pi-dev emits both the regular list (<a class="pagination-page" ...>N</a>)
  // and the current-page marker (<span class="pagination-page is-active" ...>N</span>).
  // Without the active span we would always report N-1 instead of N.
  const anchorRegex = /<a class="pagination-page[^"]*"[^>]*>\s*(\d+)\s*<\/a>/g;
  const spanRegex = /<span class="pagination-page[^"]*"[^>]*>\s*(\d+)\s*<\/span>/g;
  const matches = [...html.matchAll(anchorRegex), ...html.matchAll(spanRegex)];
  if (matches.length === 0) return undefined;
  let max = 0;
  for (const m of matches) {
    const value = Number.parseInt(m[1] ?? "0", 10);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max > 0 ? max : undefined;
}

/** Strip surrounding whitespace and HTML tags around `<span class="X">…</span>`. */
function readTextAfterClass(html: string, className: string): string | undefined {
  const re = new RegExp(`<[^>]+class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`);
  const match = re.exec(html);
  if (!match) return undefined;
  return stripTags(match[1] ?? "").trim();
}

function readFirstMetaSpan(html: string): string | undefined {
  const block = /<div class="packages-meta"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  if (!block) return undefined;
  const spans = [...(block[1] ?? "").matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((m) => stripTags(m[1] ?? "").trim());
  return spans[0];
}

function readMetaSpan(html: string, index: number): string | undefined {
  const block = /<div class="packages-meta"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  if (!block) return undefined;
  const spans = [...(block[1] ?? "").matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((m) => stripTags(m[1] ?? "").trim());
  return spans[index];
}

function readBadgeType(html: string): string | undefined {
  const match = /class="meta-chip packages-badge" data-type="([^"]+)"/.exec(html);
  return match?.[1];
}

function readLinkByLabel(html: string, label: string): string | null | undefined {
  // pi.dev renders the package-links block as three <a>…</a> siblings in
  // this order: npm, repo, report. Match each <a>…</a> once (non-greedy on
  // the inner content) and pick the one whose tail text matches the label.
  const anchorRegex = /<a [^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>/g;
  const target = label.toLowerCase();
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1] ?? "";
    // The closing </a> tag has the link label after the SVG. We are inside
    // a single <a>…</a> node here, so split on </a> and inspect the tail.
    const tail = match[0].toLowerCase().split("</a>")[0] ?? "";
    if (tail.includes(target)) return href;
  }
  return undefined;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

/** Backwards-compatible name-only parser. Kept for tests and external callers
 *  that only need the package list (no metadata). New code should call
 *  `parsePiDevPackagesFromHtml` instead. */
export function parsePiDevPackageNames(html: string): string[] {
  const seen = new Set<string>();
  const re = /href="\/packages\/([^"?#]+)(?:[?"#][^"]*)?"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = decodeURIComponent(match[1] ?? "");
    if (!raw) continue;
    seen.add(raw);
  }
  return [...seen];
}

/** Legacy npm-registry enrichment path — retained for non-pi.dev sources or
 *  when callers explicitly need a tarball URL. Used internally by
 *  `marketplaceAction` for the install path; never invoked during `scan`. */
async function fetchNpmMetadata(
  pkgName: string,
  fetchImpl: typeof fetch,
): Promise<RemoteCatalogEntry | undefined> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkgName).replace(/^%40/, "@")}`;
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(REMOTE_REQUEST_TIMEOUT_MS),
    headers: { accept: "application/json", "user-agent": "openbuddy-marketplace/1.0" },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`npm registry responded with HTTP ${response.status}`);
  const meta = (await response.json()) as {
    name?: string;
    description?: string;
    homepage?: string;
    repository?: { url?: string } | string;
    keywords?: string[];
    "dist-tags"?: { latest?: string };
    versions?: Record<string, { dist?: { tarball?: string } }>;
  };
  const latest = meta["dist-tags"]?.latest;
  const versionData = latest && meta.versions ? meta.versions[latest] : undefined;
  const tarball = versionData?.dist?.tarball;
  const repoUrl = typeof meta.repository === "string" ? meta.repository : meta.repository?.url;
  return {
    name: meta.name ?? pkgName,
    version: latest,
    description: meta.description,
    homepage: meta.homepage,
    tags: Array.isArray(meta.keywords) ? meta.keywords.slice(0, 8) : undefined,
    tarball,
    repoUrl,
  };
}

/**
 * Phase I.2: bridge between the marketplace install/uninstall flow and the
 * profile.piExtensions persistence layer.
 *
 * When the user installs a pi-priority package (one whose npm name appears in
 * a `compatibilityAdapters[*].packageNames` entry), we want the loader to
 * actually use that native package instead of falling back to the OpenBuddy
 * adapter. The single source of truth for "load this package" is
 * `manifest.openbuddy.profile.piExtensions`, so the marketplace must mirror
 * its install state there.
 *
 * Strategy:
 *   install   → write spec with `passthrough: true` so the loader's existing
 *               passthrough path (recordPassthrough) fires on next reload.
 *   uninstall → remove the spec by id.
 *
 * The marketplace layer does NOT call `recordPassthrough` directly: that is
 * the loader's responsibility at reload time. We also don't try to wire up
 * `isPiPackageInstalled` to the marketplace plugins tree — a user who
 * explicitly opted in via marketplace install deserves the explicit flag.
 *
 * Errors here are swallowed with a warning: the marketplace action has
 * already succeeded (the tarball/folder has been copied to `<agentRoot>/plugins`),
 * and we don't want profile-write failures to break the install UX. The
 * profile watcher will pick up any manual edits on the next reload.
 */
async function syncProfileExtension(
  pluginName: string,
  present: boolean,
): Promise<{ synced: boolean; capability?: string; owner?: string }> {
  try {
    const adapter = await findCompatibilityAdapterForPackageName(pluginName);
    if (!adapter) return { synced: false };
    // Bootstrap the desktop profile if it doesn't exist yet. Marketplace
    // install may run before the user has ever opened the app (rare but
    // supported: profile gets created on first read for fresh installs).
    const ensured = await ensureOpenBuddyProfile({ home: agentHome(), profileName: "desktop" });
    const profile = await readOpenBuddyProfile({ profileDir: ensured.dir });
    await updateProfileExtensions(
      profile,
      { id: pluginName, source: pluginName, enabled: true, passthrough: present },
      present,
    );
    return { synced: true, capability: adapter.capability, owner: adapter.owner };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[marketplace] syncProfileExtension(${pluginName}, present=${present}) failed: ${message}`);
    return { synced: false };
  }
}

export async function marketplaceAction(action: Record<string, unknown>): Promise<Record<string, unknown>> {
  const type = String(action.type ?? "");
  if (type === "add_source") {
    const source = String(action.url ?? action.sourceUrlOrPath ?? "");
    if (!source) throw new Error("marketplace source is required");
    await marketplaceAddSource(source);
    return { ok: true };
  }
  if (type === "remove_source") {
    const target = String(action.sourceUrlOrPath ?? "");
    const config = await marketplaceRead();
    const builtin = config.sources.find((entry) => {
      if (!entry.builtIn) return false;
      if (entry.kind === "local") return entry.path === target;
      if (entry.kind === "remote") return entry.url === target;
      return false;
    });
    if (builtin) throw new Error(`${builtin.name} is a built-in marketplace and cannot be removed`);
    await marketplaceRemoveSource(target);
    return { ok: true };
  }
  if (type === "refresh") return marketplaceScan();
  const sourceValue = String(action.sourceUrlOrPath ?? "").trim();
  const isRemote = /^https?:\/\//i.test(sourceValue);
  const configured = await marketplaceRead();
  if (isRemote) {
    const registered = configured.sources.find((entry) => entry.kind === "remote" && entry.url === sourceValue);
    if (!registered) throw new Error("marketplace source is not registered");
    const pluginName = safeName(String(action.pluginRelativePath ?? ""));
    if (!pluginName) throw new Error("pluginRelativePath is required");
    const targetRoot = join(agentRoot(), "plugins", pluginName);
    if (type === "install" || type === "update") {
      // Re-scan with force to pick up the latest version even when the cache
      // is still warm; a force=false install would happily install an outdated
      // tarball cached up to an hour ago.
      const remote = await marketplaceScanRemote(sourceValue, { force: true });
      const entry = remote.entries.find((item) => item.name === pluginName);
      if (!entry) throw new Error(`plugin not found in marketplace: ${pluginName}`);
      if (!entry.tarball) throw new Error(`plugin ${pluginName} has no tarball on npm registry`);
      const tmpDir = await downloadAndExtractTarball(entry.tarball);
      try {
        await cp(tmpDir, targetRoot, { recursive: true, force: true });
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
      // Phase I.2: if the installed package matches a registered
      // compatibility adapter, mirror the install into profile.piExtensions
      // with passthrough=true so the loader's existing passthrough path
      // fires on the next reload.
      const sync = await syncProfileExtension(entry.name, true);
      return {
        ok: true,
        path: targetRoot,
        version: entry.version,
        ...(sync.synced ? { piPriorityEnabled: true, capability: sync.capability } : {}),
      };
    }
    if (type === "uninstall") {
      await rm(within(join(agentRoot(), "plugins"), targetRoot), { recursive: true, force: true });
      const sync = await syncProfileExtension(pluginName, false);
      return sync.synced ? { ok: true, piPriorityEnabled: false, capability: sync.capability } : { ok: true };
    }
    throw new Error(`unsupported marketplace action: ${type}`);
  }
  if (!sourceValue) throw new Error("marketplace source is required");
  const source = await realpath(resolve(sourceValue)).catch(() => "");
  const registered = configured.sources.find((entry) => entry.kind === "local" && resolve(entry.path) === source);
  if (!registered) throw new Error("marketplace source is not registered");
  const relativePath = String(action.pluginRelativePath ?? "");
  if (!relativePath || isAbsolute(relativePath)) throw new Error("pluginRelativePath must be relative");
  const pluginsRoot = await realpath(join(source, "plugins"));
  const sourceRoot = await assertResourcePath(join(pluginsRoot, relativePath), [pluginsRoot]);
  if (!(await stat(sourceRoot)).isDirectory()) throw new Error("marketplace plugin must be a directory");
  const pluginName = safeName(sourceRoot.split("/").pop() ?? "plugin");
  const targetRoot = join(agentRoot(), "plugins", pluginName);
  if (type === "install" || type === "update") {
    await cp(sourceRoot, targetRoot, { recursive: true, force: true });
    const sync = await syncProfileExtension(pluginName, true);
    return {
      ok: true,
      path: targetRoot,
      ...(sync.synced ? { piPriorityEnabled: true, capability: sync.capability } : {}),
    };
  }
  if (type === "uninstall") {
    await rm(within(join(agentRoot(), "plugins"), targetRoot), { recursive: true, force: true });
    const sync = await syncProfileExtension(pluginName, false);
    return sync.synced ? { ok: true, piPriorityEnabled: false, capability: sync.capability } : { ok: true };
  }
  throw new Error(`unsupported marketplace action: ${type}`);
}

/**
 * Download a tarball from the npm registry, extract it to a temporary
 * directory, and return the path. The caller is responsible for cleaning up
 * the directory when finished (the directory holds a flat `package/`
 * subfolder — npm layout — so the result of `cp -r` to the plugins root
 * gives the expected layout).
 */
async function downloadAndExtractTarball(
  tarballUrl: string,
  fetchImpl: typeof fetch = fetch,
  execImpl: typeof defaultExecFile = defaultExecFile,
): Promise<string> {
  const response = await fetchImpl(tarballUrl, {
    signal: AbortSignal.timeout(REMOTE_REQUEST_TIMEOUT_MS),
    headers: { "user-agent": "openbuddy-marketplace/1.0" },
  });
  if (!response.ok) throw new Error(`tarball responded with HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const tmpRoot = await mkdtemp(join(tmpdir(), "openbuddy-mkt-"));
  const tarPath = join(tmpRoot, "package.tgz");
  await writeFile(tarPath, buffer);
  // npm tarballs unpack to `package/`; strip that prefix so cp -r to the
  // plugin target root yields the expected layout.
  const extracted = join(tmpRoot, "package");
  await new Promise<void>((resolveExt, rejectExt) => {
    execImpl("tar", ["-xzf", tarPath, "-C", tmpRoot], (error) => {
      if (error) rejectExt(error); else resolveExt();
    });
  });
  return extracted;
}
