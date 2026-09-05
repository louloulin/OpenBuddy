/**
 * P2-13: MCP server configuration + auth sub-module.
 *
 * Owns the mcp.json read/write surface (global + project) and the auth
 * credential store. The plugin-marketplace registry scan lives in
 * `marketplace.ts`; we only import `listMarketplaceMcpServers` here because
 * `mcpConfigRead` merges marketplace-contributed servers into the user's
 * config view.
 *
 * Note: `casdoorAuth` from `../casdoor/casdoor-auth` was imported by the
 * original monolithic file but never referenced anywhere in it — the split
 * drops that dead import.
 */
import { join } from "node:path";
import {
  agentRoot,
  mcpAuthStore,
  mcpRegistry,
  readJson,
  safeName,
  workspaceRoot,
  writeJson,
} from "./shared";

// Type-only re-exports — TypeScript erases these at compile time, so they
// don't add any runtime dep on the marketplace module.
export type { PluginRecord, MarketplaceMcpServer } from "./marketplace";

/**
 * P2-13 stage 2: lazily resolve `listMarketplaceMcpServers` so mcp.ts has
 * zero static runtime dependency on the heavy marketplace module. Each call
 * awaits the import — V8's module cache makes the second-and-onwards
 * cost ~0 µs.
 */
async function getMarketplaceMcpServers(cwd?: string | null) {
  const { listMarketplaceMcpServers } = await import("./marketplace");
  return listMarketplaceMcpServers(cwd);
}

function projectMcpPath(cwd?: string | null): string { return join(workspaceRoot(cwd), ".pi", "mcp.json"); }

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export type McpConfig = { mcpServers?: Record<string, Record<string, unknown>> } & Record<string, unknown>;

export async function mcpConfigPath(): Promise<string> { return join(agentRoot(), "mcp.json"); }

export async function mcpConfigRead(cwd?: string | null): Promise<McpConfig> {
  const global = await readJson<McpConfig>(await mcpConfigPath(), { mcpServers: {} });
  const marketplace = await getMarketplaceMcpServers(cwd);
  const project = await readJson<McpConfig>(projectMcpPath(cwd), { mcpServers: {} });
  const mcpServers: Record<string, Record<string, unknown>> = { ...(global.mcpServers ?? {}) };
  for (const entry of marketplace) {
    if (!mcpServers[entry.name]) mcpServers[entry.name] = entry.config;
  }
  Object.assign(mcpServers, project.mcpServers ?? {});
  return { ...global, ...project, mcpServers };
}

export async function mcpConfigSave(content: string, cwd?: string | null): Promise<void> {
  const parsed = JSON.parse(content) as McpConfig;
  if (!parsed || typeof parsed !== "object" || (parsed.mcpServers !== undefined && typeof parsed.mcpServers !== "object")) throw new Error("invalid mcp.json");
  // `mcpConfigRead` returns a global+project view, but the standalone editor
  // owns the global file. Never write the merged project view back to global.
  const nextServers = { ...(parsed.mcpServers ?? {}) };
  const global = await readJson<McpConfig>(await mcpConfigPath(), { mcpServers: {} });
  for (const entry of await getMarketplaceMcpServers(cwd)) {
    if (!global.mcpServers?.[entry.name] && canonicalJson(nextServers[entry.name]) === canonicalJson(entry.config)) delete nextServers[entry.name];
  }
  await writeJson(await mcpConfigPath(), { ...parsed, mcpServers: nextServers });
  await syncMcpRegistrySnapshot(cwd);
}

async function mcpWritePath(name: string, cwd?: string | null): Promise<string> {
  const projectPath = projectMcpPath(cwd);
  const project = await readJson<McpConfig>(projectPath, { mcpServers: {} });
  return project.mcpServers?.[name] ? projectPath : await mcpConfigPath();
}

