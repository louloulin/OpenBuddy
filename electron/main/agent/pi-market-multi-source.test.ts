// @vitest-environment node
/**
 * pi-market-multi-source.test.ts — R32 多源 registry 的行为契约。
 *
 * 三块:
 *   1. 纯函数(`mergePiMarketSources` / `normalizeRegistrySources` /
 *      `resolvePiMarketSources`)—— 权重、去重、坏配置容错,全部不用起 bridge。
 *   2. bridge 集成 —— 合并后的 list 带 provenance、每源状态、缓存落盘。
 *   3. 离线兜底 —— 源掉线时用缓存继续服务;全部掉线且无缓存才抛错。
 *
 * 全部用真实临时目录 + 注入 fetchJson,不触网。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PI_MARKET_SOURCES_ENV,
  PI_MARKET_REGISTRY_URL_ENV,
  createPiMarketBridge,
  mergePiMarketSources,
  normalizeRegistrySources,
  resolvePiMarketSources,
  sourceWeight,
  type PiMarketRegistryEntry,
  type PiMarketRegistrySource,
} from "./pi-market-bridge";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeDataDir(prefix = "openbuddy-pi-market-ms-"): Promise<string> {
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

const source = (id: string, weight = 0, extra: Partial<PiMarketRegistrySource> = {}): PiMarketRegistrySource => ({
  id,
  url: `https://${id}.example/index.json`,
  weight,
  ...extra,
});

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

describe("mergePiMarketSources", () => {
  it("同一个 id 只有权重最大的源赢,字段原样保留", () => {
    const merged = mergePiMarketSources([
      { source: source("community", 10), entries: [extension({ name: "社区版" })] },
      { source: source("official", 100), entries: [extension({ name: "官方版" })] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("官方版");
    expect(merged[0].sourceId).toBe("official");
    // 输的那一方只留痕迹,不参与字段合并。
    expect(merged[0].alsoOfferedBy).toEqual(["community"]);
  });

  it("同权重保持声明顺序(先声明者赢)", () => {
    const merged = mergePiMarketSources([
      { source: source("first"), entries: [extension({ name: "第一个" })] },
      { source: source("second"), entries: [extension({ name: "第二个" })] },
    ]);
    expect(merged[0].name).toBe("第一个");
    expect(merged[0].sourceId).toBe("first");
  });

  it("低权重源独有的 id 照常收录(镜像可以补充官方源没有的插件)", () => {
    const merged = mergePiMarketSources([
      { source: source("official", 100), entries: [extension({ id: "official-only" })] },
      { source: source("mirror", 1), entries: [extension({ id: "mirror-only" })] },
    ]);
    expect(merged.map((entry) => entry.id)).toEqual(["official-only", "mirror-only"]);
    expect(merged[1].sourceId).toBe("mirror");
    expect(merged[1].alsoOfferedBy).toBeUndefined();
  });

  it("跳过没有 id 的坏条目,不影响其余条目", () => {
    const merged = mergePiMarketSources([
      {
        source: source("official"),
        entries: [extension(), { name: "缺 id" } as unknown as PiMarketRegistryEntry],
      },
    ]);
    expect(merged.map((entry) => entry.id)).toEqual(["demo"]);
  });

  it("权重缺失或非有限数一律当 0,不会打乱顺序", () => {
    expect(sourceWeight({ id: "a", url: "u" })).toBe(0);
    expect(sourceWeight({ id: "a", url: "u", weight: Number.NaN })).toBe(0);
    const merged = mergePiMarketSources([
      { source: { id: "a", url: "u", weight: Number.NaN }, entries: [extension({ name: "A" })] },
      { source: source("b", 5), entries: [extension({ name: "B" })] },
    ]);
    expect(merged[0].name).toBe("B");
  });

  it("没有任何源时返回空列表", () => {
    expect(mergePiMarketSources([])).toEqual([]);
  });
});

describe("normalizeRegistrySources", () => {
  it("同时接受数组与 { sources } 两种形状", () => {
    const asArray = normalizeRegistrySources([{ id: "a", url: "https://a/x.json" }]);
    const asObject = normalizeRegistrySources({ sources: [{ id: "a", url: "https://a/x.json" }] });
    expect(asArray).toEqual(asObject);
    expect(asArray[0]).toMatchObject({ id: "a", url: "https://a/x.json" });
  });

  it("丢掉没有 url 的条目,并对同 id 去重", () => {
    const out = normalizeRegistrySources([
      { id: "a", url: "https://a/1.json" },
      { id: "a", url: "https://a/2.json" },
      { id: "b" },
      null,
      "nope",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://a/1.json");
  });

  it("id 非法或缺失时从 URL 的 host + path 派生一个稳定 id", () => {
    const out = normalizeRegistrySources([{ url: "https://Market.Example.COM/index.json" }]);
    // 带 path:R35 之后 id 还要区分同一 host 上的多个索引,否则读路径的去重
    // (同 id 只保留第一条)会把第二个源静默丢掉。
    expect(out[0].id).toBe("market.example.com-index");
    const local = normalizeRegistrySources([{ url: "./vendor/market" }]);
    expect(local[0].id).toBe("local-vendor-market");
    // 完全无法派生的输入(路径里没有任何可用字符)才落到序号。
    const blank = normalizeRegistrySources([{ url: "///" }]);
    expect(blank).toHaveLength(1);
    expect(blank[0].id).toBe("source-1");
  });

  it("保留 weight / label / trusted / timeoutMs", () => {
    const [entry] = normalizeRegistrySources([
      { id: "a", url: "https://a/x.json", weight: 42, label: "官方", trusted: true, timeoutMs: 500 },
    ]);
    expect(entry).toEqual({
      id: "a",
      url: "https://a/x.json",
      weight: 42,
      label: "官方",
      trusted: true,
      timeoutMs: 500,
    });
  });
});

describe("resolvePiMarketSources", () => {
  it("显式 > registryUrl > 环境变量 > sources.json,并按权重排序", async () => {
    const dataDir = await makeDataDir();
    await mkdir(join(dataDir, "pi-extensions"), { recursive: true });
    await writeFile(
      join(dataDir, "pi-extensions", "sources.json"),
      JSON.stringify({ version: 1, sources: [{ id: "file", url: "https://file.example/x.json", weight: 1 }] }),
      "utf8",
    );
    const resolved = await resolvePiMarketSources({
      dataDir,
      sources: [{ id: "explicit", url: "https://explicit.example/x.json", weight: 5 }],
      registryUrl: "https://legacy.example/x.json",
      env: { [PI_MARKET_SOURCES_ENV]: JSON.stringify([{ id: "env", url: "https://env.example/x.json" }]) },
    });
    // 权重降序:explicit(5) > file(1) > default(0,先声明) > env(0)。
    expect(resolved.map((entry) => entry.id)).toEqual(["explicit", "file", "default", "env"]);
    expect(resolved.map((entry) => entry.weight ?? 0)).toEqual([5, 1, 0, 0]);
  });

  it("环境变量写单个 URL(非 JSON)也能识别", async () => {
    const dataDir = await makeDataDir();
    const resolved = await resolvePiMarketSources({
      dataDir,
      env: {
        [PI_MARKET_SOURCES_ENV]: "https://solo.example/index.json",
        [PI_MARKET_REGISTRY_URL_ENV]: "https://legacy.example/index.json",
      },
    });
    // 两个 URL 各自成为独立源(同 id 去重只对真正的重复生效)。
    expect(resolved.map((entry) => entry.id)).toEqual(["env", "default"]);
    expect(resolved.map((entry) => entry.url)).toEqual([
      "https://solo.example/index.json",
      "https://legacy.example/index.json",
    ]);
  });

  it("sources.json 语法错误时忽略它,而不是让市场打不开", async () => {
    const dataDir = await makeDataDir();
    await mkdir(join(dataDir, "pi-extensions"), { recursive: true });
    await writeFile(join(dataDir, "pi-extensions", "sources.json"), "{ 坏掉的 json", "utf8");
    const resolved = await resolvePiMarketSources({ dataDir, env: {} });
    expect(resolved).toEqual([]);
  });

  it("没配置任何源时返回空(默认不联网)", async () => {
    const dataDir = await makeDataDir();
    expect(await resolvePiMarketSources({ dataDir, env: {} })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// bridge 集成
// ---------------------------------------------------------------------------

function bridgeForSources(
  dataDir: string,
  sources: readonly PiMarketRegistrySource[],
  fetchJson: (url: string) => Promise<unknown>,
) {
  return createPiMarketBridge({ dataDir, hostVersion: "0.15.0", sources, fetchJson });
}

describe("多源 bridge", () => {
  it("list 合并多个源并带上 provenance", async () => {
    const dataDir = await makeDataDir();
    const fetchJson = vi.fn(async (url: string) =>
      url.includes("official")
        ? { extensions: [extension({ id: "shared", name: "官方版" }), extension({ id: "only-official" })] }
        : { extensions: [extension({ id: "shared", name: "社区版" }), extension({ id: "only-community" })] },
    );
    const bridge = bridgeForSources(
      dataDir,
      [source("official", 100), source("community", 10)],
      fetchJson,
    );
    const entries = await bridge.listMarketEntries();
    expect(entries.map((entry) => entry.id)).toEqual(["shared", "only-official", "only-community"]);
    const shared = entries.find((entry) => entry.id === "shared")!;
    expect(shared.name).toBe("官方版");
    expect(shared.sourceId).toBe("official");
    expect(shared.alsoOfferedBy).toEqual(["community"]);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("readRegistry 报告每个源的状态,并把缓存写进 sources/<id>.json", async () => {
    const dataDir = await makeDataDir();
    const bridge = bridgeForSources(
      dataDir,
      [source("official", 100), source("mirror", 10)],
      async () => ({ extensions: [extension()] }),
    );
    const registry = await bridge.readRegistry();
    expect(registry.source).toBe("remote");
    expect(registry.sources?.map((entry) => [entry.id, entry.state])).toEqual([
      ["official", "fresh"],
      ["mirror", "fresh"],
    ]);
    const cached = JSON.parse(
      await readFile(join(bridge.paths.sourcesDir, "official.json"), "utf8"),
    );
    expect(cached.source.id).toBe("official");
    expect(cached.entries).toHaveLength(1);
    expect(typeof cached.fetchedAt).toBe("string");
  });

  it("一个源掉线时,它退回上次的缓存,其它源照常新鲜", async () => {
    const dataDir = await makeDataDir();
    const sources = [source("official", 100), source("mirror", 10)];
    const up = bridgeForSources(dataDir, sources, async (url: string) =>
      url.includes("official")
        ? { extensions: [extension({ id: "official-only" })] }
        : { extensions: [extension({ id: "mirror-only" })] },
    );
    await up.readRegistry();

    const down = bridgeForSources(dataDir, sources, async (url: string) => {
      if (url.includes("official")) throw new Error("offline");
      return { extensions: [extension({ id: "mirror-only" })] };
    });
    const registry = await down.readRegistry();
    expect(registry.entries.map((entry) => entry.id)).toEqual(["official-only", "mirror-only"]);
    const official = registry.sources?.find((entry) => entry.id === "official")!;
    expect(official.state).toBe("cached");
    expect(official.error).toContain("offline");
    expect(registry.sources?.find((entry) => entry.id === "mirror")?.state).toBe("fresh");
  });

  it("全部源掉线且没有任何缓存时才抛 invalid-registry", async () => {
    const dataDir = await makeDataDir();
    const bridge = bridgeForSources(dataDir, [source("official", 100)], async () => {
      throw new Error("offline");
    });
    await expect(bridge.listMarketEntries()).rejects.toMatchObject({ code: "invalid-registry" });
    await expect(bridge.refreshRegistry()).rejects.toMatchObject({ code: "invalid-registry" });
    expect(await bridge.readAuditTrail()).not.toEqual([]);
    expect((await bridge.readAuditTrail())[0]).toMatchObject({
      action: "refresh",
      outcome: "failure",
    });
  });

  it("refresh 写合并结果 + 每源状态;有缓存的源计入 failed 但不阻断刷新", async () => {
    const dataDir = await makeDataDir();
    const sources = [source("official", 100), source("mirror", 10)];
    await bridgeForSources(dataDir, sources, async (url: string) =>
      url.includes("official")
        ? { extensions: [extension({ id: "official-only" })] }
        : { extensions: [extension({ id: "mirror-only" })] },
    ).refreshRegistry();

    const bridge = bridgeForSources(dataDir, sources, async (url: string) => {
      if (url.includes("official")) throw new Error("502");
      return { extensions: [extension({ id: "mirror-only", version: "2.0.0" })] };
    });
    // 本地 registry.json 已存在 → 先删掉,确保这次真的走多源路径。
    await rm(join(dataDir, "pi-extensions", "registry.json"), { force: true });

    const report = await bridge.refreshRegistry();
    expect(report.source).toBe("remote");
    expect(report.count).toBe(2);
    expect(report.failed?.map((entry) => entry.id)).toEqual(["official"]);
    expect(report.sources?.map((entry) => entry.state)).toEqual(["cached", "fresh"]);
    const written = JSON.parse(await readFile(bridge.paths.registryFile, "utf8"));
    expect(written.extensions.map((entry: PiMarketRegistryEntry) => entry.id)).toEqual([
      "official-only",
      "mirror-only",
    ]);
  });

  it("单个源超时不会拖住整次刷新", async () => {
    const dataDir = await makeDataDir();
    const bridge = bridgeForSources(
      dataDir,
      [source("slow", 100, { timeoutMs: 25 }), source("fast", 10)],
      async (url: string) => {
        if (url.includes("slow")) return new Promise(() => undefined);
        return { extensions: [extension({ id: "fast-only" })] };
      },
    );
    const registry = await bridge.readRegistry();
    expect(registry.entries.map((entry) => entry.id)).toEqual(["fast-only"]);
    const slow = registry.sources?.find((entry) => entry.id === "slow")!;
    expect(slow.state).toBe("failed");
    expect(slow.error).toContain("timed out");
  });

  it("本地 registry.json 存在时优先,配置的远端源标为 skipped 且不触网", async () => {
    const dataDir = await makeDataDir();
    await mkdir(join(dataDir, "pi-extensions"), { recursive: true });
    await writeFile(
      join(dataDir, "pi-extensions", "registry.json"),
      JSON.stringify({ version: 1, extensions: [extension({ id: "local-demo" })] }),
      "utf8",
    );
    const fetchJson = vi.fn(async () => ({ extensions: [extension({ id: "remote-demo" })] }));
    const bridge = bridgeForSources(dataDir, [source("official", 100)], fetchJson);
    const registry = await bridge.readRegistry();
    expect(registry.entries.map((entry) => entry.id)).toEqual(["local-demo"]);
    expect(registry.source).toBe("local");
    expect(registry.sources?.[0].state).toBe("skipped");
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("单源 registryUrl 仍然照旧工作(向后兼容)", async () => {
    const dataDir = await makeDataDir();
    const bridge = createPiMarketBridge({
      dataDir,
      registryUrl: "https://market.example/index.json",
      fetchJson: async () => ({ extensions: [extension({ id: "remote-demo" })] }),
    });
    expect((await bridge.listMarketEntries()).map((entry) => entry.id)).toEqual(["remote-demo"]);
    expect(await bridge.readRegistry()).toMatchObject({ source: "remote" });
  });
});
