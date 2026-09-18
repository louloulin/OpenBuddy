// @vitest-environment node
/**
 * pi-market-bridge.test.ts — node 进程测试。
 *
 * 本模块刻意不 import electron / 不触网:registry 来源、载荷物化、时钟全部
 * 可注入,所以这里只用真实临时目录 + 注入 stub 覆盖安装树的原子性、
 * lockfile / 指针一致性、审计留痕与 IPC 注册。
 */
import { mkdir, mkdtemp, lstat, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PI_MARKET_IPC_CHANNELS,
  PiMarketBridgeError,
  comparePiSemver,
  createPiMarketBridge,
  createPiMarketHandlers,
  hashPayloadDirectory,
  hasHighRiskCapability,
  isPiExtensionScheme,
  mapPiExtensionToOpenBuddyManifest,
  parsePiSemver,
  registerPiMarketBridgeIpc,
  safePiExtensionId,
  satisfiesPiRange,
  type PiMarketIpcLike,
  type PiMarketRegistryEntry,
} from "./pi-market-bridge";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeDataDir(prefix = "openbuddy-pi-market-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function extension(partial: Partial<PiMarketRegistryEntry> = {}): PiMarketRegistryEntry {
  return {
    id: "demo",
    name: "Demo Extension",
    publisher: "openbuddy",
    description: "演示扩展",
    version: "1.0.0",
    versions: ["1.0.0"],
    kinds: ["extension"],
    files: { "index.js": 'export const name = "demo";\n' },
    ...partial,
  };
}

