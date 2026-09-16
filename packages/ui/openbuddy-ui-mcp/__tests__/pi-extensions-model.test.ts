/**
 * pi-extensions-model — 「Pi 扩展」区块的纯逻辑回归。
 *
 * 覆盖三件事:
 *   1. 桥接层条目 → 市场 UI 条目的投影(字段不能悄悄丢);
 *   2. 安装状态 / 分组(同一份数据要呈现成三种语义);
 *   3. 错误码 → 补救动作(这张表是 UI 里唯一读错误码的地方)。
 */
import { describe, expect, it } from "vitest";
import { PI_MARKET_ERROR_CODES } from "@openbuddy/shared-types";
import type { PiMarketEntryView, PiMarketSourceStatus } from "@openbuddy/shared-types";
import {
  describePiMarketError,
  groupPiMarketEntries,
  installStateOf,
  mirrorLabel,
  sourceChips,
  sourceLabel,
  summarizeSources,
  toMarketplaceEntry,
} from "../src/pi-extensions-model";

function entry(partial: Partial<PiMarketEntryView> = {}): PiMarketEntryView {
  return {
    id: "demo",
    name: "Demo",
    publisher: "openbuddy",
    description: "演示",
    version: "1.1.0",
    versions: ["1.0.0", "1.1.0"],
    kinds: ["extension"],
    capabilities: [{ id: "tools.demo", risk: "low" }],
    manifest: { schema: "openbuddy.plugin.v1", id: "demo", version: "1.1.0" },
    ...partial,
  };
}

describe("toMarketplaceEntry", () => {
  it("搬运 UI 会读的全部字段,并补上 kind / capability 契约", () => {
    const mapped = toMarketplaceEntry(
      entry({
        installedVersion: "1.0.0",
        updateAvailable: true,
        homepage: "https://example.com",
        installedBytes: 2048,
        dependencies: ["other"],
      }),
    );
    expect(mapped).toMatchObject({
      id: "demo",
      name: "Demo",
      publisher: "openbuddy",
      version: "1.1.0",
      kinds: ["extension"],
      capabilities: [{ id: "tools.demo", risk: "low" }],
      installedVersion: "1.0.0",
      homepage: "https://example.com",
      installedBytes: 2048,
      dependencies: ["other"],
    });
  });

  it("缺省字段不会写成 undefined 键(否则 UI 会渲染出空行)", () => {
    const mapped = toMarketplaceEntry(entry());
    expect("installedVersion" in mapped).toBe(false);
    expect("homepage" in mapped).toBe(false);
    expect("installedBytes" in mapped).toBe(false);
    expect("incompatible" in mapped).toBe(false);
  });

  it("manifest 不进市场条目(渲染端只关心版本与能力)", () => {
    expect("manifest" in toMarketplaceEntry(entry())).toBe(false);
  });
});

describe("installStateOf", () => {
  it("未安装 → available", () => {
    expect(installStateOf(entry())).toBe("available");
  });

  it("已安装且无更新 → installed", () => {
    expect(installStateOf(entry({ installedVersion: "1.1.0", updateAvailable: false }))).toBe(
      "installed",
    );
  });

  it("已安装且有更新 → update-available", () => {
    expect(installStateOf(entry({ installedVersion: "1.0.0", updateAvailable: true }))).toBe(
      "update-available",
    );
  });

  it("引擎区间不兼容优先于一切(blocked)", () => {
    expect(
      installStateOf(entry({ installedVersion: "1.0.0", updateAvailable: true, incompatible: true })),
    ).toBe("blocked");
  });
});

describe("groupPiMarketEntries", () => {
  it("每条只落进一个组,组内保持原顺序", () => {
    const groups = groupPiMarketEntries([
      entry({ id: "a", installedVersion: "1.0.0", updateAvailable: true }),
      entry({ id: "b", installedVersion: "1.1.0", updateAvailable: false }),
      entry({ id: "c" }),
      entry({ id: "d", incompatible: true }),
    ]);
    expect(groups.updatable.map((item) => item.id)).toEqual(["a"]);
    expect(groups.installed.map((item) => item.id)).toEqual(["b"]);
    expect(groups.available.map((item) => item.id)).toEqual(["c"]);
    expect(groups.blocked.map((item) => item.id)).toEqual(["d"]);
    const total =
      groups.updatable.length +
      groups.installed.length +
      groups.available.length +
      groups.blocked.length;
    expect(total).toBe(4);
  });
});

