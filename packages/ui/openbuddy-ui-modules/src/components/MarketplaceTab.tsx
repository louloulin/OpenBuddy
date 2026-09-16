/**
 * MarketplaceTab — 插件/技能/扩展/MCP/主题 的整版面浏览器。
 *
 * 完全 props 驱动:数据、查询、类型过滤与安装动作都由宿主提供;组件自身
 * 只维护「表现层偏好」(排序、能力过滤、网格/列表),因此既可以被
 * ui-modules 的 slot 宿主直接挂载,也能被第三方面板复用。
 *
 * 过滤与排序规则集中在 `marketplace-model`,组件内不做业务判断。
 */
import { useMemo, useState } from "react";
import {
  INSTALL_STATE_LABELS,
  MARKETPLACE_KINDS,
  MARKETPLACE_KIND_LABELS,
  MARKETPLACE_SORT_LABELS,
  collectCapabilityIds,
  collectKindFacets,
  selectMarketplaceEntries,
  type InstallState,
  type MarketplaceEntry,
  type MarketplaceKind,
  type MarketplaceSortKey,
} from "./marketplace-model";
import { MarketplaceCard, type MarketplaceMenuItem } from "./MarketplaceCard";
import styles from "./MarketplaceTab.module.css";

export interface MarketplaceTabProps {
  entries: readonly MarketplaceEntry[];
  loading?: boolean;
  error?: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  kindFilter: readonly MarketplaceKind[];
  onKindFilterChange: (kinds: readonly MarketplaceKind[]) => void;
  onOpenItem?: (entry: MarketplaceEntry) => void;
  onInstall?: (entry: MarketplaceEntry) => void;
  /** 重试加载(错误态按钮)。缺省时错误态只展示文案。 */
  onRetry?: () => void;
  /** 升级已有安装。缺省时回落到 onInstall。 */
  onUpgrade?: (entry: MarketplaceEntry) => void;
  /** 回滚到上一版本。 */
  onRollback?: (entry: MarketplaceEntry) => void;
  /** 正在安装的条目 id 集合,用于把卡片切到 installing 态。 */
  installingIds?: readonly string[];
  /** 当前选择的能力过滤(受控)。 */
  capabilityFilter?: readonly string[];
  onCapabilityFilterChange?: (capabilities: readonly string[]) => void;
  /** 当前安装状态过滤(受控)。 */
  installStateFilter?: readonly InstallState[];
  onInstallStateFilterChange?: (states: readonly InstallState[]) => void;
  /** 卡片溢出菜单(由宿主注入业务动作)。 */
  menuItems?: readonly MarketplaceMenuItem[];
  /** 空态文案覆盖。 */
  emptyTitle?: string;
  emptyHint?: string;
  className?: string;
}

