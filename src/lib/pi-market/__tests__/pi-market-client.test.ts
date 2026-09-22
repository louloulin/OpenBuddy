// @vitest-environment jsdom
/**
 * pi-market-client — renderer wrapper 的**契约回归**测试。
 *
 * 为什么这个文件存在:这套 wrapper 从 R18 到 R32 一直是坏的,而且类型检查
 * 抓不到 —— 因为它自己手写了一份和 main 漂移的类型(install 写成 `{ ok, lock }`),
 * 而当时没有任何 UI 消费它。R32 接 UI 时才发现:如果 UI 顺着那份类型去读
 * `result.ok`,**每次安装都会读到 `undefined`**。
 *
 * 所以这里不做 mock 断言:直接把 wrapper 接到**真实的 bridge handler** 上
 * (内存里建 bridge,`window.api.invoke` 转发到 `createPiMarketHandlers`),
 * 断言「wrapper 的返回值形状 == UI 真正会读的字段」。任何一侧再漂移都会红。
 */
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PI_MARKET_IPC_CHANNELS,
  createPiMarketBridge,
  createPiMarketHandlers,
} from "../../../../electron/main/agent/pi-market-bridge";
import {
  PI_MARKET_CHANNELS,
  auditPiMarket,
  installPiMarket,
  listPiMarket,
  lockfilePiMarket,
  piMarketErrorInfo,
  refreshPiMarket,
  rollbackPiMarket,
  uninstallPiMarket,
  upgradePiMarket,
} from "../pi-market-client";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "openbuddy-pi-market-client-"));
  tempDirs.push(dir);
  return dir;
}

function extension(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    publisher: "openbuddy",
    description: `${id} 演示扩展`,
    version: "1.0.0",
    versions: ["1.0.0", "1.1.0"],
    kinds: ["extension"],
    capabilities: [{ id: `tools.${id}`, risk: "low" }],
    files: { "openbuddy.plugin.json": JSON.stringify({ schema: "openbuddy.plugin.v1", id }) },
    ...extra,
  };
}

async function writeRegistry(dataDir: string, entries: unknown[]): Promise<void> {
  const root = join(dataDir, "pi-extensions");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "registry.json"), JSON.stringify({ version: 1, extensions: entries }));
}

/** 把 `window.api.invoke` 接到真实 handler 表上 —— 渲染端到 main 的最短真链路。 */
function wireRealHandlers(dataDir: string): void {
  const bridge = createPiMarketBridge({ dataDir, hostVersion: "0.15.0" });
  const handlers = createPiMarketHandlers(bridge) as Record<
    string,
    (args?: unknown) => Promise<unknown>
  >;
  (window as unknown as { api: unknown }).api = {
    apiVersion: 1,
    invoke: async (channel: string, args?: unknown) => {
      const handler = handlers[channel];
      if (!handler) throw new Error(`no handler for ${channel}`);
      return await handler(args);
    },
  };
}

describe("PI_MARKET_CHANNELS", () => {
  it("与 main 的 channel 表逐条一致(漂移会直接读错返回值)", () => {
    expect(PI_MARKET_CHANNELS).toEqual(PI_MARKET_IPC_CHANNELS);
  });
});