describe("来源标注", () => {
  it("sourceId=local 显示成「本地索引」", () => {
    expect(sourceLabel(entry({ sourceId: "local" }))).toBe("本地索引");
    expect(sourceLabel(entry({ sourceId: "corp" }))).toBe("corp");
    expect(sourceLabel(entry())).toBeUndefined();
  });

  it("有镜像时给出「亦有镜像」文案", () => {
    expect(mirrorLabel(entry({ alsoOfferedBy: ["mirror-a", "mirror-b"] }))).toBe(
      "亦有镜像:mirror-a / mirror-b",
    );
    expect(mirrorLabel(entry({ alsoOfferedBy: [] }))).toBeUndefined();
  });
});

describe("sourceChips / summarizeSources", () => {
  const status = (partial: Partial<PiMarketSourceStatus>): PiMarketSourceStatus => ({
    id: "src",
    weight: 0,
    state: "fresh",
    entryCount: 3,
    ...partial,
  });

  it("有刷新报告时用权威的每源状态", () => {
    const chips = sourceChips([entry()], [
      status({ id: "official", label: "官方", state: "fresh", entryCount: 10 }),
      status({ id: "mirror", state: "cached", entryCount: 4 }),
    ]);
    expect(chips).toEqual([
      { id: "official", label: "官方", state: "fresh", entryCount: 10 },
      { id: "mirror", label: "mirror", state: "cached", entryCount: 4 },
    ]);
  });

  it("没有刷新报告时从条目反推(不为几个 chip 强制联网)", () => {
    const chips = sourceChips([
      entry({ id: "a", sourceId: "corp" }),
      entry({ id: "b", sourceId: "corp" }),
      entry({ id: "c" }),
    ]);
    expect(chips).toEqual([
      { id: "corp", label: "corp", entryCount: 2 },
      { id: "local", label: "本地索引", entryCount: 1 },
    ]);
  });

  it("cached 与 failed 分开提示(一个是可用状态,一个要用户去修源)", () => {
    const cached = summarizeSources([status({ id: "a", state: "cached" })]);
    expect(cached).toMatchObject({ cached: 1, failed: 0 });
    expect(cached.warning).toContain("已用上次缓存");

    const failed = summarizeSources([status({ id: "a", state: "failed" })]);
    expect(failed.warning).toContain("没有缓存");

    const empty = summarizeSources([status({ id: "a", state: "fresh" })]);
    expect(empty.warning).toBeUndefined();

    const mixed = summarizeSources([
      status({ id: "a", state: "cached" }),
      status({ id: "b", state: "failed" }),
    ]);
    expect(mixed.warning).toContain("已用上次缓存");
    expect(mixed.warning).toContain("没有缓存");
    expect(mixed.warning).toContain("；");
  });

  it("undefined 状态不炸", () => {
    expect(summarizeSources(undefined)).toMatchObject({ fresh: 0, failed: 0 });
    expect(summarizeSources(undefined).warning).toBeUndefined();
  });
});

describe("describePiMarketError", () => {
  it("每个已知错误码都有专门的补救动作,不会落进兜底", () => {
    for (const code of PI_MARKET_ERROR_CODES) {
      const action = describePiMarketError({ code, detail: "raw" });
      expect(action.title, `code=${code}`).not.toBe("操作失败");
      expect(action.hint.length).toBeGreaterThan(0);
    }
  });

  it("需要用户换动作的错误不可重试,源/网络问题可重试", () => {
    expect(describePiMarketError({ code: "consent-required", detail: "" }).retryable).toBe(false);
    expect(describePiMarketError({ code: "incompatible", detail: "" }).retryable).toBe(false);
    expect(describePiMarketError({ code: "corrupt-install", detail: "" }).retryable).toBe(false);
    expect(describePiMarketError({ code: "not-found", detail: "" }).retryable).toBe(true);
    expect(describePiMarketError({ code: "invalid-registry", detail: "" }).retryable).toBe(true);
  });

  it("未知错误原样透出原文,不吞信息", () => {
    const action = describePiMarketError({ code: "unknown", detail: "socket hang up" });
    expect(action.title).toBe("操作失败");
    expect(action.hint).toBe("socket hang up");
  });
});
