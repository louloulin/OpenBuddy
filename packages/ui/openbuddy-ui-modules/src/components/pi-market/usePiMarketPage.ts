/**
 * usePiMarketPage — Pi-market 的纯逻辑 hook:接受 entries + 当前 query/type/sort/page,
 * 返回 filtered/sorted/paginated 结果 + 分页元数据。
 *
 * 不依赖 React(除 useState/useMemo/useCallback),不调 IPC,纯派生。
 * 宿主可配合 URL search params 做 deep-link,也可独立使用。
 */
import { useCallback, useMemo, useState } from "react";
import type { MarketplaceEntry, MarketplaceKind } from "../marketplace-model";
import { buildSearchBlob } from "./format";
import type { PiMarketSortKey } from "./PiMarketToolbar";

export const PI_DEFAULT_PAGE_SIZE = 50;

export interface UsePiMarketPageOptions {
  initialQuery?: string;
  initialType?: MarketplaceKind | "all";
  initialSort?: PiMarketSortKey;
  initialPage?: number;
  pageSize?: number;
  /**
   * 外部传入的 query 覆盖值(controlled 模式)。
   * 提供时,filter 流水线使用本字段而非内部 state,便于 host 实现
   * "toolbar 实时显示输入,但 list 用 debounced query 过滤" 的 UI。
   * toolbar 仍可通过 setQuery 更新内部 state(用户编辑时立刻能看到),
   * debounced 版本在下一次 effect tick 接管 filter。
   *
   * 不传时维持原行为(filter 用内部 query state)。
   */
  queryOverride?: string;
}

export interface UsePiMarketPageResult {
  query: string;
  typeFilter: MarketplaceKind | "all";
  sort: PiMarketSortKey;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
  visible: MarketplaceEntry[];
  setQuery: (next: string) => void;
  setTypeFilter: (next: MarketplaceKind | "all") => void;
  setSort: (next: PiMarketSortKey) => void;
  setPage: (next: number) => void;
  reset: () => void;
}

function compareNumbersDesc(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return b - a;
}

function compareIsoDesc(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? 1 : -1;
}

function compareTextAsc(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base" });
}

function compareDownloadsDesc(a: MarketplaceEntry, b: MarketplaceEntry): number {
  const verdict = compareNumbersDesc(a.downloadsLastMonth, b.downloadsLastMonth);
  if (verdict !== 0) return verdict;
  return compareTextAsc(a.name, b.name);
}

function compareRecentDesc(a: MarketplaceEntry, b: MarketplaceEntry): number {
  const verdict = compareIsoDesc(a.updatedAt, b.updatedAt);
  if (verdict !== 0) return verdict;
  return compareTextAsc(a.name, b.name);
}

function compareNameAsc(a: MarketplaceEntry, b: MarketplaceEntry): number {
  return compareTextAsc(a.name, b.name);
}

function blobFor(entry: MarketplaceEntry): string {
  if (entry.searchBlob) return entry.searchBlob;
  return buildSearchBlob([entry.name, entry.publisher, entry.description]);
}

function matchesQuery(blob: string, needle: string): boolean {
  if (!needle) return true;
  if (!blob) return false;
  for (const token of needle.split(/\s+/).filter(Boolean)) {
    if (!blob.includes(token)) return false;
  }
  return true;
}

function matchesType(entry: MarketplaceEntry, type: MarketplaceKind | "all"): boolean {
  if (type === "all") return true;
  const primary = entry.primaryKind ?? entry.kinds[0];
  if (primary === type) return true;
  return entry.kinds.includes(type);
}

export function usePiMarketPage(
  entries: readonly MarketplaceEntry[],
  options: UsePiMarketPageOptions = {},
): UsePiMarketPageResult {
  const pageSize = Math.max(1, options.pageSize ?? PI_DEFAULT_PAGE_SIZE);
  const [query, setQueryState] = useState(options.initialQuery ?? "");
  // Controlled 旁路:host 显式传 queryOverride 时,filter 用它而不是内部 state。
  // 注意:toolbar 仍绑内部 query,用户敲键盘能立刻看到输入;filter 滞后到 debounce
  // 触发后跟上,这是符合直觉的 debounce 行为。
  const effectiveQuery = options.queryOverride ?? query;
  const [typeFilter, setTypeFilterState] = useState<MarketplaceKind | "all">(
    options.initialType ?? "all",
  );
  const [sort, setSortState] = useState<PiMarketSortKey>(options.initialSort ?? "downloads");
  const [page, setPageState] = useState(() => {
    const initial = options.initialPage ?? 1;
    return Number.isFinite(initial) && initial >= 1 ? Math.floor(initial) : 1;
  });

  const filtered = useMemo(() => {
    const needle = effectiveQuery.trim().toLowerCase();
    // 一次性给所有 entry 算好 blob(searchBlob 缺失时回退到 buildSearchBlob),
    // 否则大列表(>=几千条)每个 keystroke 都会重建 N 个 blob。
    const blobs = entries.map(blobFor);
    return entries.filter((entry, index) =>
      matchesQuery(blobs[index], needle) && matchesType(entry, typeFilter),
    );
  }, [entries, effectiveQuery, typeFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    switch (sort) {
      case "recent":
        copy.sort(compareRecentDesc);
        break;
      case "oldest":
        // Oldest first = 升序(老 → 新);R88-2 新加。
        copy.sort((a, b) => compareIsoDesc(a.updatedAt, b.updatedAt) * -1);
        break;
      case "name":
        copy.sort(compareNameAsc);
        break;
      case "downloads":
      default:
        copy.sort(compareDownloadsDesc);
        break;
    }
    return copy;
  }, [filtered, sort]);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // 兜底防御:page 状态可能被外部注入 NaN / undefined(URL params / JSON 解析失败),
  // 一律回退到 1,避免 sort/pageStart/visible 全部变 NaN。
  const finitePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const safePage = Math.min(finitePage, totalPages);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, total);
  const visible = useMemo(
    () => sorted.slice(rangeStart - 1, rangeEnd),
    [sorted, rangeStart, rangeEnd],
  );

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setPageState(1);
  }, []);
  const setTypeFilter = useCallback((next: MarketplaceKind | "all") => {
    setTypeFilterState(next);
    setPageState(1);
  }, []);
  const setSort = useCallback((next: PiMarketSortKey) => {
    setSortState(next);
    setPageState(1);
  }, []);
  const setPage = useCallback((next: number) => {
    setPageState(Number.isFinite(next) && next >= 1 ? Math.floor(next) : 1);
  }, []);
  const reset = useCallback(() => {
    setQueryState("");
    setTypeFilterState("all");
    setSortState("downloads");
    setPageState(1);
  }, []);

  return {
    query,
    typeFilter,
    sort,
    page: safePage,
    pageSize,
    total,
    totalPages,
    rangeStart,
    rangeEnd,
    visible,
    setQuery,
    setTypeFilter,
    setSort,
    setPage,
    reset,
  };
}