describe("wrapper 的返回值形状 == UI 会读的字段", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await makeDataDir();
    await writeRegistry(dataDir, [
      extension("demo.one"),
      extension("demo.risky", {
        capabilities: [{ id: "fs.write", risk: "high" }],
      }),
    ]);
    wireRealHandlers(dataDir);
  });

  it("list 返回 { entries },条目带 sourceId(本地索引)", async () => {
    const result = await listPiMarket();
    expect(Array.isArray(result.entries)).toBe(true);
    expect(result.entries.map((entry) => entry.id).sort()).toEqual(["demo.one", "demo.risky"]);
    for (const entry of result.entries) {
      expect(entry.sourceId).toBe("local");
      expect(typeof entry.installedVersion === "string" || entry.installedVersion === undefined).toBe(
        true,
      );
    }
  });

  it("install 返回 PiMarketInstallResult —— 不是 { ok, lock }", async () => {
    const result = await installPiMarket({ id: "demo.one" });
    expect(result).toMatchObject({ id: "demo.one", version: "1.0.0", changed: true });
    // 旧 wrapper 把返回值写成 `{ ok: true, lock }`;UI 顺那份类型读 `ok` 会拿到
    // undefined 并静默当成「安装失败」。这条断言把它钉死。
    expect((result as unknown as { ok?: unknown }).ok).toBeUndefined();
    expect((result as unknown as { lock?: unknown }).lock).toBeUndefined();
    expect(typeof result.path).toBe("string");
    expect(result.capabilities).toContain("tools.demo.one");
  });

  it("upgrade 跟着索引的推荐版本走;已经是推荐版本时 changed=false(不是错误)", async () => {
    await installPiMarket({ id: "demo.one", version: "1.0.0" });
    // 索引把 1.1.0 标成推荐版本(不是 versions 里的最大值 —— 推荐版本由源声明)。
    await writeRegistry(dataDir, [
      extension("demo.one", { version: "1.1.0", versions: ["1.0.0", "1.1.0"] }),
      extension("demo.risky", { capabilities: [{ id: "fs.write", risk: "high" }] }),
    ]);
    const upgraded = await upgradePiMarket({ id: "demo.one" });
    expect(upgraded).toMatchObject({ id: "demo.one", version: "1.1.0", changed: true });
    expect(upgraded.previousVersion).toBe("1.0.0");

    const again = await upgradePiMarket({ id: "demo.one" });
    expect(again).toMatchObject({ id: "demo.one", version: "1.1.0", changed: false });
  });

  it("rollback 回到上一个版本并报告 previousVersion", async () => {
    await installPiMarket({ id: "demo.one", version: "1.0.0" });
    await installPiMarket({ id: "demo.one", version: "1.1.0" });
    const result = await rollbackPiMarket({ id: "demo.one" });
    expect(result).toMatchObject({ id: "demo.one", version: "1.0.0" });
    expect(result.previousVersion).toBe("1.1.0");
  });

  it("uninstall 真的把记录摘掉,并汇报删了哪些版本", async () => {
    await installPiMarket({ id: "demo.one", version: "1.0.0" });
    await installPiMarket({ id: "demo.one", version: "1.1.0" });
    const result = await uninstallPiMarket({ id: "demo.one" });
    expect(result).toMatchObject({ id: "demo.one", version: "1.1.0", payloadKept: false });
    expect(result.removedVersions.slice().sort()).toEqual(["1.0.0", "1.1.0"]);

    const lock = await lockfilePiMarket();
    expect(Object.keys(lock.extensions)).toEqual([]);
    const trail = await auditPiMarket({ limit: 10 });
    // audit 是按追加顺序返回的:最后一条才是这次卸载。
    expect(trail.entries.at(-1)).toMatchObject({ action: "uninstall", outcome: "success" });
  });

  it("uninstall 的 keepPayload 只摘记录,载荷目录留在磁盘上", async () => {
    await installPiMarket({ id: "demo.one" });
    const result = await uninstallPiMarket({ id: "demo.one", keepPayload: true });
    expect(result).toMatchObject({ id: "demo.one", payloadKept: true, removedVersions: [] });
    expect(Object.keys((await lockfilePiMarket()).extensions)).toEqual([]);
  });

  it("uninstall 不存在的扩展 → not-found(经过 wrapper 也能取回码)", async () => {
    const error = await uninstallPiMarket({ id: "ghost" }).catch((e: unknown) => e);
    expect(piMarketErrorInfo(error).code).toBe("not-found");
  });

  it("lockfile 的 key 才是 id(条目里没有多余 id 字段)", async () => {
    await installPiMarket({ id: "demo.one" });
    const lock = await lockfilePiMarket();
    expect(Object.keys(lock.extensions)).toEqual(["demo.one"]);
    expect(lock.extensions["demo.one"]).toMatchObject({ version: "1.0.0" });
    expect((lock.extensions["demo.one"] as unknown as { id?: unknown }).id).toBeUndefined();
  });

  it("audit 返回 { entries },action 只用 install/upgrade/rollback/uninstall/refresh", async () => {
    await installPiMarket({ id: "demo.one" });
    const result = await auditPiMarket({ limit: 10 });
    expect(Array.isArray(result.entries)).toBe(true);
    expect(result.entries.length).toBeGreaterThan(0);
    const actions = new Set(result.entries.map((entry) => entry.action));
    for (const action of actions) {
      expect(["install", "upgrade", "rollback", "uninstall", "refresh"]).toContain(action);
    }
    // 旧 wrapper 把字段名写成 `events`。
    expect((result as unknown as { events?: unknown }).events).toBeUndefined();
  });

  it("refresh 返回 PiMarketRefreshReport(带 count / source,不带 entries)", async () => {
    const report = await refreshPiMarket();
    expect(typeof report.count).toBe("number");
    expect(typeof report.updatedAt).toBe("string");
    expect(["local", "remote"]).toContain(report.source);
    expect((report as unknown as { entries?: unknown }).entries).toBeUndefined();
  });
});

describe("错误码穿过 IPC", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await makeDataDir();
    await writeRegistry(dataDir, [
      extension("demo.risky", { capabilities: [{ id: "fs.write", risk: "high" }] }),
    ]);
    wireRealHandlers(dataDir);
  });

  it("高风险能力未同意时 reject,且渲染端能取回 consent-required", async () => {
    const error = await installPiMarket({ id: "demo.risky" }).catch((e: unknown) => e);
    const info = piMarketErrorInfo(error);
    expect(info.code).toBe("consent-required");
    // detail 是给用户看的原文,不该再带机器码前缀。
    expect(info.detail).not.toContain("pi-market[");
    expect(info.detail).toContain("high-risk");
  });

  it("同一个调用在勾选同意后成功", async () => {
    const result = await installPiMarket({ id: "demo.risky", allowHighRisk: true });
    expect(result).toMatchObject({ id: "demo.risky", changed: true });
  });

  it("不认识的错误归类为 unknown,并保留原始文案", () => {
    const info = piMarketErrorInfo(new Error("boom"));
    expect(info.code).toBe("unknown");
    expect(info.detail).toBe("boom");
  });
});
