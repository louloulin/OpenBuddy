import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalCatalog, createPlatformSecretStore, CredentialStore, EphemeralSecretStore, McpAuthStore, McpRegistry, openStorage, RendererStorageGateway, TaskCatalog, type SecretStore } from "../index";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("capability catalogs", () => {
  it("selects ephemeral only for tests and fails closed off macOS", () => {
    expect(createPlatformSecretStore({ platform: "linux", environment: { NODE_ENV: "test" } }).constructor.name).toBe("EphemeralSecretStore");
    expect(createPlatformSecretStore({ platform: "linux", environment: { NODE_ENV: "production" } }).constructor.name).toBe("UnsupportedSecretStore");
    expect(createPlatformSecretStore({ platform: "darwin", environment: { NODE_ENV: "production" } }).constructor.name).toBe("PlatformKeychainSecretStore");
  });
  it("persists task snapshots in SQLite", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-task-catalog-"));
    roots.push(root);
    const catalog = new TaskCatalog({ databasePath: join(root, "openbuddy.sqlite") });
    await catalog.replace("session-1", [{ id: "task-1", content: "write", status: "pending", createdAt: "2026-01-01", updatedAt: "2026-01-01", order: 0 }]);
    expect(await catalog.list("session-1")).toMatchObject([{ id: "task-1", content: "write", status: "pending" }]);
    await catalog.close();
  });

  it("keeps an explicitly empty task snapshot authoritative", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-empty-task-catalog-"));
    roots.push(root);
    const catalog = new TaskCatalog({ databasePath: join(root, "openbuddy.sqlite") });
    await catalog.replace("session-1", []);
    expect(await catalog.list("session-1")).toEqual([]);
    expect(await catalog.hasSnapshot("session-1")).toBe(true);
    await catalog.close();
  });

  it("stores approval decisions as a rebuildable projection", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-approval-catalog-"));
    roots.push(root);
    const catalog = new ApprovalCatalog({ databasePath: join(root, "openbuddy.sqlite") });
    catalog.upsert({ id: "approval-1", taskId: "task-1", requesterId: "agent-1", actions: ["send"], reason: "requested", createdAt: "2026-01-01", status: "pending" });
    catalog.upsert({ id: "approval-1", taskId: "task-1", requesterId: "agent-1", actions: ["send"], reason: "requested", createdAt: "2026-01-01", status: "approved", decidedBy: "owner", decidedAt: "2026-01-02" });
    expect(catalog.list()).toMatchObject([{ id: "approval-1", status: "approved", decidedBy: "owner" }]);
    catalog.close();
  });

  it("stores MCP metadata without secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-mcp-registry-"));
    roots.push(root);
    const registry = new McpRegistry(join(root, "openbuddy.sqlite"));
    await registry.upsert({
      name: "remote",
      source: "project",
      sourcePath: join(root, ".pi", "mcp.json"),
      transport: "streamable_http",
      target: "https://example.test/mcp?access_token=secret&region=local",
      enabled: true,
      configJson: { url: "https://example.test/mcp", headers: { Authorization: "Bearer secret", XTrace: "safe" }, apiKey: "hidden" },
      updatedAt: "2026-01-01",
    });
    expect(await registry.list()).toMatchObject([{ name: "remote", source: "project", enabled: true, configJson: { headers: { XTrace: "safe" } } }]);
    const listed = await registry.list();
    expect(JSON.stringify(listed)).not.toContain("secret");
    expect(listed[0]?.target).toBe("https://example.test/mcp?region=local");
    await registry.remove("remote");
    await expect(registry.list()).resolves.toEqual([]);
    await registry.close();
  });

  it("keeps same-name MCP records isolated by source path", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-mcp-scope-"));
    roots.push(root);
    const registry = new McpRegistry(join(root, "openbuddy.sqlite"));
    const base = { name: "shared", transport: "stdio", target: "node", enabled: true, configJson: {}, updatedAt: "2026-01-01" } as const;
    await registry.upsert({ ...base, source: "project", sourcePath: join(root, "a", "mcp.json") });
    await registry.upsert({ ...base, source: "project", sourcePath: join(root, "b", "mcp.json") });
    await registry.remove("shared", join(root, "a", "mcp.json"));
    await expect(registry.list()).resolves.toMatchObject([{ name: "shared", sourcePath: join(root, "b", "mcp.json") }]);
    await registry.close();
  });

  it("stores credential values in the secret provider and only refs in SQLite", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-credential-store-"));
    roots.push(root);
    const values = new Map<string, string>();
    const secretStore: SecretStore = {
      put: async (ref, value) => { values.set(ref, value); return { ref, provider: "test" }; },
      get: async (ref) => values.get(ref),
      delete: async (ref) => { values.delete(ref); },
    };
    const store = new CredentialStore({ databasePath: join(root, "openbuddy.sqlite"), secretStore });
    await store.setRef("OPENBUDDY_TEST_KEY", "secret-value");
    expect(await store.resolve("OPENBUDDY_TEST_KEY")).toBe("secret-value");
    expect([...values.values()]).toEqual(["secret-value"]);
    await store.close();
    const database = await openStorage({ filePath: join(root, "openbuddy.sqlite") });
    expect(database.driver.database.prepare("SELECT secret_ref FROM secret_refs WHERE secret_ref LIKE 'credential:ref:%'").all()).toEqual([{ secret_ref: "credential:ref:OPENBUDDY_TEST_KEY" }]);
    expect(JSON.stringify(database.driver.database.prepare("SELECT * FROM secret_refs").all())).not.toContain("secret-value");
    database.driver.close();
  });

  it("keeps a failed legacy credential migration retryable", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-credential-migration-"));
    roots.push(root);
    const legacyPath = join(root, "dsh-credentials.json");
    const legacyDocument = { refs: { OPENBUDDY_TEST_KEY: "secret-value" }, records: { account: { kind: "grant", payload: { id: "account-1" } } } };
    await writeFile(legacyPath, `${JSON.stringify(legacyDocument)}\n`);
    const values = new Map<string, string>();
    let writes = 0;
    const secretStore: SecretStore = {
      put: async (ref, value) => {
        writes += 1;
        if (writes === 2) throw new Error("secret provider unavailable");
        values.set(ref, value);
        return { ref, provider: "test" };
      },
      get: async (ref) => values.get(ref),
      delete: async (ref) => { values.delete(ref); },
    };
    const databasePath = join(root, "openbuddy.sqlite");
    const store = new CredentialStore({ databasePath, legacyPath, secretStore });
    await expect(store.importLegacy()).rejects.toThrow("secret provider unavailable");
    expect(JSON.parse(await readFile(legacyPath, "utf8"))).toEqual(legacyDocument);
    await store.close();

    const retryStore = new CredentialStore({ databasePath, legacyPath, secretStore });
    await expect(retryStore.importLegacy()).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(legacyPath, "utf8"))).toEqual({ refs: {}, records: {} });
    expect(await retryStore.resolve("OPENBUDDY_TEST_KEY")).toBe("secret-value");
    await retryStore.close();
  });

  it("fails closed for malformed credential legacy documents", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-invalid-credential-migration-"));
    roots.push(root);
    const legacyPath = join(root, "dsh-credentials.json");
    await writeFile(legacyPath, JSON.stringify({ refs: "not-an-object", records: {} }));
    const store = new CredentialStore({
      databasePath: join(root, "openbuddy.sqlite"),
      legacyPath,
      secretStore: { put: async (ref) => ({ ref, provider: "test" }), get: async () => undefined, delete: async () => undefined },
    });
    await expect(store.importLegacy()).rejects.toThrow("credential legacy source failed");
    expect(JSON.parse(await readFile(legacyPath, "utf8"))).toMatchObject({ refs: "not-an-object" });
    await store.close();
  });

  it("serializes concurrent legacy credential imports", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-concurrent-credential-migration-"));
    roots.push(root);
    const legacyPath = join(root, "dsh-credentials.json");
    await writeFile(legacyPath, JSON.stringify({ refs: { CONCURRENT_KEY: "secret-value" }, records: {} }));
    let puts = 0;
    const values = new Map<string, string>();
    const secretStore: SecretStore = {
      put: async (ref, value) => { puts += 1; await new Promise((resolve) => setTimeout(resolve, 5)); values.set(ref, value); return { ref, provider: "test" }; },
      get: async (ref) => values.get(ref),
      delete: async (ref) => { values.delete(ref); },
    };
    const store = new CredentialStore({ databasePath: join(root, "openbuddy.sqlite"), legacyPath, secretStore });
    await Promise.all([store.importLegacy(), store.importLegacy(), store.resolve("CONCURRENT_KEY")]);
    expect(puts).toBe(1);
    await store.close();
  });

  it("validates and persists renderer settings through a versioned gateway", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-renderer-storage-"));
    roots.push(root);
    const gateway = new RendererStorageGateway(join(root, "openbuddy.sqlite"), () => "2026-01-01T00:00:00.000Z");
    await expect(gateway.write("renderer.projects", "snapshot", [{ id: "p1" }], 2)).resolves.toMatchObject({ namespace: "renderer.projects", key: "snapshot", version: 2 });
    await expect(gateway.read("renderer.projects", "snapshot")).resolves.toMatchObject({ value: [{ id: "p1" }], version: 2 });
    await expect(gateway.write("renderer.projects", "apiKey", "secret")).rejects.toThrow("invalid renderer storage key");
    await expect(gateway.write("renderer.projects", "snapshot", [{ id: "p1", config: { token: "secret" } }])).rejects.toThrow("secret field");
    await gateway.close();
  });

  it("prevents stale renderer writes and exposes namespace lifecycle operations", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-renderer-versioned-storage-"));
    roots.push(root);
    const databasePath = join(root, "openbuddy.sqlite");
    const first = new RendererStorageGateway(databasePath, () => "2026-01-01T00:00:00.000Z");
    const second = new RendererStorageGateway(databasePath, () => "2026-01-01T00:00:01.000Z");
    await expect(first.writeVersioned("renderer.projects", "snapshot", { id: "p1" }, 1, 0)).resolves.toMatchObject({ version: 1 });
    await expect(second.writeVersioned("renderer.projects", "snapshot", { id: "p2" }, 2, 1)).resolves.toMatchObject({ version: 2 });
    await expect(first.writeVersioned("renderer.projects", "snapshot", { id: "stale" }, 2, 1)).rejects.toMatchObject({ code: "renderer-storage-version-conflict", currentVersion: 2 });
    await expect(first.list("renderer.projects")).resolves.toMatchObject([{ key: "snapshot", value: { id: "p2" }, version: 2 }]);
    await expect(first.remove("renderer.projects", "snapshot")).resolves.toBe(true);
    await expect(first.remove("renderer.projects", "snapshot")).resolves.toBe(false);
    await first.close();
    await second.close();
  });

  it("closes unused credential and renderer stores without opening SQLite", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-unused-storage-"));
    roots.push(root);
    const databasePath = join(root, "openbuddy.sqlite");
    const secretStore: SecretStore = {
      put: async () => ({ ref: "unused", provider: "test" }),
      get: async () => undefined,
      delete: async () => undefined,
    };
    const credentials = new CredentialStore({ databasePath, secretStore });
    const renderer = new RendererStorageGateway(databasePath);
    await credentials.close();
    await renderer.close();
    await expect(import("node:fs/promises").then(({ access }) => access(databasePath))).rejects.toThrow();
  });

  it("stores MCP OAuth status in SQLite and credentials only in SecretStore", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-mcp-auth-"));
    roots.push(root);
    const legacyPath = join(root, "mcp-auth.json");
    await writeFile(legacyPath, JSON.stringify({ local: { status: "authenticated", updatedAt: "2026-01-01T00:00:00.000Z", accessToken: "access-secret", refreshToken: "refresh-secret" } }));
    const secrets = new EphemeralSecretStore();
    const store = new McpAuthStore({ databasePath: join(root, "openbuddy.sqlite"), legacyPath, secretStore: secrets });
    await expect(store.getCredential("local")).resolves.toMatchObject({ accessToken: "access-secret", refreshToken: "refresh-secret" });
    expect(JSON.parse(await readFile(legacyPath, "utf8"))).toEqual({ local: { status: "authenticated", updatedAt: "2026-01-01T00:00:00.000Z" } });
    expect(await secrets.get("credential:ref:mcp-oauth:local")).toContain("access-secret");
    const database = await openStorage({ filePath: join(root, "openbuddy.sqlite") });
    const rows = database.driver.database.prepare("SELECT value_json FROM settings WHERE namespace = 'mcp-auth' AND setting_key = 'state'").all() as Array<{ value_json: string }>;
    expect(JSON.stringify(rows)).not.toContain("access-secret");
    await database.driver.close();
    await store.close();
  });

  it("keeps MCP OAuth legacy input pending when SecretStore migration fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-mcp-auth-retry-"));
    roots.push(root);
    const legacyPath = join(root, "mcp-auth.json");
    const legacy = { local: { status: "authenticated", updatedAt: "2026-01-01T00:00:00.000Z", accessToken: "access-secret" } };
    await writeFile(legacyPath, JSON.stringify(legacy));
    let fail = true;
    const values = new Map<string, string>();
    const secrets: SecretStore = {
      async put(ref, value) { if (fail) throw new Error("keychain unavailable"); values.set(ref, value); return { ref, provider: "test" }; },
      async get(ref) { return values.get(ref); },
      async delete(ref) { values.delete(ref); },
    };
    const databasePath = join(root, "openbuddy.sqlite");
    const store = new McpAuthStore({ databasePath, legacyPath, secretStore: secrets });
    await expect(store.getCredential("local")).rejects.toThrow("keychain unavailable");
    expect(JSON.parse(await readFile(legacyPath, "utf8"))).toEqual(legacy);
    const failed = await openStorage({ filePath: databasePath });
    expect(failed.driver.database.prepare("SELECT value_json FROM settings WHERE namespace = 'mcp-auth' AND setting_key = 'legacy-import'").get()).toMatchObject({ value_json: expect.stringContaining('"failed"') });
    await failed.driver.close();
    fail = false;
    await expect(store.getCredential("local")).resolves.toMatchObject({ accessToken: "access-secret" });
    expect(JSON.parse(await readFile(legacyPath, "utf8"))).toEqual({ local: { status: "authenticated", updatedAt: "2026-01-01T00:00:00.000Z" } });
    await store.close();
  });

  it("fails closed when MCP OAuth state in SQLite is malformed", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-mcp-auth-corrupt-state-"));
    roots.push(root);
    const databasePath = join(root, "openbuddy.sqlite");
    const database = await openStorage({ filePath: databasePath });
    database.driver.database.prepare("INSERT INTO settings(namespace, setting_key, value_json, version, updated_at) VALUES (?, ?, ?, ?, ?)").run("mcp-auth", "state", "not-json", 1, "2026-01-01");
    await database.driver.close();
    const store = new McpAuthStore({ databasePath, secretStore: new EphemeralSecretStore() });
    await expect(store.listStates()).rejects.toThrow();
    await store.close();
  });

});
