/**
 * PiMarketToolbar — pi.dev/packages 风格的工具栏:
 *   Hero 一行简介 + 安装命令 + 搜索框 + 类型 select + 排序 select + 分页 1..N。
 *
 * 纯 props 组件,所有数据/动作由宿主注入;URL 同步、来源刷新由宿主 hook
 * (`usePiMarketPage`)承担。组件本身只关心键盘可达 + a11y 语义。
 */
import { useId, type RefObject } from "react";
import { formatDownloads, formatRelative } from "./format";
import type { MarketplaceEntry, MarketplaceKind } from "../marketplace-model";
import { MARKETPLACE_KIND_LABELS } from "../marketplace-model";
import styles from "./PiMarketToolbar.module.css";

export type PiMarketSortKey = "downloads" | "recent" | "name" | "oldest";

export interface PiMarketToolbarLabels {
  /** Hero 区下方小字,例如 "Extensions, skills, prompt templates, and themes..." */
  blurb: string;
  /** 安装命令前的提示,例如 "Install with" */
  installHint: string;
  searchPlaceholder: string;
  allTypesLabel: string;
  sortByLabel: string;
  /** "1-50 / 5697" 这种。 */
  paginationLabel: (rangeStart: number, rangeEnd: number, total: number) => string;
  previousLabel: string;
  nextLabel: string;
}

export const DEFAULT_LABELS: PiMarketToolbarLabels = {
  blurb:
    "Extensions, skills, prompt templates, and themes published to npm. Install with pi install npm:<package>.",
  installHint: "Install with",
  searchPlaceholder: "按名称、描述或作者筛选扩展包",
  allTypesLabel: "All types",
  sortByLabel: "Sort packages",
  paginationLabel: (rangeStart, rangeEnd, total) =>
    total === 0 ? "0 packages" : `${rangeStart}-${rangeEnd} / ${total}`,
  previousLabel: "上一页",
  nextLabel: "下一页",
};

export interface PiMarketToolbarProps {
  query: string;
  onQueryChange: (next: string) => void;
  typeFilter: MarketplaceKind | "all";
  onTypeFilterChange: (next: MarketplaceKind | "all") => void;
  sort: PiMarketSortKey;
  onSortChange: (next: PiMarketSortKey) => void;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (next: number) => void;
  /** 包总数估算,用于 "1-N / TOTAL" 文案。 */
  entrySample?: MarketplaceEntry;
  labels?: Partial<PiMarketToolbarLabels>;
  /** 来源信息(R83 多源);若提供则在 install 命令末尾附 ` · source:<name>`。 */
  sourceHint?: string;
  /** 搜索 input 的 ref,供 host (R86 快捷键)直接 focus。 */
  searchInputRef?: RefObject<HTMLInputElement>;
  className?: string;
}

export function PiMarketToolbar(props: PiMarketToolbarProps) {
  const labels: PiMarketToolbarLabels = { ...DEFAULT_LABELS, ...(props.labels ?? {}) };
  const {
    query,
    onQueryChange,
    typeFilter,
    onTypeFilterChange,
    sort,
    onSortChange,
    page,
    pageSize,
    total,
    onPageChange,
    entrySample,
    sourceHint,
    searchInputRef,
    className,
  } = props;

  const searchId = useId();
  const typeId = useId();
  const sortId = useId();

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const downloadHint = entrySample?.downloadsLastMonth;
  const recentHint = entrySample?.updatedAt;
  const types: ReadonlyArray<MarketplaceKind | "all"> = [
    "all",
    "extension",
    "skill",
    "theme",
    "prompt",
    "mcp",
    "plugin",
  ];

  return (
    <header className={[styles.root, className].filter(Boolean).join(" ")} data-testid="pi-market-toolbar" role="search" aria-label="筛选 Pi 扩展">
      <div className={styles.hero}>
        <h1 className={styles.title}>Package Catalog</h1>
        <p className={styles.blurb}>
          {labels.blurb}
          {" "}
          <code className={styles.code}>pi install npm:&lt;package&gt;</code>
          {sourceHint ? (
            <>
              {" · "}
              <span className={styles.sourceHint} data-testid="pi-market-source-hint">
                source: {sourceHint}
              </span>
            </>
          ) : null}
        </p>
      </div>

      <div className={styles.controls}>
        <div className={styles.control}>
          <label className={styles.label} htmlFor={searchId}>
            Filter packages
          </label>
          <div className={styles.searchWrap}>
            <input
              id={searchId}
              type="search"
              className={styles.search}
              placeholder={labels.searchPlaceholder}
              ref={searchInputRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  onQueryChange("");
                }
              }}
              data-testid="pi-market-search"
              aria-label={labels.searchPlaceholder}
            />
            {query ? (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => onQueryChange("")}
                aria-label="清除筛选"
                data-testid="pi-market-search-clear"
              >
                ×
              </button>
            ) : null}
          </div>
        </div>

        <div className={styles.control}>
          <label className={styles.label} htmlFor={typeId}>
            {labels.allTypesLabel === "All types" ? "Filter by package type" : labels.allTypesLabel}
          </label>
          <select
            id={typeId}
            className={styles.select}
            value={typeFilter}
            onChange={(event) => onTypeFilterChange(event.target.value as MarketplaceKind | "all")}
            data-testid="pi-market-type-filter"
          >
            {types.map((kind) => (
              <option key={kind} value={kind}>
                {kind === "all" ? labels.allTypesLabel : MARKETPLACE_KIND_LABELS[kind as MarketplaceKind] ?? kind}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.control}>
          <label className={styles.label} htmlFor={sortId}>
            {labels.sortByLabel}
          </label>
          <select
            id={sortId}
            className={styles.select}
            value={sort}
            onChange={(event) => onSortChange(event.target.value as PiMarketSortKey)}
            data-testid="pi-market-sort"
          >
            <option value="downloads">Most downloads</option>
            <option value="recent">Recently published</option>
            <option value="name">A-Z</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>

        <div className={styles.hints} aria-live="polite">
          {downloadHint !== undefined ? (
            <span className={styles.hintChip}>
              <span className={styles.hintLabel}>top:</span>{" "}
              {formatDownloads(downloadHint) ?? `${downloadHint}/mo`}
            </span>
          ) : null}
          {recentHint ? (
            <span className={styles.hintChip}>
              <span className={styles.hintLabel}>latest:</span>{" "}
              {formatRelative(recentHint) ?? "—"}
            </span>
          ) : null}
        </div>
      </div>

      <nav className={styles.pagination} aria-label="Pi 扩展分页">
        <span className={styles.range} data-testid="pi-market-range">
          {labels.paginationLabel(rangeStart, rangeEnd, total)}
        </span>
        {/* total === 0 时 pager 控件无意义,隐藏 prev / next / indicator。 */}
        {total > 0 ? (
          <div className={styles.pageButtons}>
            <button
              type="button"
              className={styles.pageButton}
              disabled={page <= 1}
              onClick={() => onPageChange(Math.max(1, page - 1))}
              data-testid="pi-market-page-prev"
            >
              ← {labels.previousLabel}
            </button>
            <span className={styles.pageIndicator} aria-current="page">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              className={styles.pageButton}
              disabled={page >= totalPages}
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
              data-testid="pi-market-page-next"
            >
              {labels.nextLabel} →
            </button>
          </div>
        ) : null}
      </nav>
    </header>
  );
}