export function MarketplaceTab(props: MarketplaceTabProps) {
  const {
    entries,
    loading,
    error,
    query,
    onQueryChange,
    kindFilter,
    onKindFilterChange,
    onOpenItem,
    onInstall,
    onRetry,
    onUpgrade,
    onRollback,
    installingIds,
    capabilityFilter,
    onCapabilityFilterChange,
    installStateFilter,
    onInstallStateFilterChange,
    menuItems,
    emptyTitle,
    emptyHint,
    className,
  } = props;

  const [sort, setSort] = useState<MarketplaceSortKey>("relevance");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [localCapabilities, setLocalCapabilities] = useState<readonly string[]>([]);
  const [localStates, setLocalStates] = useState<readonly InstallState[]>([]);

  const activeCapabilities = capabilityFilter ?? localCapabilities;
  const activeStates = installStateFilter ?? localStates;

  const setCapabilities = (next: readonly string[]) => {
    if (capabilityFilter === undefined) setLocalCapabilities(next);
    onCapabilityFilterChange?.(next);
  };
  const setStates = (next: readonly InstallState[]) => {
    if (installStateFilter === undefined) setLocalStates(next);
    onInstallStateFilterChange?.(next);
  };

  const installing = useMemo(() => new Set(installingIds ?? []), [installingIds]);
  const facets = useMemo(() => collectKindFacets(entries), [entries]);
  const capabilityOptions = useMemo(() => collectCapabilityIds(entries), [entries]);
  const visible = useMemo(
    () =>
      selectMarketplaceEntries(
        entries,
        {
          query,
          kinds: kindFilter,
          capabilities: activeCapabilities,
          installStates: activeStates,
        },
        sort,
      ),
    [entries, query, kindFilter, activeCapabilities, activeStates, sort],
  );

  const toggleKind = (kind: MarketplaceKind) => {
    const next = kindFilter.includes(kind)
      ? kindFilter.filter((item) => item !== kind)
      : [...kindFilter, kind];
    onKindFilterChange(next);
  };

  const toggleCapability = (capability: string) => {
    setCapabilities(
      activeCapabilities.includes(capability)
        ? activeCapabilities.filter((item) => item !== capability)
        : [...activeCapabilities, capability],
    );
  };

  const toggleState = (state: InstallState) => {
    setStates(
      activeStates.includes(state)
        ? activeStates.filter((item) => item !== state)
        : [...activeStates, state],
    );
  };

  const hasFilter =
    query.trim().length > 0 ||
    kindFilter.length > 0 ||
    activeCapabilities.length > 0 ||
    activeStates.length > 0;

  return (
    <section
      className={[styles.root, className].filter(Boolean).join(" ")}
      data-testid="marketplace-tab"
    >
      <header className={styles.toolbar}>
        <div className={styles.searchRow}>
          <span className={styles.searchIcon} aria-hidden>
            ⌕
          </span>
          <input
            type="search"
            className={styles.search}
            value={query}
            placeholder="搜索插件、技能、能力…"
            aria-label="搜索市场"
            data-testid="marketplace-search"
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className={styles.clear}
              onClick={() => onQueryChange("")}
              aria-label="清空搜索"
            >
              ✕
            </button>
          ) : null}
        </div>
        <div className={styles.controls}>
          <label className={styles.control}>
            <span className={styles.controlLabel}>排序</span>
            <select
              className={styles.select}
              value={sort}
              onChange={(event) => setSort(event.target.value as MarketplaceSortKey)}
              data-testid="marketplace-sort"
            >
              {(Object.keys(MARKETPLACE_SORT_LABELS) as MarketplaceSortKey[]).map((key) => (
                <option key={key} value={key}>
                  {MARKETPLACE_SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.viewToggle} role="group" aria-label="视图">
            <button
              type="button"
              className={[styles.viewButton, view === "grid" ? styles.viewActive : ""].join(" ")}
              aria-pressed={view === "grid"}
              onClick={() => setView("grid")}
              data-testid="marketplace-view-grid"
            >
              网格
            </button>
            <button
              type="button"
              className={[styles.viewButton, view === "list" ? styles.viewActive : ""].join(" ")}
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
              data-testid="marketplace-view-list"
            >
              列表
            </button>
          </div>
        </div>
      </header>

      <div className={styles.kindRow} role="group" aria-label="类型过滤">
        {MARKETPLACE_KINDS.map((kind) => {
          const count = facets.find((facet) => facet.kind === kind)?.count ?? 0;
          const active = kindFilter.includes(kind);
          return (
            <button
              key={kind}
              type="button"
              className={[styles.chip, active ? styles.chipActive : ""].join(" ")}
              aria-pressed={active}
              disabled={count === 0 && !active}
              onClick={() => toggleKind(kind)}
              data-testid={`marketplace-kind-${kind}`}
            >
              {MARKETPLACE_KIND_LABELS[kind]}
              <span className={styles.chipCount}>{count}</span>
            </button>
          );
        })}
        {hasFilter ? (
          <button
            type="button"
            className={styles.reset}
            onClick={() => {
              onQueryChange("");
              onKindFilterChange([]);
              setCapabilities([]);
              setStates([]);
            }}
            data-testid="marketplace-reset"
          >
            重置筛选
          </button>
        ) : null}
      </div>

      {capabilityOptions.length > 0 || activeStates.length > 0 ? (
        <div className={styles.facetRow}>
          {capabilityOptions.length > 0 ? (
            <details className={styles.facet} open={activeCapabilities.length > 0}>
              <summary className={styles.facetSummary}>
                能力{activeCapabilities.length > 0 ? `(${activeCapabilities.length})` : ""}
              </summary>
              <div className={styles.facetBody}>
                {capabilityOptions.map((capability) => (
                  <label key={capability} className={styles.facetItem}>
                    <input
                      type="checkbox"
                      checked={activeCapabilities.includes(capability)}
                      onChange={() => toggleCapability(capability)}
                    />
                    <span>{capability}</span>
                  </label>
                ))}
              </div>
            </details>
          ) : null}
          <details className={styles.facet} open={activeStates.length > 0}>
            <summary className={styles.facetSummary}>
              安装状态{activeStates.length > 0 ? `(${activeStates.length})` : ""}
            </summary>
            <div className={styles.facetBody}>
              {(Object.keys(INSTALL_STATE_LABELS) as InstallState[]).map((state) => (
                <label key={state} className={styles.facetItem}>
                  <input
                    type="checkbox"
                    checked={activeStates.includes(state)}
                    onChange={() => toggleState(state)}
                  />
                  <span>{INSTALL_STATE_LABELS[state]}</span>
                </label>
              ))}
            </div>
          </details>
        </div>
      ) : null}

      <div className={styles.content} data-testid="marketplace-content">
        {loading ? (
          <div className={styles.grid} aria-busy="true" data-testid="marketplace-loading">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={styles.skeletonCard}>
                <div className={styles.skeletonLine} />
                <div className={styles.skeletonLineShort} />
                <div className={styles.skeletonLine} />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className={styles.state} role="alert" data-testid="marketplace-error">
            <p className={styles.stateTitle}>市场加载失败</p>
            <p className={styles.stateHint}>{error}</p>
            {onRetry ? (
              <button
                type="button"
                className={styles.stateAction}
                onClick={onRetry}
                data-testid="marketplace-retry"
              >
                重试
              </button>
            ) : null}
          </div>
        ) : visible.length === 0 ? (
          <div className={styles.state} data-testid="marketplace-empty">
            <p className={styles.stateTitle}>
              {emptyTitle ?? (hasFilter ? "没有匹配的条目" : "市场还是空的")}
            </p>
            <p className={styles.stateHint}>
              {emptyHint ??
                (hasFilter ? "试试放宽筛选条件或换一个关键词。" : "添加一个市场源,或稍后刷新。")}
            </p>
          </div>
        ) : (
          <div
            className={view === "grid" ? styles.grid : styles.list}
            data-testid="marketplace-results"
          >
            {visible.map((entry) => (
              <MarketplaceCard
                key={entry.id}
                entry={entry}
                layout={view === "grid" ? "grid" : "list"}
                query={query}
                installing={installing.has(entry.id)}
                onOpen={onOpenItem}
                onInstall={onInstall}
                onUpgrade={onUpgrade ?? onInstall}
                onRollback={onRollback}
                menuItems={menuItems}
              />
            ))}
          </div>
        )}
      </div>

      <footer className={styles.footer} data-testid="marketplace-footer">
        共 {entries.length} 个条目 · 当前展示 {visible.length} 个
      </footer>
    </section>
  );
}
