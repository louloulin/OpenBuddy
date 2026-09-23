import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { usePiMarketPage, PI_DEFAULT_PAGE_SIZE } from "../usePiMarketPage";
import type { MarketplaceEntry } from "../../marketplace-model";

const ENTRIES: MarketplaceEntry[] = Array.from({ length: 120 }).map((_, index) => ({
  id: `pkg-${index}`,
  name: `Package ${index.toString().padStart(3, "0")}`,
  publisher: index % 2 === 0 ? "alice" : "bob",
  description: index % 3 === 0 ? "matchable keyword mcp" : "generic",
  version: `1.0.${index}`,
  kinds: ["extension"],
  primaryKind: "extension",
  downloadsLastMonth: 1000 - index,
  updatedAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
}));

afterEach(() => {
  // No global state to reset; hook stores its own state.
});

describe("usePiMarketPage", () => {
  it("defaults to downloads sort + page 1 + 50 per page", () => {
    const { result } = renderHook(() => usePiMarketPage(ENTRIES));
    expect(result.current.sort).toBe("downloads");
    expect(result.current.pageSize).toBe(PI_DEFAULT_PAGE_SIZE);
    expect(result.current.page).toBe(1);
    expect(result.current.total).toBe(120);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.rangeStart).toBe(1);
    expect(result.current.rangeEnd).toBe(50);
    expect(result.current.visible).toHaveLength(50);
    // downloads sort: highest first
    expect(result.current.visible[0].downloadsLastMonth).toBe(1000);
  });

  it("filters by query against description + name + publisher", () => {
    const { result } = renderHook(() => usePiMarketPage(ENTRIES));
    act(() => result.current.setQuery("mcp"));
    // Every 3rd entry matches "mcp" => 40 entries
    expect(result.current.total).toBe(40);
  });

  it("filters by type", () => {
    const { result } = renderHook(() =>
      usePiMarketPage([
        ...ENTRIES,
        {
          id: "theme-x",
          name: "Theme X",
          publisher: "alice",
          description: "x",
          version: "1.0.0",
          kinds: ["theme"],
          primaryKind: "theme",
        },
      ]),
    );
    act(() => result.current.setTypeFilter("theme"));
    expect(result.current.total).toBe(1);
    expect(result.current.visible[0].id).toBe("theme-x");
  });

  it("sorts by recent", () => {
    const { result } = renderHook(() => usePiMarketPage(ENTRIES));
    act(() => result.current.setSort("recent"));
    // ENTRIES are constructed with timestamps increasing by 1 second per index;
    // recent sort = largest timestamp first => index 119 first
    expect(result.current.visible[0].id).toBe("pkg-119");
  });

  it("sorts by name A-Z", () => {
    const { result } = renderHook(() => usePiMarketPage(ENTRIES));
    act(() => result.current.setSort("name"));
    expect(result.current.visible[0].id).toBe("pkg-0");
    expect(result.current.visible[1].id).toBe("pkg-1");
  });

  it("clamps page when changing filters", () => {
    const { result } = renderHook(() => usePiMarketPage(ENTRIES));
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
    act(() => result.current.setQuery("mcp"));
    expect(result.current.page).toBe(1);
  });

  it("uses provided searchBlob when present", () => {
    const { result } = renderHook(() =>
      usePiMarketPage([
        {
          id: "x",
          name: "Anything",
          publisher: "anyone",
          description: "anything",
          version: "1.0.0",
          kinds: ["plugin"],
          primaryKind: "plugin",
          searchBlob: "needle-only",
        },
      ]),
    );
    act(() => result.current.setQuery("needle"));
    expect(result.current.total).toBe(1);
    act(() => result.current.setQuery("something-else"));
    expect(result.current.total).toBe(0);
  });

  it("reset clears query + type + sort + page", () => {
    const { result } = renderHook(() => usePiMarketPage(ENTRIES));
    act(() => result.current.setQuery("mcp"));
    act(() => result.current.setSort("name"));
    act(() => result.current.setPage(2));
    act(() => result.current.reset());
    expect(result.current.query).toBe("");
    expect(result.current.sort).toBe("downloads");
    expect(result.current.page).toBe(1);
  });

  it("falls back to page 1 when initialPage is NaN or invalid", () => {
    const { result } = renderHook(() =>
      usePiMarketPage(ENTRIES, { initialPage: Number.NaN }),
    );
    expect(result.current.page).toBe(1);
    expect(Number.isFinite(result.current.page)).toBe(true);
    expect(Number.isFinite(result.current.rangeStart)).toBe(true);
    expect(Number.isFinite(result.current.rangeEnd)).toBe(true);
  });

  it("falls back to page 1 when setPage receives NaN", () => {
    const { result } = renderHook(() => usePiMarketPage(ENTRIES));
    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);
    act(() => result.current.setPage(Number.NaN));
    expect(result.current.page).toBe(1);
  });

  it("clamps a fractional initialPage down to integer (1.9 -> 1)", () => {
    const { result } = renderHook(() =>
      usePiMarketPage(ENTRIES, { initialPage: 1.9 }),
    );
    expect(result.current.page).toBe(1);
  });

  it("sorts by 'oldest' = updatedAt ascending (R88-2)", () => {
    // ENTRIES 数组构造方式:index 0 → 1 秒前的 ISO,index N → N 秒前。
    // 所以"老"是 index 最大的,N=119 是最老的;0 是最新的。
    // 因此 oldest 排序后,visible 第一张应该是 index 119(最老)。
    const { result } = renderHook(() =>
      usePiMarketPage(ENTRIES, { initialSort: "oldest", pageSize: 200 }),
    );
    expect(result.current.visible[0]?.id).toBe(ENTRIES[ENTRIES.length - 1].id);
    expect(result.current.visible[result.current.visible.length - 1]?.id).toBe(ENTRIES[0].id);
  });
});
