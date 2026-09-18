// @vitest-environment node
/**
 * pi-market-sources.test.ts — R35 源管理(读 / 写 / 探活)的行为契约。
 *
 * 为什么这些断言值得写:在 R35 之前 `sources.json` 只能手写,而且**写完必须重启**
 * (源清单在 `createPiMarketBridge()` 构造时定死)。这里钉住的是"改完立刻生效"
 * 这条承诺本身:
 *   1. `resolvePiMarketSourcesDetailed()` 把只读源与文件源分开 —— UI 才知道哪些能改;
 *   2. `setSources()` 原子写回文件 + 就地替换内存清单,紧接着的 `refreshRegistry()`
 *      就是按新源跑(不需要重建 bridge / 重启应用);
 *   3. 写路径**严格**校验(读路径刻意宽容):坏 URL / 重复 id / 非数字权重必须报错
 *      并指出位置,不能像读盘那样静默丢弃;
 *   4. 只读源永远赢:用户把同 id 写进文件也压不动部署注入的那一份;
 *   5. `probeSource()` 探活不落盘 —— "保存前先试一下"不该改动任何状态。
 *
 * 全部用真实临时目录 + 注入 fetchJson,不触网。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PI_MARKET_SOURCES_FILE,
  createPiMarketBridge,
  mergeSourceLists,
  resolvePiMarketSourcesDetailed,
  validateRegistrySourcesForWrite,
  type PiMarketRegistryEntry,
  type PiMarketRegistrySource,
} from "./pi-market-bridge";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeDataDir(prefix = "openbuddy-pi-market-src-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function extension(id: string, partial: Partial<PiMarketRegistryEntry> = {}): PiMarketRegistryEntry {
  return {
    id,
    name: id,
    publisher: "openbuddy",
    description: `${id} 演示`,
    version: "1.0.0",
    versions: ["1.0.0"],
    kinds: ["extension"],
    files: { "index.js": "export const name = 'x';\n" },
    ...partial,
  };
}

const source = (id: string, extra: Partial<PiMarketRegistrySource> = {}): PiMarketRegistrySource => ({
  id,
  url: `https://${id}.example/index.json`,
  ...extra,
});

describe("R35 源管理:读路径把只读源与文件源分开", () => {
  it("resolvePiMarketSourcesDetailed 给出 readonly / file / merged 三份", async () => {
    const dataDir = await makeDataDir();
    await mkdir(join(dataDir, "pi-extensions"), { recursive: true });
    await writeFile(
      join(dataDir, "pi-extensions", PI_MARKET_SOURCES_FILE),
      JSON.stringify({ sources: [source("internal", { weight: 5 })] }),
      "utf8",
    );

    const resolved = await resolvePiMarketSourcesDetailed({
      dataDir,
      sources: [source("official", { weight: 1 })],
      env: {},
    });
    expect(resolved.readonly.map((item) => item.id)).toEqual(["official"]);
    expect(resolved.file.map((item) => item.id)).toEqual(["internal"]);
    // 权重大的排前面。
    expect(resolved.merged.map((item) => item.id)).toEqual(["internal", "official"]);
  });

  it("文件不存在时 file 为空,而不是抛错", async () => {
    const dataDir = await makeDataDir();
    const resolved = await resolvePiMarketSourcesDetailed({ dataDir, env: {} });
    expect(resolved.file).toEqual([]);
    expect(resolved.merged).toEqual([]);
  });

  it("同 id 时只读源赢(用户写同 id 也压不动部署注入的那一份)", () => {
    const merged = mergeSourceLists(
      [source("official", { url: "https://official.example/i.json" })],
      [source("official", { url: "https://hijack.example/i.json", weight: 99 })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].url).toBe("https://official.example/i.json");
  });
});

describe("R35 源管理:写路径严格校验", () => {
  it("坏条目报错并指出第几行的哪个字段", () => {
    expect(() => validateRegistrySourcesForWrite("nope")).toThrow(/must be an array/);
    expect(() => validateRegistrySourcesForWrite([{ id: "a" }])).toThrow(/sources\[0\]\.url is required/);
    expect(() => validateRegistrySourcesForWrite([source("ok"), { id: "bad id", url: "https://x.example" }])).toThrow(
      /sources\[1\]\.id is invalid/,
    );
    expect(() =>
      validateRegistrySourcesForWrite([
        { id: "dup", url: "https://a.example/i.json" },
        { id: "dup", url: "https://b.example/i.json" },
      ]),
    ).toThrow(/duplicate source id: dup/);
    expect(() => validateRegistrySourcesForWrite([source("w", { weight: Number.NaN })])).toThrow(
      /sources\[0\]\.weight must be a finite number/,
    );
    expect(() => validateRegistrySourcesForWrite([source("t", { timeoutMs: 0 })])).toThrow(
      /sources\[0\]\.timeoutMs must be a positive number/,
    );
  });

  it("没写 id 时从 URL 的 host + path 派生,且保留 label / trusted / timeoutMs", () => {
    const [normalized] = validateRegistrySourcesForWrite([
      { url: "https://mirror.example.com/pi/index.json", label: " 镜像 ", trusted: true, timeoutMs: 1500, weight: 3 },
    ]);
    expect(normalized).toEqual({
      id: "mirror.example.com-pi-index",
      url: "https://mirror.example.com/pi/index.json",
      label: "镜像",
      weight: 3,
      trusted: true,
      timeoutMs: 1500,
    });
  });

  it("同一个 host 上的多个索引拿到不同 id(只按 host 派生会静默丢掉第二个源)", () => {
    const normalized = validateRegistrySourcesForWrite([
      { url: "https://mirror.corp/pi/stable.json" },
      { url: "https://mirror.corp/pi/nightly.json" },
      { url: "http://127.0.0.1:8080/primary.json" },
    ]);
    expect(normalized.map((item) => item.id)).toEqual([
      "mirror.corp-pi-stable",
      "mirror.corp-pi-nightly",
      "127.0.0.18080-primary",
    ]);
    // 读路径的去重(同 id 只保留第一条)不再误伤它们。
    expect(new Set(normalized.map((item) => item.id)).size).toBe(3);
  });

  it("本地绝对路径派生成 local-<path>(用序号做兜底会让调整顺序把缓存指错)", () => {
    const [normalized] = validateRegistrySourcesForWrite([{ url: "/srv/pi/index.json" }]);
    expect(normalized.id).toBe("local-srv-pi-index");
  });
});

describe("R35 源管理:保存后立刻生效", () => {
  it("setSources 写回 sources.json,且紧接着的 refresh 按新源跑", async () => {
    const dataDir = await makeDataDir();
    const calls: string[] = [];
    const bridge = createPiMarketBridge({
      dataDir,
      fetchJson: async (url: string) => {
        calls.push(url);
        if (url.includes("second")) {
          return { version: 1, extensions: [extension("from-second")] };
        }
        return { version: 1, extensions: [extension("from-first")] };
      },
    });

    // 初始没有源:refresh 走本地索引,不触网。
    const before = await bridge.refreshRegistry();
    expect(before.source).toBe("local");
    expect(calls).toEqual([]);

    const saved = await bridge.setSources([
      { id: "first", url: "https://first.example/index.json", weight: 1 },
    ]);
    expect(saved.file.map((item) => item.id)).toEqual(["first"]);

    // 文件真的落盘了(而不是只在内存里)。
    const onDisk = JSON.parse(
      await readFile(join(dataDir, "pi-extensions", PI_MARKET_SOURCES_FILE), "utf8"),
    ) as { version: number; sources: PiMarketRegistrySource[] };
    expect(onDisk.version).toBe(1);
    expect(onDisk.sources.map((item) => item.id)).toEqual(["first"]);

    const after = await bridge.refreshRegistry();
    expect(after.source).toBe("remote");
    expect(calls).toEqual(["https://first.example/index.json"]);
    expect((await bridge.listMarketEntries()).map((item) => item.id)).toEqual(["from-first"]);

    // 再换一个源:不重建 bridge,直接生效。
    await bridge.setSources([{ id: "second", url: "https://second.example/index.json" }]);
    await bridge.refreshRegistry();
    expect((await bridge.listMarketEntries()).map((item) => item.id)).toEqual(["from-second"]);
  });

  it("setSources 清空上一次的每源状态(源换过了,旧状态不再对应任何东西)", async () => {
    const dataDir = await makeDataDir();
    const bridge = createPiMarketBridge({
      dataDir,
      fetchJson: async () => ({ version: 1, extensions: [extension("x")] }),
    });
    await bridge.setSources([{ id: "first", url: "https://first.example/index.json" }]);
    await bridge.refreshRegistry();
    expect(bridge.getSources().statuses.map((item) => item.id)).toEqual(["first"]);

    await bridge.setSources([{ id: "another", url: "https://another.example/index.json" }]);
    expect(bridge.getSources().statuses).toEqual([]);
  });

  it("只读源(宿主注入)出现在 effective 里并标成不可编辑,但不会被写进文件", async () => {
    const dataDir = await makeDataDir();
    const bridge = createPiMarketBridge({
      dataDir,
      sources: [{ id: "deployed", url: "https://deployed.example/index.json", weight: 10 }],
      fetchJson: async (url: string) =>
        url.includes("deployed")
          ? { version: 1, extensions: [extension("deployed-ext")] }
          : { version: 1, extensions: [extension("file-ext")] },
    });
    await bridge.setSources([{ id: "file", url: "https://file.example/index.json" }]);
    const view = bridge.getSources();
    expect(view.readonlySourceIds).toEqual(["deployed"]);
    expect(view.file.map((item) => item.id)).toEqual(["file"]);
    // effective 按权重排:部署源的权重 10 压过文件源的 0。
    expect(view.effective.map((item) => item.id)).toEqual(["deployed", "file"]);

    const onDisk = JSON.parse(
      await readFile(join(dataDir, "pi-extensions", PI_MARKET_SOURCES_FILE), "utf8"),
    ) as { sources: PiMarketRegistrySource[] };
    expect(onDisk.sources.map((item) => item.id)).toEqual(["file"]);
  });

  it("setSources 校验失败时不落盘(用户改坏了不会丢掉原配置)", async () => {
    const dataDir = await makeDataDir();
    const bridge = createPiMarketBridge({ dataDir, fetchJson: async () => ({ version: 1, extensions: [] }) });
    await bridge.setSources([{ id: "keep", url: "https://keep.example/index.json" }]);
    await expect(bridge.setSources([{ id: "keep", url: "" }])).rejects.toThrow(/sources\[0\]\.url is required/);
    const onDisk = JSON.parse(
      await readFile(join(dataDir, "pi-extensions", PI_MARKET_SOURCES_FILE), "utf8"),
    ) as { sources: PiMarketRegistrySource[] };
    expect(onDisk.sources.map((item) => item.id)).toEqual(["keep"]);
    expect(bridge.getSources().file.map((item) => item.id)).toEqual(["keep"]);
  });
});

describe("R35 源管理:探活不落盘", () => {
  it("可达时给出条数与样例 id,不可达时给出原因,且都不写缓存文件", async () => {
    const dataDir = await makeDataDir();
    const bridge = createPiMarketBridge({
      dataDir,
      fetchJson: async (url: string) => {
        if (url.includes("broken")) throw new Error("HTTP 500");
        return { version: 1, extensions: [extension("alpha"), extension("beta")] };
      },
    });

    const ok = await bridge.probeSource({ id: "good", url: "https://good.example/index.json" });
    expect(ok.ok).toBe(true);
    expect(ok.entryCount).toBe(2);
    expect(ok.sampleId).toBe("alpha");
    expect(Number.isFinite(ok.elapsedMs)).toBe(true);

    const bad = await bridge.probeSource({ id: "broken", url: "https://broken.example/index.json" });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/HTTP 500/);

    // 探活不写任何东西:缓存目录应该还是空的。
    await expect(
      readFile(join(dataDir, "pi-extensions", "sources", "good.json"), "utf8"),
    ).rejects.toThrow();
    // 也不该污染"每源状态"(那是刷新才有的东西)。
    expect(bridge.getSources().statuses).toEqual([]);
  });

  it("探活的输入也走严格校验(空 url 直接报错,而不是发一个空请求)", async () => {
    const dataDir = await makeDataDir();
    const bridge = createPiMarketBridge({ dataDir, fetchJson: async () => ({ version: 1, extensions: [] }) });
    await expect(bridge.probeSource({ id: "empty", url: "  " })).rejects.toThrow(/url is required/);
  });
});
