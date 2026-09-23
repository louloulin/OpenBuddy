/**
 * PiMarketTab — 复刻 pi.dev/packages 的整版面。
 *
 * 结构:
 *   1. PiMarketToolbar (标题 + blurb + 安装命令 + 搜索/类型/排序 + 分页)
 *   2. PiRecentlyPublished(顶部最近 7 条)
 *   3. 主列表 (PiPackageCard × N)
 *
 * 所有状态在 usePiMarketPage 中;本组件只关心 a11y 语义 + 事件转发。
 * `usePiMarketLayout=true` 时由 MarketplacePanel 选中。
 */
import { useEffect, useMemo, useRef } from "react";
import type { MarketplaceEntry } from "../marketplace-model";
import { PiMarketToolbar, type PiMarketToolbarLabels } from "./PiMarketToolbar";
import { PiPackageCard } from "./PiPackageCard";
import { PiRecentlyPublished } from "./PiRecentlyPublished";
import { usePiMarketPage, type UsePiMarketPageOptions } from "./usePiMarketPage";
import { writePiMarketUrlState } from "./usePiMarketUrlState";
import { usePiMarketShortcuts } from "./usePiMarketShortcuts";
import { usePiMarketRovingFocus } from "./usePiMarketRovingFocus";
import { useDebouncedValue } from "./useDebouncedValue";
import styles from "./PiMarketTab.module.css";

export interface PiMarketTabProps {
  entries: readonly MarketplaceEntry[];
  loading?: boolean;
  error?: string | null;
  onOpenItem?: (entry: MarketplaceEntry) => void;
  onInstall?: (entry: MarketplaceEntry) => void;
  onCopied?: (entry: MarketplaceEntry, command: string) => void;
  onRetry?: () => void;
  /** 当前正在安装/升级的 entry id 列表,这些卡片的 Install 按钮会被 disabled 并显示 "Installing…"。 */
  installingIds?: readonly string[];
  /** 把 usePiMarketPage 的 options 透传(初值、pageSize)。 */
  hookOptions?: UsePiMarketPageOptions;
  /** 把 toolbar 的文案覆盖透传。 */
  labels?: Partial<PiMarketToolbarLabels>;
  /**
   * 是否把 query / type / sort / page 同步到 window.location.search;
   * 默认 false(向后兼容,不污染旧宿主 URL)。需要分享 / 书签时打开。
   */
  urlSync?: boolean;
  /** 最近发布卡片最多展示多少条;默认 7(pi.dev 同)。 */
  recentMax?: number;
  /**
   * 搜索框 query 的 debounce 延迟(ms);默认 200。
   * - 影响派生列表(过滤 / 排序);
   * - 影响 URL state 写入(每次 query 变化重写整个 window.location.search,
   *   不 debounce 会引起地址栏频繁闪动 + history.replaceState 抖动)。
   * 设为 0 关闭 debounce(用于测试或 host 想立即响应的场景)。
   */
  queryDebounceMs?: number;
  /** 多源信息(主源名),用于 toolbar 与卡片 source: 标注。 */
  sourceHint?: string;
  /** 数据为空时仍展示 Recently published?默认 true。 */
  showRecentWhenEmpty?: boolean;
  className?: string;
}

