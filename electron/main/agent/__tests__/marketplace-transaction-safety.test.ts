import { lstat, mkdir, mkdtemp, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp/openbuddy-marketplace-transaction-test" }, safeStorage: { isEncryptionAvailable: () => false } }));
vi.mock("../casdoor/casdoor-auth", () => ({ casdoorAuth: { status: () => ({ config: { configured: false }, identity: null, tenantContext: { activeTenantId: undefined } }) } }));
const originalPiHome = process.env.PI_HOME;
const originalPiAgent = process.env.PI_CODING_AGENT_DIR;
afterEach(() => { if (originalPiHome === undefined) delete process.env.PI_HOME; else process.env.PI_HOME = originalPiHome; if (originalPiAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = originalPiAgent; });

async function setup(home: string, plugin = "demo") {
  process.env.PI_HOME = home; delete process.env.PI_CODING_AGENT_DIR;
  const source = await mkdtemp(join(tmpdir(), "openbuddy-marketplace-transaction-source-"));
  const pluginRoot = join(source, "plugins", plugin);
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: plugin, version: "1.0.0" }));
  const resources = await import("../pi-resources");
  await resources.marketplaceAddSource(source);
  return { resources, source, pluginRoot, targetRoot: join(home, ".pi", "agent", "plugins", plugin) };
}

describe("marketplace transaction safety", () => {
  it("restores the managed version after verification failure", async () => {
    const { resources, source, pluginRoot, targetRoot } = await setup(await mkdtemp(join(tmpdir(), "marketplace-home-")));
    await resources.marketplaceAction({ type: "install", sourceUrlOrPath: source, pluginRelativePath: "demo" });
    await writeFile(join(targetRoot, "version.txt"), "old-version"); await writeFile(join(pluginRoot, "package.json"), "not-json");
    await expect(resources.marketplaceAction({ type: "install", sourceUrlOrPath: source, pluginRelativePath: "demo" })).rejects.toThrow();
    await expect(readFile(join(home, ".pi", "agent", "marketplace-installed.json"), "utf8")).resolves.toContain("demo");
    await expect(readFile(join(targetRoot, "version.txt"), "utf8")).resolves.toBe("old-version");
    await expect(readFile(join(targetRoot, ".openbuddy-marketplace-managed.json"), "utf8")).resolves.toContain('"version": 1');
  });
  it("rejects symlink targets without touching linked data", async () => {
    const { resources, source, targetRoot } = await setup(await mkdtemp(join(tmpdir(), "marketplace-home-")), "linked");
    const outside = await mkdtemp(join(tmpdir(), "marketplace-user-data-")); await mkdir(join(targetRoot, ".."), { recursive: true }); await symlink(outside, targetRoot, "junction");
    await expect(resources.marketplaceAction({ type: "install", sourceUrlOrPath: source, pluginRelativePath: "linked" })).rejects.toThrow(/symlink/i);
    await expect(readlink(targetRoot)).resolves.toBe(outside); await expect(lstat(join(outside, ".openbuddy-marketplace-managed.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects traversal without target residue", async () => {
    const { resources, source } = await setup(await mkdtemp(join(tmpdir(), "marketplace-home-")));
    await expect(resources.marketplaceAction({ type: "install", sourceUrlOrPath: source, pluginRelativePath: "../outside" })).rejects.toThrow();
  });
  it("refuses unmanaged uninstall", async () => {
    const { resources, source, targetRoot } = await setup(await mkdtemp(join(tmpdir(), "marketplace-home-")), "unmanaged");
    await resources.marketplaceAction({ type: "install", sourceUrlOrPath: source, pluginRelativePath: "unmanaged" });
    await (await import("node:fs/promises")).rm(join(targetRoot, ".openbuddy-marketplace-managed.json"));
    await expect(resources.marketplaceAction({ type: "uninstall", sourceUrlOrPath: source, pluginRelativePath: "unmanaged" })).rejects.toThrow(/managed/i);
    await expect(lstat(targetRoot)).resolves.toBeDefined();
    await expect(readFile(join(home, ".pi", "agent", "marketplace-installed.json"), "utf8")).resolves.toContain("unmanaged");
  });
});
