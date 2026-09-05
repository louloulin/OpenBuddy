import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerKbProvider,
  unregisterKbProvider,
  rebuildAllKbProviders,
  recordIndexStats,
  getIndexStats,
  getAllIndexStats,
  listKbProvidersWithStats,
  resetKbRegistry,
  listKbProviders,
  searchKb,
  kbStats,
  type KbProvider,
} from "@openbuddy/files-kb";

/** 共享 provider 工厂(模块作用域,供所有 describe 使用)。 */
const provider = (
  id: string,
  entries: Array<{ id: string; title: string; snippet?: string }>,
  enabled = true,
  label?: string,
): KbProvider => ({
  id,
  label: label ?? id,
  isEnabled: () => enabled,
  list: (q) =>
    q ? entries.filter((e) => e.title.includes(q) || e.snippet?.includes(q)) : entries,
});

describe("knowledge-base 注册表", () => {
  beforeEach(resetKbRegistry);

  it("注册后可列出(仅启用)", () => {
    registerKbProvider(provider("local", [], true, "本地文件夹"));
    registerKbProvider(provider("cloud", [], false, "云端"));
    expect(listKbProviders()).toEqual([{ id: "local", label: "本地文件夹" }]);
  });

  it("同 id 不重复注册", () => {
    registerKbProvider(provider("a", []));
    registerKbProvider(provider("a", [{ id: "x", title: "X" }]));
    expect(listKbProviders()).toHaveLength(1);
  });

  it("unregisterKbProvider 按 id 移除并返回 true", () => {
    registerKbProvider(provider("a", []));
    registerKbProvider(provider("b", []));
    expect(unregisterKbProvider("a")).toBe(true);
    expect(listKbProviders().map((s) => s.id)).toEqual(["b"]);
  });

  it("unregisterKbProvider 不存在的 id 返回 false", () => {
    registerKbProvider(provider("a", []));
    expect(unregisterKbProvider("nope")).toBe(false);
    expect(listKbProviders()).toHaveLength(1);
  });

  it("rebuildAllKbProviders 调用每个启用 provider 的 rebuild,返回条目数", async () => {
    const rebuildA = vi.fn(async () => 3);
    const rebuildB = vi.fn(async () => 1);
    registerKbProvider({
      id: "a",
      label: "A",
      isEnabled: () => true,
      list: () => [],
      rebuild: rebuildA,
    });
    registerKbProvider({
      id: "b",
      label: "B",
      isEnabled: () => true,
      list: () => [],
      rebuild: rebuildB,
    });
    // 无 rebuild 能力的 provider 不计入。
    registerKbProvider({ id: "c", label: "C", isEnabled: () => true, list: () => [] });
    // 未启用的 provider 跳过。
    registerKbProvider({
      id: "d",
      label: "D",
      isEnabled: () => false,
      list: () => [],
      rebuild: vi.fn(),
    });
    const res = await rebuildAllKbProviders();
    expect(res).toEqual([
      { id: "a", count: 3 },
      { id: "b", count: 1 },
    ]);
    expect(rebuildA).toHaveBeenCalledTimes(1);
    expect(rebuildB).toHaveBeenCalledTimes(1);
  });

  it("rebuildAllKbProviders 无可重建 provider 返回空数组", async () => {
    registerKbProvider(provider("a", []));
    expect(await rebuildAllKbProviders()).toEqual([]);
  });

  it("rebuildAllKbProviders 记录索引状态(getIndexStats 可查)", async () => {
    registerKbProvider({
      id: "a",
      label: "A",
      isEnabled: () => true,
      list: () => [],
      rebuild: async () => 7,
    });
    await rebuildAllKbProviders();
    const stats = getIndexStats("a");
    expect(stats.fileCount).toBe(7);
    expect(typeof stats.lastRebuiltAt).toBe("number");
  });
});

