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
import type {
  PiMarketEntryView,
  PiMarketSourceStatus,
  PiMarketSourcesView,
} from "@openbuddy/shared-types";
import {
  blankSourceDraft,
  describePiMarketError,
  describeProbeResult,
  groupPiMarketEntries,
  installStateOf,
  mirrorLabel,
  moveSourceDraft,
  sourceChips,
  sourceDraftsDirty,
  sourceLabel,
  sourceStateLabel,
  sourcesToDrafts,
  summarizeSources,
  toMarketplaceEntry,
  validateSourceDrafts,
  type PiSourceDraft,
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

// ---------------------------------------------------------------------------
// R35 — 源管理编辑态模型
// ---------------------------------------------------------------------------

function sourcesView(partial: Partial<PiMarketSourcesView> = {}): PiMarketSourcesView {
  return {
    file: [],
    effective: [],
    filePath: "/data/pi-extensions/sources.json",
    readonlySourceIds: [],
    statuses: [],
    ...partial,
  };
}

function draft(partial: Partial<PiSourceDraft> = {}): PiSourceDraft {
  return { ...blankSourceDraft(), ...partial };
}

describe("R35 源管理:sourcesToDrafts", () => {
  it("只读源排在最前,文件源在后,且带上一次刷新的每源状态", () => {
    const rows = sourcesToDrafts(
      sourcesView({
        readonlySourceIds: ["deployed"],
        effective: [
          { id: "deployed", url: "https://deployed.example/i.json", weight: 10 },
          { id: "file", url: "https://file.example/i.json" },
        ],
        file: [{ id: "file", url: "https://file.example/i.json" }],
        statuses: [
          {
            id: "file",
            url: "https://file.example/i.json",
            weight: 0,
            state: "cached",
            entryCount: 7,
            error: "socket hang up",
          },
        ],
      }),
    );
    expect(rows.map((row) => row.id)).toEqual(["deployed", "file"]);
    expect(rows[0].readonly).toBe(true);
    expect(rows[1].readonly).toBe(false);
    expect(rows[1].status).toBe("cached");
    expect(rows[1].entryCount).toBe(7);
    expect(rows[1].error).toBe("socket hang up");
  });

  it("同 id 的文件源不会重复出现(生效的是只读那一份)", () => {
    const rows = sourcesToDrafts(
      sourcesView({
        readonlySourceIds: ["dup"],
        effective: [{ id: "dup", url: "https://deployed.example/i.json" }],
        file: [{ id: "dup", url: "https://hijack.example/i.json" }],
      }),
    );
    expect(rows.map((row) => row.url)).toEqual(["https://deployed.example/i.json"]);
  });

  it("数字字段保持字符串:输入框里的半成品不该在 onChange 里被悄悄变成 0", () => {
    const rows = sourcesToDrafts(
      sourcesView({ file: [{ id: "w", url: "https://w.example/i.json", weight: 5, timeoutMs: 1500 }] }),
    );
    expect(rows[0].weight).toBe("5");
    expect(rows[0].timeoutMs).toBe("1500");
  });
});

describe("R35 源管理:validateSourceDrafts", () => {
  it("坏行给出**行号**,而不是整表报错", () => {
    const result = validateSourceDrafts([
      draft({ id: "ok", url: "https://ok.example/i.json" }),
      draft({ url: "" }),
      draft({ url: "not a url" }),
      draft({ url: "https://x.example/i.json", weight: "abc" }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.rows[1]).toBe("源地址必填");
    expect(result.errors.rows[2]).toBe("不是合法的 URL 或绝对路径");
    expect(result.errors.rows[3]).toBe("权重必须是数字");
    // 第一行是好的 —— 行号必须精确,否则用户要去猜是哪一行。
    expect(result.errors.rows[0]).toBeUndefined();
  });

  it("重复 id 报在后出现的那一行", () => {
    const result = validateSourceDrafts([
      draft({ id: "same", url: "https://a.example/i.json" }),
      draft({ id: "same", url: "https://b.example/i.json" }),
    ]);
    expect(result.errors.rows[1]).toBe("id 重复:same");
  });

  it("只读行不参与校验、也不进提交载荷", () => {
    const result = validateSourceDrafts([
      draft({ id: "deployed", url: "", readonly: true }),
      draft({ id: "file", url: "https://file.example/i.json" }),
    ]);
    expect(result.ok).toBe(true);
    expect(result.sources.map((item) => item.id)).toEqual(["file"]);
  });

  it("没写 id 时按 host + path 派生;label / trusted / 超时都保留", () => {
    const result = validateSourceDrafts([
      draft({ url: "https://mirror.example.com/pi/index.json", label: " 镜像 ", trusted: true, weight: "3", timeoutMs: "1500" }),
    ]);
    expect(result.sources).toEqual([
      {
        id: "mirror.example.com-pi-index",
        url: "https://mirror.example.com/pi/index.json",
        label: "镜像",
        weight: 3,
        trusted: true,
        timeoutMs: 1500,
      },
    ]);
  });

  it("同一个 host 上的两个索引拿到不同 id(否则 UI 会报一个用户看不懂的重复)", () => {
    const result = validateSourceDrafts([
      draft({ url: "https://mirror.corp/pi/stable.json" }),
      draft({ url: "https://mirror.corp/pi/nightly.json" }),
    ]);
    expect(result.ok).toBe(true);
    expect(result.sources.map((item) => item.id)).toEqual([
      "mirror.corp-pi-stable",
      "mirror.corp-pi-nightly",
    ]);
  });

  it("绝对路径也是合法源(main 侧同样接受非 URL 输入)", () => {
    const result = validateSourceDrafts([draft({ url: "/srv/pi/index.json" })]);
    expect(result.ok).toBe(true);
    expect(result.sources[0].id).toBe("local-srv-pi-index");
    // 显式写 id 时以用户写的为准。
    expect(validateSourceDrafts([draft({ id: "local", url: "/srv/pi/index.json" })]).sources[0].id).toBe("local");
  });
});

describe("R35 源管理:脏检查与排序", () => {
  it("改一个字就算脏;改回原样就不脏", () => {
    const saved = [{ id: "a", url: "https://a.example/i.json", weight: 1 }];
    expect(sourceDraftsDirty(sourcesToDrafts(sourcesView({ file: saved })), saved)).toBe(false);
    const edited = sourcesToDrafts(sourcesView({ file: saved }));
    edited[0] = { ...edited[0], label: "镜像" };
    expect(sourceDraftsDirty(edited, saved)).toBe(true);
    edited[0] = { ...edited[0], label: "" };
    expect(sourceDraftsDirty(edited, saved)).toBe(false);
  });

  it("权重相同时声明顺序决定优先级,所以顺序本身是可编辑语义", () => {
    const rows = [
      draft({ id: "a", url: "https://a.example/i.json" }),
      draft({ id: "b", url: "https://b.example/i.json" }),
    ];
    expect(moveSourceDraft(rows, 1, -1).map((row) => row.id)).toEqual(["b", "a"]);
    // 越界的移动是 no-op(不抛错,也不产生空位)。
    expect(moveSourceDraft(rows, 0, -1).map((row) => row.id)).toEqual(["a", "b"]);
    expect(moveSourceDraft(rows, 1, 1).map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("只读行不可移动 —— 让用户拖动会让人以为改了优先级", () => {
    const rows = [
      draft({ id: "deployed", url: "https://d.example/i.json", readonly: true }),
      draft({ id: "file", url: "https://f.example/i.json" }),
    ];
    expect(moveSourceDraft(rows, 1, -1).map((row) => row.id)).toEqual(["deployed", "file"]);
  });
});

describe("R35 源管理:状态与探活文案", () => {
  it("每源状态有短标签", () => {
    expect(sourceStateLabel("fresh")).toBe("已拉取");
    expect(sourceStateLabel("cached")).toBe("用缓存");
    expect(sourceStateLabel("failed")).toBe("不可达");
    expect(sourceStateLabel(undefined)).toBeUndefined();
  });

  it("探活文案区分可达/不可达,并把样例条目名带出来", () => {
    expect(describeProbeResult({ ok: true, entryCount: 12, sampleId: "demo.alpha" })).toBe(
      "可达:12 条,例如 demo.alpha",
    );
    expect(describeProbeResult({ ok: false, entryCount: 0, error: "HTTP 404" })).toBe("不可达:HTTP 404");
    expect(describeProbeResult({ ok: false, entryCount: 0 })).toBe("不可达:未知错误");
  });
});