async function writeRegistry(dataDir: string, entries: unknown[]): Promise<void> {
  const file = join(dataDir, "pi-extensions", "registry.json");
  await mkdir(join(dataDir, "pi-extensions"), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({ version: 1, extensions: entries }, null, 2)}\n`,
    "utf8",
  );
}

async function existsPath(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => undefined)) !== undefined;
}

async function readdirString(path: string): Promise<string[]> {
  return readdir(path).catch(() => [] as string[]);
}

function bridgeFor(
  dataDir: string,
  extra: Parameters<typeof createPiMarketBridge>[0] extends infer _T
    ? Partial<Parameters<typeof createPiMarketBridge>[0]>
    : never = {},
) {
  return createPiMarketBridge({ dataDir, hostVersion: "0.15.0", ...extra });
}

// ---------------------------------------------------------------------------

describe("path / id safety", () => {
  it("accepts plain ids and rejects traversal", () => {
    expect(safePiExtensionId(" demo ")).toBe("demo");
    expect(safePiExtensionId("pi.fs-tools_2")).toBe("pi.fs-tools_2");
    for (const bad of ["", "..", "../evil", "a/b", "a\\b", ".hidden", undefined, 42]) {
      expect(() => safePiExtensionId(bad as never)).toThrow(PiMarketBridgeError);
    }
  });

  it("detects the pi-extension scheme", () => {
    expect(isPiExtensionScheme("pi-extension:demo")).toBe(true);
    expect(isPiExtensionScheme("./demo/index.js")).toBe(false);
  });
});

describe("semver subset", () => {
  it("parses and compares versions", () => {
    expect(parsePiSemver("v1.2")).toMatchObject({ major: 1, minor: 2, patch: 0 });
    expect(comparePiSemver("1.0.0", "1.0.1")).toBe(-1);
    expect(comparePiSemver("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(comparePiSemver("nope", "1.0.0")).toBeNull();
  });

  it("matches ranges", () => {
    expect(satisfiesPiRange("0.15.0", undefined)).toBe(true);
    expect(satisfiesPiRange("0.15.0", "*")).toBe(true);
    expect(satisfiesPiRange("1.4.2", "^1.2.0")).toBe(true);
    expect(satisfiesPiRange("2.0.0", "^1.2.0")).toBe(false);
    expect(satisfiesPiRange("0.15.3", "^0.15.0")).toBe(true);
    expect(satisfiesPiRange("0.16.0", "^0.15.0")).toBe(false);
    expect(satisfiesPiRange("0.15.3", "~0.15.0")).toBe(true);
    expect(satisfiesPiRange("0.16.0", "~0.15.1")).toBe(false);
    expect(satisfiesPiRange("0.15.3", ">=0.14.0 <0.16.0")).toBe(true);
    expect(satisfiesPiRange("0.16.1", ">=0.14.0 <0.16.0")).toBe(false);
    expect(satisfiesPiRange("0.13.0", ">=0.14.0 || 0.13.0")).toBe(true);
    expect(satisfiesPiRange(undefined, ">=1.0.0")).toBe(false);
  });
});

describe("manifest mapping", () => {
  it("synthesizes a pi track using the pi-extension scheme", () => {
    const manifest = mapPiExtensionToOpenBuddyManifest(extension());
    expect(manifest.schema).toBe("openbuddy.plugin.v1");
    expect(manifest.id).toBe("demo");
    expect(manifest.tracks).toEqual([{ kind: "pi", source: "pi-extension:demo" }]);
  });

  it("honours explicit tracks, inline factories and version overrides", () => {
    const explicit = mapPiExtensionToOpenBuddyManifest(
      extension({ tracks: [{ kind: "cordis", source: "./cordis.js" }] }),
      "2.0.0",
    );
    expect(explicit.tracks).toEqual([{ kind: "cordis", source: "./cordis.js" }]);
    expect(explicit.version).toBe("2.0.0");
    const inline = mapPiExtensionToOpenBuddyManifest(
      extension({ id: "inline-demo", inline: "builtin-demo" }),
    );
    expect(inline.tracks).toEqual([{ kind: "pi", inline: "builtin-demo" }]);
  });

  it("reuses the host validator and reports invalid descriptors", () => {
    expect(() =>
      mapPiExtensionToOpenBuddyManifest(extension({ tracks: [] as never })),
    ).not.toThrow();
    expect(() =>
      mapPiExtensionToOpenBuddyManifest(extension({ tracks: [{ kind: "pi" } as never] })),
    ).toThrow(PiMarketBridgeError);
    try {
      mapPiExtensionToOpenBuddyManifest(extension({ tracks: [{ kind: "nope" } as never] }));
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as PiMarketBridgeError).code).toBe("invalid-descriptor");
      expect((error as Error).message).toContain("openbuddy-plugin-manifest");
    }
  });
});

describe("readRegistry / listMarketEntries", () => {
  it("returns an empty view when nothing is configured", async () => {
    const dataDir = await makeDataDir();
    const bridge = bridgeFor(dataDir);
    expect(await bridge.readRegistry()).toEqual({ entries: [], source: "empty" });
    expect(await bridge.listMarketEntries()).toEqual([]);
    expect(bridge.paths.root).toBe(join(dataDir, "pi-extensions"));
  });

  it("normalizes entries with defaults and merged install state", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [
      extension(),
      { id: "bare" },
      extension({
        id: "engine",
        engines: { openbuddy: ">=9.0.0" },
        version: undefined,
        versions: ["1.0.0", "1.2.0"],
      }),
    ]);
    const bridge = bridgeFor(dataDir);
    const entries = await bridge.listMarketEntries();
    expect(entries.map((entry) => entry.id)).toEqual(["demo", "bare", "engine"]);

    const bare = entries.find((entry) => entry.id === "bare")!;
    expect(bare).toMatchObject({
      name: "bare",
      publisher: "unknown",
      description: "",
      version: "0.0.0",
      kinds: ["extension"],
    });
    const engine = entries.find((entry) => entry.id === "engine")!;
    expect(engine.version).toBe("1.2.0");
    expect(engine.incompatible).toBe(true);
    expect(engine.installedVersion).toBeUndefined();
  });

  it("marks update-available once a newer version is installed", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension({ versions: ["1.0.0", "1.1.0"], version: "1.1.0" })]);
    const bridge = bridgeFor(dataDir);
    await bridge.installPiExtension("demo", "1.0.0");
    const [entry] = await bridge.listMarketEntries();
    expect(entry.installedVersion).toBe("1.0.0");
    expect(entry.updateAvailable).toBe(true);
    expect(entry.manifest.schema).toBe("openbuddy.plugin.v1");
  });

  it("skips rejected entries but keeps the rest of the page", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [
      extension(),
      extension({ id: "broken", tracks: [{ kind: "nope" } as never] }),
    ]);
    const bridge = bridgeFor(dataDir);
    expect((await bridge.listMarketEntries()).map((entry) => entry.id)).toEqual(["demo"]);
    const audit = await bridge.readAuditTrail();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "refresh",
      outcome: "failure",
      extensionId: "broken",
    });
  });

  it("falls back to the remote index without writing the local file", async () => {
    const dataDir = await makeDataDir();
    const fetchJson = vi.fn(async () => ({ extensions: [extension({ id: "remote-demo" })] }));
    const bridge = bridgeFor(dataDir, {
      registryUrl: "https://market.example/index.json",
      fetchJson,
    });
    expect((await bridge.listMarketEntries()).map((entry) => entry.id)).toEqual(["remote-demo"]);
    await expect(readFile(bridge.paths.registryFile, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("prefers the local index over the remote URL", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension({ id: "local-demo" })]);
    const fetchJson = vi.fn(async () => ({ extensions: [extension({ id: "remote-demo" })] }));
    const bridge = bridgeFor(dataDir, {
      registryUrl: "https://market.example/index.json",
      fetchJson,
    });
    expect((await bridge.listMarketEntries()).map((entry) => entry.id)).toEqual(["local-demo"]);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("reports remote fetch failures as invalid-registry", async () => {
    const dataDir = await makeDataDir();
    const bridge = bridgeFor(dataDir, {
      registryUrl: "https://market.example/index.json",
      fetchJson: async () => {
        throw new Error("offline");
      },
    });
    await expect(bridge.listMarketEntries()).rejects.toMatchObject({ code: "invalid-registry" });
  });

  it("getMarketEntry returns undefined for unknown ids", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const bridge = bridgeFor(dataDir);
    expect((await bridge.getMarketEntry("demo"))?.id).toBe("demo");
    expect(await bridge.getMarketEntry("nope")).toBeUndefined();
  });
});

describe("refreshRegistry", () => {
  it("writes the remote index atomically and audits the refresh", async () => {
    const dataDir = await makeDataDir();
    const fetchJson = vi.fn(async () => ({
      version: 1,
      extensions: [extension({ id: "remote-demo" })],
    }));
    const bridge = bridgeFor(dataDir, {
      registryUrl: "https://market.example/index.json",
      fetchJson,
    });
    const result = await bridge.refreshRegistry();
    expect(result).toMatchObject({ count: 1, source: "remote" });
    const written = JSON.parse(await readFile(bridge.paths.registryFile, "utf8"));
    expect(written.extensions[0].id).toBe("remote-demo");
    expect(await bridge.readAuditTrail()).toHaveLength(1);
    // 写完后本地索引优先,不再触网。
    expect((await bridge.listMarketEntries()).map((entry) => entry.id)).toEqual(["remote-demo"]);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("audits refresh failures and rethrows", async () => {
    const dataDir = await makeDataDir();
    const bridge = bridgeFor(dataDir, {
      registryUrl: "https://market.example/index.json",
      fetchJson: async () => {
        throw new Error("offline");
      },
    });
    await expect(bridge.refreshRegistry()).rejects.toMatchObject({ code: "invalid-registry" });
    const audit = await bridge.readAuditTrail();
    expect(audit[0]).toMatchObject({ action: "refresh", outcome: "failure" });
  });

  it("uses the local index when no remote URL is configured", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const bridge = bridgeFor(dataDir);
    expect(await bridge.refreshRegistry()).toMatchObject({ count: 1, source: "local" });
  });
});

describe("installPiExtension", () => {
  it("materializes the payload, pointer and lockfile atomically", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const bridge = bridgeFor(dataDir);
    const result = await bridge.installPiExtension("demo");
    expect(result).toMatchObject({ id: "demo", version: "1.0.0", changed: true });
    expect(result.path).toBe(join(dataDir, "pi-extensions", "demo", "1.0.0"));
    expect(await readFile(join(result.path, "index.js"), "utf8")).toContain("demo");
    expect(await readFile(join(result.path, "openbuddy.plugin.json"), "utf8")).toContain(
      "openbuddy.plugin.v1",
    );
    expect(await readFile(join(dataDir, "pi-extensions", "demo", "current"), "utf8")).toBe(
      "1.0.0\n",
    );

    const lockfile = await bridge.readLockfile();
    expect(lockfile.extensions.demo).toMatchObject({
      version: "1.0.0",
      history: [],
      capabilities: [],
    });
    expect(lockfile.extensions.demo.integrity).toHaveLength(64);
    expect(lockfile.extensions.demo.integrity).toBe(await hashPayloadDirectory(result.path));
    const audit = await bridge.readAuditTrail();
    expect(audit[0]).toMatchObject({
      action: "install",
      extensionId: "demo",
      version: "1.0.0",
      outcome: "success",
    });
  });

  it("leaves no staging directory behind", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const bridge = bridgeFor(dataDir);
    await bridge.installPiExtension("demo");
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(join(dataDir, "pi-extensions", "demo"));
    expect(entries.filter((name) => name.startsWith(".staging-"))).toEqual([]);
    expect(entries.sort()).toEqual(["1.0.0", "current"]);
  });

  it("is idempotent for an already installed version", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const bridge = bridgeFor(dataDir);
    await bridge.installPiExtension("demo");
    const second = await bridge.installPiExtension("demo");
    expect(second.changed).toBe(false);
    expect((await bridge.readLockfile()).extensions.demo.history).toEqual([]);
  });

  it("detects a modified payload and requires force", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const bridge = bridgeFor(dataDir);
    const first = await bridge.installPiExtension("demo");
    await writeFile(join(first.path, "index.js"), "tampered", "utf8");
    await expect(bridge.installPiExtension("demo")).rejects.toMatchObject({
      code: "corrupt-install",
    });
    const forced = await bridge.installPiExtension("demo", undefined, { force: true });
    expect(await readFile(join(forced.path, "index.js"), "utf8")).toContain("demo");
    expect(forced.changed).toBe(false);
  });

  it("refuses to write into a symlinked version directory", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const outside = await makeDataDir("openbuddy-pi-market-outside-");
    await mkdir(join(dataDir, "pi-extensions", "demo"), { recursive: true });
    await symlink(outside, join(dataDir, "pi-extensions", "demo", "1.0.0"), "dir");
    const bridge = bridgeFor(dataDir);
    await expect(bridge.installPiExtension("demo")).rejects.toMatchObject({
      code: "unsafe-target",
    });
  });

  it("rejects unknown ids, unknown versions and traversal", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const bridge = bridgeFor(dataDir);
    await expect(bridge.installPiExtension("nope")).rejects.toMatchObject({ code: "not-found" });
    await expect(bridge.installPiExtension("demo", "9.9.9")).rejects.toMatchObject({
      code: "version-not-found",
    });
    await expect(bridge.installPiExtension("../evil")).rejects.toMatchObject({
      code: "invalid-id",
    });
  });

  it("requires explicit consent for high-risk capabilities", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [
      extension({ capabilities: [{ id: "shell.exec", risk: "high" }] }),
    ]);
    const bridge = bridgeFor(dataDir);
    await expect(bridge.installPiExtension("demo")).rejects.toMatchObject({
      code: "consent-required",
    });
    const result = await bridge.installPiExtension("demo", undefined, { allowHighRisk: true });
    expect(result.capabilities).toEqual(["shell.exec"]);
    const audit = await bridge.readAuditTrail();
    expect(audit[0]).toMatchObject({ outcome: "failure" });
    expect(audit[1]).toMatchObject({ outcome: "success" });
  });

  it("rejects engine-incompatible installs", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension({ engines: { openbuddy: ">=9.0.0" } })]);
    const bridge = bridgeFor(dataDir);
    await expect(bridge.installPiExtension("demo")).rejects.toMatchObject({ code: "incompatible" });
  });

  it("fails cleanly when no payload source exists", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [{ id: "empty", version: "1.0.0", versions: ["1.0.0"] }]);
    const bridge = bridgeFor(dataDir);
    await expect(bridge.installPiExtension("empty")).rejects.toMatchObject({
      code: "payload-unavailable",
    });
    await expect(
      readFile(join(dataDir, "pi-extensions", "empty", "1.0.0"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect((await bridge.readLockfile()).extensions.empty).toBeUndefined();
  });

  it("cleans up a failed payload materialization", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [
      { id: "remote", version: "1.0.0", versions: ["1.0.0"], payloadUrl: "https://x/y.tgz" },
    ]);
    const bridge = bridgeFor(dataDir, {
      fetchPayload: async () => {
        throw new Error("download failed");
      },
    });
    await expect(bridge.installPiExtension("remote")).rejects.toMatchObject({
      code: "payload-rejected",
    });
    expect((await bridge.readLockfile()).extensions.remote).toBeUndefined();
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(join(dataDir, "pi-extensions", "remote"));
    expect(entries.filter((name) => name.startsWith(".staging-"))).toEqual([]);
    expect(entries).toEqual([]);
    const audit = await bridge.readAuditTrail();
    expect(audit[0]).toMatchObject({ action: "install", outcome: "failure" });
    expect(audit[0].reason).toContain("download failed");
  });

  it("installs from a local payloadPath directory", async () => {
    const dataDir = await makeDataDir();
    const sourceDir = await makeDataDir("openbuddy-pi-market-source-");
    await writeFile(join(sourceDir, "index.js"), "export default 1;\n", "utf8");
    await writeFile(
      join(sourceDir, "package.json"),
      JSON.stringify({ name: "demo", version: "1.0.0" }),
      "utf8",
    );
    await writeRegistry(dataDir, [
      extension({ id: "local", files: undefined, payloadPath: sourceDir }),
    ]);
    const bridge = bridgeFor(dataDir);
    const result = await bridge.installPiExtension("local");
    expect(await readFile(join(result.path, "package.json"), "utf8")).toContain("demo");
  });

  it("uses the injected fetchPayload for remote payloads", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [
      { id: "remote", version: "1.0.0", versions: ["1.0.0"], payloadUrl: "https://x/y.tgz" },
    ]);
    const fetchPayload = vi.fn(async (_entry, _version, destination: string) => {
      await writeFile(join(destination, "index.js"), "remote", "utf8");
    });
    const bridge = bridgeFor(dataDir, { fetchPayload });
    const result = await bridge.installPiExtension("remote");
    expect(fetchPayload).toHaveBeenCalledTimes(1);
    expect(fetchPayload.mock.calls[0][2]).toContain(".staging-");
    expect(await readFile(join(result.path, "index.js"), "utf8")).toBe("remote");
  });
});

describe("upgrade / rollback", () => {
  async function upgraded() {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension({ versions: ["1.0.0", "1.1.0"], version: "1.0.0" })]);
    const bridge = bridgeFor(dataDir);
    await bridge.installPiExtension("demo", "1.0.0");
    await writeRegistry(dataDir, [
      extension({
        versions: ["1.0.0", "1.1.0"],
        version: "1.1.0",
        files: { "index.js": "v1.1.0\n" },
      }),
    ]);
    return { dataDir, bridge };
  }

  it("upgrades to the newest offered version and records history", async () => {
    const { bridge, dataDir } = await upgraded();
    const result = await bridge.upgradePiExtension("demo");
    expect(result).toMatchObject({ version: "1.1.0", previousVersion: "1.0.0", changed: true });
    const lockfile = await bridge.readLockfile();
    expect(lockfile.extensions.demo.version).toBe("1.1.0");
    expect(lockfile.extensions.demo.history).toEqual(["1.0.0"]);
    expect(await readFile(join(dataDir, "pi-extensions", "demo", "current"), "utf8")).toBe(
      "1.1.0\n",
    );
    const audit = await bridge.readAuditTrail();
    expect(audit.at(-1)).toMatchObject({
      action: "upgrade",
      version: "1.1.0",
      from: "1.0.0",
      outcome: "success",
    });
  });

  it("is a no-op when the installed version is already newest", async () => {
    const { bridge } = await upgraded();
    await bridge.upgradePiExtension("demo");
    const again = await bridge.upgradePiExtension("demo");
    expect(again.changed).toBe(false);
    expect((await bridge.readLockfile()).extensions.demo.history).toEqual(["1.0.0"]);
    // 只有一次成功升级审计。
    const upgrades = (await bridge.readAuditTrail()).filter((entry) => entry.action === "upgrade");
    expect(upgrades).toHaveLength(1);
  });

  it("rolls back to the previous version without deleting the newer one", async () => {
    const { bridge, dataDir } = await upgraded();
    await bridge.upgradePiExtension("demo");
    const result = await bridge.rollbackPiExtension("demo");
    expect(result).toMatchObject({ version: "1.0.0", previousVersion: "1.1.0", changed: true });
    expect((await bridge.readLockfile()).extensions.demo.history).toEqual([]);
    expect(await readFile(join(dataDir, "pi-extensions", "demo", "current"), "utf8")).toBe(
      "1.0.0\n",
    );
    expect(
      await readFile(join(dataDir, "pi-extensions", "demo", "1.1.0", "index.js"), "utf8"),
    ).toBe("v1.1.0\n");
    const audit = await bridge.readAuditTrail();
    expect(audit.at(-1)).toMatchObject({
      action: "rollback",
      version: "1.0.0",
      from: "1.1.0",
      outcome: "success",
    });
  });

  it("rejects rollback without history or a missing previous payload", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const bridge = bridgeFor(dataDir);
    await bridge.installPiExtension("demo");
    await expect(bridge.rollbackPiExtension("demo")).rejects.toMatchObject({
      code: "no-previous-version",
    });
    await expect(bridge.rollbackPiExtension("nope")).rejects.toMatchObject({ code: "not-found" });

    const { bridge: upgradedBridge, dataDir: upgradedDir } = await upgraded();
    await upgradedBridge.upgradePiExtension("demo");
    await rm(join(upgradedDir, "pi-extensions", "demo", "1.0.0"), { recursive: true, force: true });
    await expect(upgradedBridge.rollbackPiExtension("demo")).rejects.toMatchObject({
      code: "no-previous-version",
    });
  });

  it("serializes concurrent mutations so the lockfile stays consistent", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension({ versions: ["1.0.0", "1.1.0"], version: "1.1.0" })]);
    const bridge = bridgeFor(dataDir);
    const [first, second] = await Promise.all([
      bridge.installPiExtension("demo", "1.0.0"),
      bridge.installPiExtension("demo", "1.1.0"),
    ]);
    expect(first.version).toBe("1.0.0");
    expect(second.version).toBe("1.1.0");
    const lockfile = await bridge.readLockfile();
    expect(lockfile.version).toBe(1);
    expect(lockfile.extensions.demo.version).toBe("1.1.0");
    expect(lockfile.extensions.demo.history).toEqual(["1.0.0"]);
  });
});

describe("audit trail", () => {
  it("reads the newest entries first-class and tolerates a truncated tail", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const bridge = bridgeFor(dataDir);
    await bridge.installPiExtension("demo");
    await bridge.refreshRegistry();
    const all = await bridge.readAuditTrail();
    expect(all.map((entry) => entry.action)).toEqual(["install", "refresh"]);
    expect(await bridge.readAuditTrail(1)).toHaveLength(1);
    expect((await bridge.readAuditTrail(1))[0].action).toBe("refresh");
    await writeFile(bridge.paths.auditFile, `${JSON.stringify(all[0])}\n{"broken":`, "utf8");
    expect(await bridge.readAuditTrail()).toHaveLength(1);
  });

  it("returns an empty trail when the file does not exist", async () => {
    const dataDir = await makeDataDir();
    expect(await bridgeFor(dataDir).readAuditTrail()).toEqual([]);
  });
});

describe("capability helpers", () => {
  it("flags high-risk capabilities", () => {
    expect(hasHighRiskCapability([{ id: "a" }, { id: "b", risk: "medium" }])).toBe(false);
    expect(hasHighRiskCapability([{ id: "a", risk: "high" }])).toBe(true);
  });
});

describe("IPC (additive)", () => {
  function fakeIpc() {
    const handlers = new Map<string, (event: unknown, args?: unknown) => unknown>();
    const ipc: PiMarketIpcLike = {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
      removeHandler(channel) {
        handlers.delete(channel);
      },
    };
    return { ipc, handlers };
  }

  it("exposes a stable channel table", () => {
    expect(PI_MARKET_IPC_CHANNELS).toMatchObject({
      list: "agent:pi-market-list",
      install: "agent:pi-market-install",
      upgrade: "agent:pi-market-upgrade",
      rollback: "agent:pi-market-rollback",
    });
    // 不与既有 marketplace / plugin channel 冲突。
    expect(
      Object.values(PI_MARKET_IPC_CHANNELS).every((channel) =>
        channel.startsWith("agent:pi-market-"),
      ),
    ).toBe(true);
  });

  it("registers handlers and disposes them", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const bridge = bridgeFor(dataDir);
    const { ipc, handlers } = fakeIpc();
    const dispose = registerPiMarketBridgeIpc(bridge, ipc);
    // 用 channel 表算数量,而不是写死 —— 加一个 channel 不该让这条测试变红。
    expect(handlers.size).toBe(Object.keys(PI_MARKET_IPC_CHANNELS).length);

    const list = await handlers.get(PI_MARKET_IPC_CHANNELS.list)!(null);
    expect((list as { entries: unknown[] }).entries).toHaveLength(1);

    const installed = await handlers.get(PI_MARKET_IPC_CHANNELS.install)!(null, {
      id: "demo",
      allowHighRisk: false,
    });
    expect(installed).toMatchObject({ id: "demo", version: "1.0.0" });

    const lockfile = await handlers.get(PI_MARKET_IPC_CHANNELS.lockfile)!(null);
    expect(Object.keys((lockfile as { extensions: object }).extensions)).toEqual(["demo"]);

    const audit = await handlers.get(PI_MARKET_IPC_CHANNELS.audit)!(null, { limit: 1 });
    expect((audit as { entries: unknown[] }).entries).toHaveLength(1);

    dispose();
    expect(handlers.size).toBe(0);
  });

  it("validates handler payloads", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const handlers = createPiMarketHandlers(bridgeFor(dataDir));
    await expect(handlers[PI_MARKET_IPC_CHANNELS.install]({})).rejects.toMatchObject({
      code: "invalid-id",
    });
    await expect(handlers[PI_MARKET_IPC_CHANNELS.upgrade](null)).rejects.toMatchObject({
      code: "invalid-id",
    });
    await expect(handlers[PI_MARKET_IPC_CHANNELS.rollback]("demo")).rejects.toMatchObject({
      code: "invalid-id",
    });
    await expect(handlers[PI_MARKET_IPC_CHANNELS.rollback]({ id: "demo" })).rejects.toMatchObject({
      code: "not-found",
    });
    // 失败路径也会写审计:handler 层不需要额外记账。
    const audit = await handlers[PI_MARKET_IPC_CHANNELS.audit](undefined);
    expect((audit as { entries: { action: string; outcome: string }[] }).entries).toHaveLength(1);
    expect((audit as { entries: { action: string; outcome: string }[] }).entries[0]).toMatchObject({
      action: "rollback",
      outcome: "failure",
    });
  });

  it("tolerates a host whose ipc facade cannot remove handlers", () => {
    const dataDir = "ignored-dir";
    const handler = vi.fn();
    const dispose = registerPiMarketBridgeIpc(bridgeFor(dataDir), { handle: handler });
    expect(handler).toHaveBeenCalledTimes(Object.keys(PI_MARKET_IPC_CHANNELS).length);
    expect(() => dispose()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------

/**
 * R33 — 卸载。
 *
 * 在此之前 `PiMarketBridge` 根本没有卸载能力:装了只能去手删目录,审计里也查不出
 * 「装过又删了」。这里的重点是**四种磁盘/lockfile 组合都要收敛到同一个结果**,
 * 以及"删到一半"不会留下看起来还在的安装(先 rename 到 .trash-* 再 rm)。
 */
describe("uninstallPiExtension (R33)", () => {
  it("删掉版本目录 + 摘掉 lockfile 记录,并留一条 uninstall 审计", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const bridge = bridgeFor(dataDir);
    await bridge.installPiExtension("demo");

    const result = await bridge.uninstallPiExtension("demo");
    expect(result).toMatchObject({ id: "demo", version: "1.0.0", payloadKept: false });
    expect(result.removedVersions).toEqual(["1.0.0"]);
    expect(await existsPath(result.removedPath)).toBe(false);
    expect(Object.keys((await bridge.readLockfile()).extensions)).toEqual([]);

    const audit = await bridge.readAuditTrail(10);
    expect(audit.at(-1)).toMatchObject({ action: "uninstall", extensionId: "demo", outcome: "success" });
  });

  it("卸载后市场列表里不再有已安装标记", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const bridge = bridgeFor(dataDir);
    await bridge.installPiExtension("demo");
    expect((await bridge.listMarketEntries())[0]).toMatchObject({ installedVersion: "1.0.0" });

    await bridge.uninstallPiExtension("demo");
    const after = (await bridge.listMarketEntries())[0];
    expect(after.installedVersion).toBeUndefined();
    expect(after.updateAvailable).toBeUndefined();
  });

  it("keepPayload 只摘 lockfile 记录(停用但留着回滚),目录原样保留", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const bridge = bridgeFor(dataDir);
    await bridge.installPiExtension("demo");

    const result = await bridge.uninstallPiExtension("demo", { keepPayload: true });
    expect(result).toMatchObject({ id: "demo", payloadKept: true });
    expect(result.removedVersions).toEqual([]);
    expect(await existsPath(join(result.removedPath, "1.0.0"))).toBe(true);
    expect(Object.keys((await bridge.readLockfile()).extensions)).toEqual([]);

    // 载荷还在 → 直接装回来是幂等的(changed: true 因为是重新建立记录)。
    const again = await bridge.installPiExtension("demo", "1.0.0", { force: true });
    expect(again).toMatchObject({ id: "demo", version: "1.0.0" });
  });

  it("只有 lockfile(目录被外部删了)也能收敛", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const bridge = bridgeFor(dataDir);
    await bridge.installPiExtension("demo");
    await rm(join(dataDir, "pi-extensions", "demo"), { recursive: true, force: true });

    const result = await bridge.uninstallPiExtension("demo");
    expect(result.removedVersions).toEqual([]);
    expect(Object.keys((await bridge.readLockfile()).extensions)).toEqual([]);
  });

  it("只有目录(手工拷进来的,没有 lockfile 记录)也能卸干净", async () => {
    const dataDir = await makeDataDir();
    const bridge = bridgeFor(dataDir);
    const extDir = join(dataDir, "pi-extensions", "manual");
    await mkdir(join(extDir, "2.0.0"), { recursive: true });

    const result = await bridge.uninstallPiExtension("manual");
    expect(result.version).toBeUndefined();
    expect(result.removedVersions).toEqual(["2.0.0"]);
    expect(await existsPath(extDir)).toBe(false);
  });

  it("两者都没有 → not-found,并留一条 failure 审计", async () => {
    const dataDir = await makeDataDir();
    const bridge = bridgeFor(dataDir);
    await expect(bridge.uninstallPiExtension("ghost")).rejects.toMatchObject({ code: "not-found" });
    const audit = await bridge.readAuditTrail(5);
    expect(audit.at(-1)).toMatchObject({ action: "uninstall", outcome: "failure" });
  });

  it("id 不合法 → invalid-id(不会碰到别的扩展)", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension(), extension({ id: "keep" })]);
    const bridge = bridgeFor(dataDir);
    await bridge.installPiExtension("demo");
    await bridge.installPiExtension("keep");

    await expect(bridge.uninstallPiExtension("../demo")).rejects.toMatchObject({
      code: "invalid-id",
    });
    expect(Object.keys((await bridge.readLockfile()).extensions).sort()).toEqual(["demo", "keep"]);

    await bridge.uninstallPiExtension("demo");
    expect(Object.keys((await bridge.readLockfile()).extensions)).toEqual(["keep"]);
    expect(await existsPath(join(dataDir, "pi-extensions", "keep"))).toBe(true);
  });

  it("不留 .trash-* 残留", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const bridge = bridgeFor(dataDir);
    await bridge.installPiExtension("demo");
    await bridge.uninstallPiExtension("demo");

    const names = await readdirString(join(dataDir, "pi-extensions"));
    expect(names.filter((name) => name.startsWith(".trash-"))).toEqual([]);
  });

  it("IPC handler 可用,channel 表包含 pi-market-uninstall", async () => {
    const dataDir = await makeDataDir();
    await writeRegistry(dataDir, [extension()]);
    const bridge = bridgeFor(dataDir);
    await bridge.installPiExtension("demo");
    const handlers = createPiMarketHandlers(bridge);
    expect(PI_MARKET_IPC_CHANNELS.uninstall).toBe("agent:pi-market-uninstall");

    const result = await handlers[PI_MARKET_IPC_CHANNELS.uninstall]({ id: "demo" });
    expect(result).toMatchObject({ id: "demo", version: "1.0.0", payloadKept: false });
    await expect(handlers[PI_MARKET_IPC_CHANNELS.uninstall]({})).rejects.toMatchObject({
      code: "invalid-id",
    });
  });
});