describe("索引状态(recordIndexStats / getIndexStats / getAllIndexStats)", () => {
  beforeEach(resetKbRegistry);

  it("recordIndexStats / getIndexStats 读写", () => {
    recordIndexStats("a", 5);
    expect(getIndexStats("a")).toEqual({ fileCount: 5, lastRebuiltAt: expect.any(Number) });
  });

  it("getIndexStats 未记录返回空对象", () => {
    expect(getIndexStats("nope")).toEqual({});
  });

  it("getAllIndexStats 只返回已启用 provider", () => {
    registerKbProvider(provider("a", []));
    registerKbProvider(provider("b", [], false));
    recordIndexStats("a", 3);
    recordIndexStats("b", 9);
    const all = getAllIndexStats();
    expect(all.a.fileCount).toBe(3);
    expect(all.b).toBeUndefined(); // b 未启用,不计入
  });

  it("unregisterKbProvider 清除该 provider 的索引状态", () => {
    registerKbProvider(provider("a", []));
    recordIndexStats("a", 2);
    unregisterKbProvider("a");
    expect(getIndexStats("a")).toEqual({});
  });

  it("resetKbRegistry 清空索引状态", () => {
    registerKbProvider(provider("a", []));
    recordIndexStats("a", 2);
    resetKbRegistry();
    expect(getIndexStats("a")).toEqual({});
    expect(getAllIndexStats()).toEqual({});
  });
});

describe("listKbProvidersWithStats", () => {
  beforeEach(resetKbRegistry);

  it("聚合 provider 的 getStats + registry stats", async () => {
    registerKbProvider({
      id: "a",
      label: "A",
      isEnabled: () => true,
      list: () => [],
      getStats: async () => ({ fileCount: 4, lastRebuiltAt: 100 }),
    });
    const list = await listKbProvidersWithStats();
    expect(list).toHaveLength(1);
    expect(list[0].stats.fileCount).toBe(4);
    expect(list[0].stats.lastRebuiltAt).toBe(100);
  });

  it("无 getStats 的 provider 用 registry 记录(可能为空)", async () => {
    registerKbProvider(provider("a", []));
    recordIndexStats("a", 6);
    const list = await listKbProvidersWithStats();
    expect(list[0].stats.fileCount).toBe(6);
  });

  it("未启用 provider 不计入", async () => {
    registerKbProvider(provider("a", [], false));
    expect(await listKbProvidersWithStats()).toEqual([]);
  });
});

describe("searchKb / kbStats", () => {
  beforeEach(resetKbRegistry);

  it("searchKb 跨启用 provider 聚合,带 source 标识", async () => {
    registerKbProvider(provider("local", [{ id: "1", title: "笔记A", snippet: "内容" }]));
    registerKbProvider(provider("docs", [{ id: "2", title: "文档B" }]));
    const r = await searchKb("");
    expect(r).toHaveLength(2);
    expect(r.map((e) => e.source)).toEqual(["local", "docs"]);
  });

  it("searchKb 带 query 过滤", async () => {
    registerKbProvider(
      provider("local", [
        { id: "1", title: "React 笔记" },
        { id: "2", title: "Vue 笔记" },
      ]),
    );
    expect((await searchKb("React")).map((e) => e.title)).toEqual(["React 笔记"]);
  });

  it("provider 抛错不影响其它 provider", async () => {
    registerKbProvider({
      id: "bad",
      label: "bad",
      isEnabled: () => true,
      list: () => {
        throw new Error("boom");
      },
    });
    registerKbProvider(provider("good", [{ id: "1", title: "OK" }]));
    expect((await searchKb("")).map((e) => e.title)).toEqual(["OK"]);
  });

  it("kbStats 统计启用 provider 数 + 条目数", async () => {
    registerKbProvider(provider("a", [{ id: "1", title: "x" }, { id: "2", title: "y" }]));
    registerKbProvider(provider("b", [{ id: "3", title: "z" }], false));
    const s = await kbStats();
    expect(s.providers).toBe(1);
    expect(s.entries).toBe(2);
  });

  it("reset 清空", async () => {
    registerKbProvider(provider("a", []));
    resetKbRegistry();
    expect(listKbProviders()).toEqual([]);
    expect(await kbStats()).toEqual({ providers: 0, entries: 0 });
  });
});
