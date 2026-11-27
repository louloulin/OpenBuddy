// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appEnabled, collectApps } from "./catalog";
import { MAX_RECOMMENDATIONS, recommendApps } from "./recommend";
import { AppUsageStore, IDLE_DAYS, idleApps, recordAppUse, usageKey } from "./usage";
import type { AppEntry } from "./manifest";

const upup: AppEntry = {
  id: "upup", name: "upup", kind: "app", source: "pi", packageSource: "https://gitcode.com/lumosaigroup/upup.git",
  tagline: "证券智能投研助手", category: "finance",
  sceneList: [{ id: "q", name: "个股速览", prompt: "看一下 600519 的行情和估值" }],
};
const builtin: AppEntry = { id: "openbuddy", name: "OpenBuddy", kind: "app", source: "builtin", tagline: "通用智能助手" };

describe("collectApps (UP-2.2，宿主与引擎共用)", () => {
  it("内置第一，pi.app 包其次，读真实 package.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "ob-cat-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "upup", pi: { app: { kind: "app", category: "finance" } } }));
    expect(collectApps([{ source: dir, installedPath: dir }]).map((app) => app.id)).toEqual(["openbuddy", "upup"]);
  });

  it("资源过滤 extensions:false 视为停用", () => {
    expect(appEnabled(upup, [{ source: upup.packageSource!, filters: { extensions: false } }])).toBe(false);
    expect(appEnabled(upup, [{ source: upup.packageSource! }])).toBe(true);
    expect(appEnabled(builtin, [])).toBe(true);
  });
});

describe("会话内应用推荐 (UP-6.1)", () => {
  it("一句「查北向资金」命中金融应用，带命中词与首个场景", () => {
    const [rec] = recommendApps([builtin, upup], "帮我查一下今天北向资金的流向");
    expect(rec).toMatchObject({ appId: "upup", enabled: true, scene: { name: "个股速览" } });
    expect(rec!.matched).toContain("北向资金");
  });

  it("内置应用、当前应用、已拒绝的应用不推", () => {
    expect(recommendApps([builtin, upup], "茅台股价", { currentAppId: "upup" })).toEqual([]);
    expect(recommendApps([builtin, upup], "茅台股价", { dismissed: ["upup"] })).toEqual([]);
    expect(recommendApps([builtin], "通用智能助手")).toEqual([]);
  });

  it("没有命中就不推；停用的应用带 enabled:false", () => {
    expect(recommendApps([builtin, upup], "帮我写一封感谢信")).toEqual([]);
    expect(recommendApps([upup], "基金净值", { enabled: () => false })[0]?.enabled).toBe(false);
  });

  it("最多 3 个候选", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ ...upup, id: `fin-${i}`, name: `fin-${i}` }));
    expect(recommendApps(many, "股票行情")).toHaveLength(MAX_RECOMMENDATIONS);
  });
});

describe("应用使用统计与治理 (UP-6.4)", () => {
  const now = new Date("2026-11-27T10:00:00Z");

  it("按日聚合：同一天重复记录不写盘；键优先用安装目录，没有时用去掉 @ref 的来源", () => {
    expect(usageKey({ packageSource: `${upup.packageSource}@abc` })).toBe(upup.packageSource);
    expect(usageKey({ packageSource: "../rel/finapp", installedPath: "/abs/finapp" })).toBe("/abs/finapp");
    const state = recordAppUse({ lastUsed: {}, kept: {} }, usageKey(upup), now)!;
    expect(state.lastUsed).toEqual({ [upup.packageSource!]: "2026-11-27" });
    expect(recordAppUse(state, usageKey(upup), now)).toBeNull();
  });

  it(`≥${IDLE_DAYS} 天未用才提醒；从没用过按安装时间算；不知道安装时间不提醒`, () => {
    const fresh = { lastUsed: { [upup.packageSource!]: "2026-11-20" }, kept: {} };
    expect(idleApps([upup], fresh, now)).toEqual([]);
    const stale = { lastUsed: { [upup.packageSource!]: "2026-11-01" }, kept: {} };
    expect(idleApps([upup], stale, now)[0]).toMatchObject({ appId: "upup", idleDays: 26, lastUsedAt: "2026-11-01" });
    expect(idleApps([upup], { lastUsed: {}, kept: {} }, now)).toEqual([]);
    expect(idleApps([upup], { lastUsed: {}, kept: {} }, now, { installedAt: () => "2026-10-01T00:00:00Z" })[0]).toMatchObject({ lastUsedAt: null, idleDays: 57 });
  });

  it("「保留」后 14 天内不提醒；停用的应用与内置应用不提醒", () => {
    const stale = { lastUsed: { [upup.packageSource!]: "2026-10-01" }, kept: { [upup.packageSource!]: "2026-11-20" } };
    expect(idleApps([upup], stale, now)).toEqual([]);
    expect(idleApps([upup], { ...stale, kept: {} }, now, { enabled: () => false })).toEqual([]);
    expect(idleApps([builtin], stale, now)).toEqual([]);
  });

  it("AppUsageStore 落盘：touch / keep / forget", () => {
    const store = new AppUsageStore(mkdtempSync(join(tmpdir(), "ob-usage-")));
    store.touch(upup.packageSource!, now);
    expect(store.read().lastUsed[upup.packageSource!]).toBe("2026-11-27");
    store.keep(upup.packageSource!, now);
    expect(store.read().kept[upup.packageSource!]).toBe("2026-11-27");
    store.forget(upup.packageSource!);
    expect(store.read()).toEqual({ lastUsed: {}, kept: {} });
  });
});