export function PiMarketTab(props: PiMarketTabProps) {
  const {
    entries,
    loading,
    error,
    onOpenItem,
    onInstall,
    onCopied,
    onRetry,
    installingIds,
    hookOptions,
    labels,
    sourceHint,
    showRecentWhenEmpty = true,
    className,
    urlSync,
    recentMax,
    queryDebounceMs = 200,
  } = props;

  const pageState = usePiMarketPage(entries, hookOptions);
  // R88-1:debounce query 仅用于 URL state 写入,filter 用内部 query 实时更新。
  // filter 本身只是 .filter() + .sort()(blob 已预算),没必要 debounce;
  // history.replaceState + URL 解析每次 keystroke 都触发,debounce 后能把
  // 「敲 5 个字 = 5 次 URL 写」收敛到「5 次输入完成后 1 次写」,地址栏不闪、
  // history 不抖。toolbar 受控绑 pageState.query,200ms 在感知阈值以下。
  const debouncedQuery = useDebouncedValue(
    pageState.query,
    typeof window === "undefined" ? 0 : queryDebounceMs,
  );

  useEffect(() => {
    if (!urlSync) return;
    writePiMarketUrlState({
      initialQuery: debouncedQuery,
      initialType: pageState.typeFilter,
      initialSort: pageState.sort,
      initialPage: pageState.page,
    });
  }, [urlSync, debouncedQuery, pageState.typeFilter, pageState.sort, pageState.page]);

  // R86: 键盘快捷键:`/` 聚焦搜索,`g p` / `g P` 翻页;需要在 host 把焦点引到这里时启用。
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  usePiMarketShortcuts({
    enabled: urlSync !== false,
    focusSearch: () => {
      const input = searchInputRef.current;
      if (input) input.focus();
    },
    prevPage: pageState.totalPages > 1 ? () => pageState.setPage(pageState.page - 1) : undefined,
    nextPage: pageState.totalPages > 1 ? () => pageState.setPage(pageState.page + 1) : undefined,
  });

  // R87: 卡片键盘 roving focus(j/k 上下导航,Enter 触发 install,c 复制,o 打开外链)。
  const roving = usePiMarketRovingFocus({
    entries: pageState.visible,
    enabled: urlSync !== false,
    onActivate: (entry) => onInstall?.(entry),
    onCopy: (entry) => onCopied?.(entry, entry.installCommand ?? ""),
    onOpenLink: (entry, url) => {
      if (typeof window !== "undefined") {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    },
  });

  const sample = useMemo(() => entries[0], [entries]);

  const showRecent = showRecentWhenEmpty || entries.length > 0;

  return (
    <main
      className={[styles.root, className].filter(Boolean).join(" ")}
      data-testid="pi-market-tab"
    >
      <PiMarketToolbar
        query={pageState.query}
        onQueryChange={pageState.setQuery}
        typeFilter={pageState.typeFilter}
        onTypeFilterChange={pageState.setTypeFilter}
        sort={pageState.sort}
        onSortChange={pageState.setSort}
        page={pageState.page}
        pageSize={pageState.pageSize}
        total={pageState.total}
        onPageChange={pageState.setPage}
        searchInputRef={searchInputRef}
        {...(entrySample(sample))}
        {...(sourceHint ? { sourceHint } : {})}
        {...(labels ? { labels } : {})}
      />

      {showRecent ? (
        <PiRecentlyPublished
          entries={entries}
          onOpen={onOpenItem}
          max={recentMax ?? 7}
          query={pageState.query}
        />
      ) : null}

      <section className={styles.results} data-testid="pi-market-results" aria-label="All packages">
        {/*
          首次加载(没有 entries)才用骨架屏;之后 reload 时保留列表 + 顶部一行进度提示,
          避免滚动位置丢失 + 视觉闪一下。
        */}
        {loading && entries.length === 0 ? (
          <div className={styles.skeletons} aria-busy="true" data-testid="pi-market-loading">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={styles.skeleton} />
            ))}
          </div>
        ) : error ? (
          <div className={styles.state} role="alert" data-testid="pi-market-error">
            <p className={styles.stateTitle}>Couldn't load the catalog</p>
            <p className={styles.stateHint}>{error}</p>
            {onRetry ? (
              <button
                type="button"
                className={styles.stateAction}
                onClick={onRetry}
                data-testid="pi-market-retry"
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : pageState.visible.length === 0 ? (
          <div className={styles.state} data-testid="pi-market-empty">
            <p className={styles.stateTitle}>No matching packages</p>
            <p className={styles.stateHint}>
              Try a different keyword or relax the filter.
            </p>
            {pageState.query || pageState.typeFilter !== "all" || pageState.sort !== "downloads" ? (
              <button
                type="button"
                className={styles.stateAction}
                onClick={pageState.reset}
                data-testid="pi-market-clear-filters"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {loading ? (
              <div className={styles.refreshHint} role="status" aria-live="polite" data-testid="pi-market-refreshing">
                <span className={styles.refreshHintDot} aria-hidden />
                正在刷新索引…
              </div>
            ) : null}
            <ul className={styles.list} role="list">
            {pageState.visible.map((entry) => (
              <li key={entry.id} className={styles.listItem}>
                <PiPackageCard
                  entry={entry}
                  {...(onOpenItem ? { onOpen: onOpenItem } : {})}
                  {...(onInstall ? { onInstall } : {})}
                  {...(onCopied ? { onCopied } : {})}
                  query={pageState.query}
                  installing={installingIds ? installingIds.includes(entry.id) : false}
                  active={roving.activeId === entry.id}
                />
              </li>
            ))}
          </ul>
          </>
        )}
      </section>

      <footer className={styles.footer} data-testid="pi-market-footer">
        <span className={styles.footerText}>
          Showing {pageState.rangeStart}-{pageState.rangeEnd} of {pageState.total}
          {pageState.totalPages > 1 ? (
            <>
              {" · "}Page {pageState.page} of {pageState.totalPages}
            </>
          ) : null}
        </span>
        {pageState.totalPages > 1 ? (
          <nav className={styles.footerPager} aria-label="Pi 扩展分页(底部)">
            <button
              type="button"
              className={styles.footerPagerBtn}
              disabled={pageState.page <= 1}
              onClick={() => pageState.setPage(Math.max(1, pageState.page - 1))}
              data-testid="pi-market-page-prev-bottom"
              aria-label="上一页"
            >
              ← 上一页
            </button>
            <span className={styles.footerPagerInd} aria-current="page">
              {pageState.page} / {pageState.totalPages}
            </span>
            <button
              type="button"
              className={styles.footerPagerBtn}
              disabled={pageState.page >= pageState.totalPages}
              onClick={() => pageState.setPage(Math.min(pageState.totalPages, pageState.page + 1))}
              data-testid="pi-market-page-next-bottom"
              aria-label="下一页"
            >
              下一页 →
            </button>
          </nav>
        ) : null}
      </footer>
    </main>
  );
}

function entrySample(sample: MarketplaceEntry | undefined) {
  if (!sample) return {};
  return { entrySample: sample };
}