async function syncMcpRegistry(name: string, cwd?: string | null): Promise<void> {
  const safe = safeName(name);
  const config = await mcpConfigRead(cwd);
  const server = config.mcpServers?.[safe];
  const registry = await mcpRegistry();
  if (!server) {
    const project = await readJson<McpConfig>(projectMcpPath(cwd), { mcpServers: {} });
    const global = await readJson<McpConfig>(await mcpConfigPath(), { mcpServers: {} });
    const sourcePath = project.mcpServers?.[safe] ? projectMcpPath(cwd) : global.mcpServers?.[safe] ? await mcpConfigPath() : undefined;
    await registry.remove(safe, sourcePath);
    return;
  }
  const project = await readJson<McpConfig>(projectMcpPath(cwd), { mcpServers: {} });
  const global = await readJson<McpConfig>(await mcpConfigPath(), { mcpServers: {} });
  const marketplace = (await getMarketplaceMcpServers(cwd)).find((entry) => entry.name === safe);
  const source = project.mcpServers?.[safe] ? "project" : global.mcpServers?.[safe] ? "user" : marketplace ? `marketplace:${marketplace.plugin.name}` : "user";
  const sourcePath = project.mcpServers?.[safe] ? projectMcpPath(cwd) : global.mcpServers?.[safe] ? await mcpConfigPath() : marketplace?.plugin.root;
  await registry.upsert({
    name: safe,
    source,
    ...(sourcePath ? { sourcePath } : {}),
    transport: typeof server.url === "string" ? "streamable_http" : "stdio",
    target: typeof server.url === "string" ? server.url : typeof server.command === "string" ? server.command : "",
    enabled: server.disabled !== true,
    configJson: server,
    updatedAt: new Date().toISOString(),
  });
}

async function syncMcpRegistrySnapshot(cwd?: string | null): Promise<void> {
  const registry = await mcpRegistry();
  const globalPath = await mcpConfigPath();
  const projectPath = projectMcpPath(cwd);
  const global = await readJson<McpConfig>(globalPath, { mcpServers: {} });
  const project = await readJson<McpConfig>(projectPath, { mcpServers: {} });
  for (const [name, server] of Object.entries(global.mcpServers ?? {})) {
    await registry.upsert({ name, source: "user", sourcePath: globalPath, transport: typeof server.url === "string" ? "streamable_http" : "stdio", target: typeof server.url === "string" ? server.url : typeof server.command === "string" ? server.command : "", enabled: server.disabled !== true, configJson: server, updatedAt: new Date().toISOString() });
  }
  for (const [name, server] of Object.entries(project.mcpServers ?? {})) {
    await registry.upsert({ name, source: "project", sourcePath: projectPath, transport: typeof server.url === "string" ? "streamable_http" : "stdio", target: typeof server.url === "string" ? server.url : typeof server.command === "string" ? server.command : "", enabled: server.disabled !== true, configJson: server, updatedAt: new Date().toISOString() });
  }
  for (const record of await registry.list()) {
    if (record.sourcePath !== globalPath && record.sourcePath !== projectPath) continue;
    const expected = record.sourcePath === projectPath ? project.mcpServers?.[record.name] : global.mcpServers?.[record.name];
    if (!expected) await registry.remove(record.name, record.sourcePath);
  }
}

export async function mcpList(cwd?: string | null): Promise<Array<Record<string, unknown>>> {
  const config = await mcpConfigRead(cwd);
  const globalConfig = await readJson<McpConfig>(await mcpConfigPath(), { mcpServers: {} });
  const projectConfig = await readJson<McpConfig>(projectMcpPath(cwd), { mcpServers: {} });
  const marketplace = new Map((await getMarketplaceMcpServers(cwd)).map((entry) => [entry.name, entry]));
  return Object.entries(config.mcpServers ?? {}).map(([name, value]) => ({
    name,
    transport: value.url ? "streamable_http" : "stdio",
    target: value.url ?? value.command ?? "",
    enabled: value.disabled !== true,
    source: projectConfig.mcpServers?.[name]
      ? "project"
      : globalConfig.mcpServers?.[name]
        ? "user"
        : marketplace.get(name)
          ? `marketplace:${marketplace.get(name)!.plugin.name}`
          : "user",
    ...value,
  }));
}

export async function mcpUpsert(name: string, server: Record<string, unknown>, cwd?: string | null): Promise<void> {
  const file = await mcpWritePath(safeName(name), cwd);
  const config = await readJson<McpConfig>(file, { mcpServers: {} });
  config.mcpServers ??= {};
  config.mcpServers[safeName(name)] = { ...server, ...(server.enabled === false ? { disabled: true } : {}) };
  await writeJson(file, config);
  await syncMcpRegistry(name, cwd);
}

export async function mcpDelete(name: string, cwd?: string | null): Promise<void> {
  const safe = safeName(name);
  const file = await mcpWritePath(safe, cwd);
  const config = await readJson<McpConfig>(file, { mcpServers: {} });
  delete config.mcpServers?.[safe];
  await writeJson(file, config);
  await syncMcpRegistrySnapshot(cwd);
}

export async function mcpToggle(name: string, enabled: boolean, cwd?: string | null): Promise<void> {
  const safe = safeName(name);
  const file = await mcpWritePath(safe, cwd);
  const config = await readJson<McpConfig>(file, { mcpServers: {} });
  const value = config.mcpServers?.[safe];
  if (!value) throw new Error(`MCP server not found: ${name}`);
  value.disabled = !enabled;
  await writeJson(file, config);
  await syncMcpRegistry(safe, cwd);
}

type McpAuthState = Record<string, { status: "pending" | "authenticated" | "failed"; error?: string; updatedAt: string }>;

async function mcpAuthStateRead(): Promise<McpAuthState> { return (await mcpAuthStore()).listStates(); }

export async function mcpAuthCredential(serverName: string, cwd?: string | null): Promise<{ accessToken: string; refreshToken?: string; tokenType?: string; expiresAt?: string } | undefined> {
  const state = await mcpAuthStateRead();
  const current = state[safeName(serverName)];
  const credential = await (await mcpAuthStore()).getCredential(safeName(serverName));
  if (current?.status === "authenticated" && credential && (!credential.expiresAt || !Number.isFinite(Date.parse(credential.expiresAt)) || Date.parse(credential.expiresAt) > Date.now())) {
    return credential;
  }
  const config = await mcpConfigRead(cwd);
  const server = config.mcpServers?.[safeName(serverName)] ?? {};
  const direct = Object.entries(server).find(([key, value]) => /^(access[_-]?token|token|api[_-]?key)$/i.test(key) && typeof value === "string" && value.trim());
  const headers = server.headers && typeof server.headers === "object" ? server.headers as Record<string, unknown> : {};
  const header = Object.entries(headers).find(([key, value]) => /^(authorization|x-api-key|api-key)$/i.test(key) && typeof value === "string" && value.trim());
  const raw = direct?.[1] ?? header?.[1];
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const bearer = raw.match(/^([A-Za-z][A-Za-z0-9_-]*)\s+(.+)$/);
  return { accessToken: bearer?.[2] ?? raw, ...(bearer?.[1] ? { tokenType: bearer[1] } : {}) };
}

export async function mcpAuthStatus(cwd?: string | null): Promise<Array<{ serverName: string; status: string; error?: string }>> {
  const config = await mcpConfigRead(cwd);
  const state = await mcpAuthStateRead();
  return Object.entries(config.mcpServers ?? {}).flatMap(([serverName, server]) => {
    const current = state[serverName];
    if (current?.status === "authenticated") return [];
    const needsAuth = server.needs_auth === true || server.authRequired === true || current?.status === "pending" || current?.status === "failed";
    return needsAuth ? [{ serverName, status: current?.status ?? "needs_auth", ...(current?.error ? { error: current.error } : {}) }] : [];
  });
}

export async function mcpAuthMark(serverName: string, status: "pending" | "authenticated" | "failed", error?: string): Promise<void> {
  await (await mcpAuthStore()).mark(safeName(serverName), status, error);
}

export async function mcpAuthStoreCredential(serverName: string, credential: { accessToken: string; refreshToken?: string; tokenType?: string; expiresIn?: number }): Promise<void> {
  await (await mcpAuthStore()).setCredential(safeName(serverName), {
    accessToken: credential.accessToken,
    ...(credential.refreshToken ? { refreshToken: credential.refreshToken } : {}),
    ...(credential.tokenType ? { tokenType: credential.tokenType } : {}),
    ...(typeof credential.expiresIn === "number" ? { expiresAt: new Date(Date.now() + credential.expiresIn * 1000).toISOString() } : {}),
  });
}
