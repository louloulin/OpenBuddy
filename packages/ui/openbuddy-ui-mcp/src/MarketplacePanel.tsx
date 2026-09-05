/**
 * 市场面板 - 对接 pi 的 x.ai/marketplace/list + x.ai/marketplace/action
 *
 * 显示 pi 配置的所有插件市场源（marketplace sources）及其插件，
 * 支持安装/卸载/更新/刷新源 + 添加/移除源。
 * 对应 WorkBuddy 的 UnifiedMarketPage。
 *
 * 市场源配置在 ~/.pi/config.toml 的 [[marketplace.sources]] 段。
 */
import { useRef } from "react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Store,
  RefreshCw,
  PlusCircle,
  Trash2,
  Download,
  Check,
  X,
  Globe,
  Search as SearchIcon,
} from "lucide-react";
import {
  marketplaceAction,
  marketplaceList,
} from "@/lib/agent/pi-client";
import { confirm } from "@/lib/platform/electron-api";
import {
  findPiPackageCatalogEntry,
  type MarketplacePluginEntry,
  type MarketplaceScanResult,
  type PiPackageCatalogEntry,
} from "@openbuddy/shared-types";
import { describeMarketplaceResult } from "./marketplace-priority-toast";

interface MarketplacePanelProps {
  /** 当前会话 id(可选)。marketplace 操作是 profile 级别的,不需要活跃会话;
   *  保留这个 prop 是为了上层可以根据焦点上下文给安装/卸载附加 UI 提示。 */
  sessionId?: string;
  onToast?: (msg: string) => void;
}

export function MarketplacePanel({ sessionId: _sessionId, onToast }: MarketplacePanelProps) {
  const [sources, setSources] = useState<MarketplaceScanResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [addingSource, setAddingSource] = useState(false);
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // Phase R-PhaseB.4: marketplace 列表是 profile 级资源,不需要 sessionId。
      const resp = await marketplaceList();
      setSources(resp.sources ?? []);
    } catch (e) {
      onToast?.(`加载市场失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setLoading(false);
    }
   }, [onToast]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Phase R-PhaseB.4: marketplace 操作是 profile 级,无需活跃会话 —— 直接调用,
  // marketplaceAction 内部已经把 sessionId 改为可选(始终 null)。

  const handleInstall = useCallback(
    async (source: MarketplaceScanResult, plugin: MarketplacePluginEntry) => {
      const key = `${source.sourceName}/${plugin.name}`;
      setBusy(key);
      try {
        const result = await marketplaceAction(null, {
          type: "install",
          sourceUrlOrPath: source.sourceUrlOrPath,
          pluginRelativePath: plugin.relativePath,
        });
        onToast?.(describeMarketplaceResult(plugin.name, "install", result));
        reload();
      } catch (e) {
        onToast?.(`安装失败：${String(e).replace(/^Error:\s*/, "")}`);
      } finally {
        setBusy(null);
      }
    },
    [onToast, reload],
  );

  const handleUninstall = useCallback(
    async (source: MarketplaceScanResult, plugin: MarketplacePluginEntry) => {
      if (!confirm(`确定卸载「${plugin.name}」？`)) return;
      const key = `${source.sourceName}/${plugin.name}`;
      setBusy(key);
      try {
        const result = await marketplaceAction(null, {
          type: "uninstall",
          sourceUrlOrPath: source.sourceUrlOrPath,
          pluginRelativePath: plugin.relativePath,
        });
        onToast?.(describeMarketplaceResult(plugin.name, "uninstall", result));
        reload();
      } catch (e) {
        onToast?.(`卸载失败：${String(e).replace(/^Error:\s*/, "")}`);
      } finally {
        setBusy(null);
      }
    },
    [onToast, reload],
  );

  const handleUpdate = useCallback(
    async (source: MarketplaceScanResult, plugin: MarketplacePluginEntry) => {
      const key = `${source.sourceName}/${plugin.name}`;
      setBusy(key);
      try {
        const result = await marketplaceAction(null, {
          type: "update",
          sourceUrlOrPath: source.sourceUrlOrPath,
          pluginRelativePath: plugin.relativePath,
        });
        onToast?.(describeMarketplaceResult(plugin.name, "update", result));
        reload();
      } catch (e) {
        onToast?.(`更新失败：${String(e).replace(/^Error:\s*/, "")}`);
      } finally {
        setBusy(null);
      }
    },
    [onToast, reload],
  );

  const handleRefreshSource = useCallback(
    async (source?: MarketplaceScanResult) => {
      setBusy(`refresh:${source?.sourceName ?? "all"}`);
      try {
        await marketplaceAction(null, {
          type: "refresh",
          sourceUrlOrPath: source?.sourceUrlOrPath ?? null,
        });
        onToast?.(source ? `已刷新「${source.sourceName}」` : "已刷新所有源");
        reload();
      } catch (e) {
        onToast?.(`刷新失败：${String(e).replace(/^Error:\s*/, "")}`);
      } finally {
        setBusy(null);
      }
    },
    [onToast, reload],
  );

  const handleRemoveSource = useCallback(
    async (source: MarketplaceScanResult) => {
      if (!confirm(`确定移除市场源「${source.sourceName}」？已安装的插件不会被删除。`)) return;
      setBusy(`remove:${source.sourceName}`);
      try {
        await marketplaceAction(null, {
          type: "remove_source",
          sourceUrlOrPath: source.sourceUrlOrPath,
        });
        onToast?.(`已移除源「${source.sourceName}」`);
        reload();
      } catch (e) {
        onToast?.(`移除失败：${String(e).replace(/^Error:\s*/, "")}`);
      } finally {
        setBusy(null);
      }
    },
    [onToast, reload],
  );

  const handleAddSource = useCallback(async () => {
    const url = newSourceUrl.trim();
    if (!url) return;
    setBusy("add-source");
    try {
      await marketplaceAction(null, { type: "add_source", url });
      onToast?.(`已添加源 ${url}`);
      setNewSourceUrl("");
      setAddingSource(false);
      reload();
    } catch (e) {
      onToast?.(`添加失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(null);
    }
  }, [newSourceUrl, onToast, reload]);
  // Flatten all plugins across sources for the search box.
  // Memoized so a query keystroke doesn't force a full O(N) re-flatten —
  // scanning a 5,000-plugin marketplace re-allocates a fresh array on every
  // render and blows out the search latency budget.
  const allPlugins = useMemo(
    () =>
      sources.flatMap((s) =>
        s.plugins.map((p) => ({ source: s, plugin: p })),
      ),
    [sources],
  );
  const queryKey = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!queryKey) return allPlugins;
    return allPlugins.filter(
      ({ plugin }) =>
        plugin.name.toLowerCase().includes(queryKey) ||
        (plugin.description ?? "").toLowerCase().includes(queryKey) ||
        (plugin.category ?? "").toLowerCase().includes(queryKey) ||
        (plugin.tags ?? []).some((t) => t.toLowerCase().includes(queryKey)),
    );
  }, [allPlugins, queryKey]);

  const totalPlugins = allPlugins.length;
  const installedCount = useMemo(
    () =>
      allPlugins.reduce(
        (count, { plugin }) =>
          plugin.installStatus === "installed" ? count + 1 : count,
        0,
      ),
    [allPlugins],
  );
  // Sum the authoritative `totalPackages` from each remote source so the
  // header can advertise e.g. "远端共 5,573 个" even when the scan only
  // paginated the first ~50 cards into the visible list.
  const remoteTotalPackages = useMemo(
    () =>
      sources.reduce((sum, src) => {
        if (src.sourceKindValue !== "remote") return sum;
        const total = src.totalPackages;
        return sum + (typeof total === "number" && total > 0 ? total : 0);
      }, 0),
    [sources],
  );

  // Virtualized render of the per-source plugin list so a marketplace with
  // 5,000+ cards (e.g. the bundled pi.dev source) doesn't force the React
  // tree to mount every node up-front. Without this, the very first paint
  // pays ~700ms just to instantiate all the cards; with it, only the
  // ~20 cards inside the visible viewport are rendered.
  const pluginListScrollRef = useRef<HTMLDivElement>(null);
  const virtualRows = useMemo(
    () =>
      sources.flatMap((source) =>
        source.plugins.map((plugin) => ({ source, plugin })),
      ),
    [sources],
  );
  // The virtualizer renders the active list — either the filtered search
  // results (when the user is typing) or every plugin across all sources
  // (when they are browsing). A single virtualizer instance keeps the
  // scroll position and measurement caches stable across the two modes.
  const virtualCount = query ? filtered.length : virtualRows.length;
  const pluginVirtualizer = useVirtualizer({
    count: virtualCount,
    getScrollElement: () => pluginListScrollRef.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (index) => {
      const row = query ? filtered[index] : virtualRows[index];
      return row
        ? `${row.source.sourceUrlOrPath}/${row.plugin.relativePath}`
        : String(index);
    },
  });
  const virtualTotalHeight = pluginVirtualizer.getTotalSize();
  const virtualItems = pluginVirtualizer.getVirtualItems();

  return (
    <div className="marketplace-panel">
      <div className="marketplace-panel__header">
        <h2 className="marketplace-panel__title">市场</h2>
        <div className="marketplace-panel__actions">
          <button
            className="marketplace-panel__action-btn"
            onClick={() => handleRefreshSource()}
            disabled={loading || busy === "refresh:all"}
            title="刷新所有源"
          >
            <RefreshCw size={14} /> 刷新全部
          </button>
          <button
            className="marketplace-panel__action-btn marketplace-panel__action-btn--primary"
            onClick={() => setAddingSource((v) => !v)}
            title="添加本地市场目录"
          >
            <PlusCircle size={14} /> 添加源
          </button>
        </div>
      </div>

      {addingSource && (
        <div className="marketplace-panel__add-source">
          <input
            type="text"
            className="marketplace-panel__add-input"
              placeholder="https://pi.dev/packages 或本地路径"
            value={newSourceUrl}
            onChange={(e) => setNewSourceUrl(e.target.value)}
            autoFocus
          />
          <button
            className="marketplace-panel__action-btn marketplace-panel__action-btn--primary"
            onClick={handleAddSource}
            disabled={busy === "add-source" || !newSourceUrl.trim()}
          >
            {busy === "add-source" ? "添加中…" : "添加"}
          </button>
          <button
            className="marketplace-panel__action-btn"
            onClick={() => {
              setAddingSource(false);
              setNewSourceUrl("");
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="marketplace-panel__search">
        <SearchIcon size={16} className="marketplace-panel__search-icon" />
        <input
          type="text"
          className="marketplace-panel__search-input"
          placeholder="搜索插件…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="marketplace-panel__stats">
        {sources.length} 个源 · {totalPlugins} 个插件 · {installedCount} 已安装
        {remoteTotalPackages > 0
          ? ` · 远端共 ${remoteTotalPackages.toLocaleString("zh-CN")} 个`
          : ""}
      </div>

      {/* Phase R-PhaseB.4: marketplace 操作不再要求 session,移除顶部 hint。 */}

      {sources.length === 0 && !loading && (
        <div className="marketplace-panel__empty">
          <Store size={48} color="var(--wb-text-tertiary)" />
          <p>暂无市场源。</p>
          <p className="marketplace-panel__hint">
            点「添加源」输入本地市场目录，或在 config.toml 配置 <code>[[marketplace.sources]]</code>。
          </p>
        </div>
      )}

      {/* 按源分组展示（虚拟化） */}
      {!query && sources.length > 0 && (
        <div
          ref={pluginListScrollRef}
          className="marketplace-panel__virtual-scroll"
          style={{ height: "70vh", overflowY: "auto", position: "relative" }}
        >
          <div style={{ height: `${virtualTotalHeight}px`, position: "relative", width: "100%" }}>
            {virtualItems.map((vi) => {
              const row = virtualRows[vi.index];
              if (!row) return null;
              const { source, plugin } = row;
              return (
                <div
                  key={`${source.sourceUrlOrPath}/${plugin.relativePath}`}
                  style={{
                    position: "absolute",
                    top: `${vi.start}px`,
                    left: 0,
                    right: 0,
                    height: `${vi.size}px`,
                  }}
                >
                  <MarketplacePluginCard
                    plugin={plugin}
                    sourceName={source.sourceName}
                    busy={busy === `${source.sourceName}/${plugin.name}`}
                    onInstall={handleInstall}
                    onUninstall={handleUninstall}
                    onUpdate={handleUpdate}
                    sourceRef={source}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 搜索结果（扁平，虚拟化） */}
      {query && filtered.length > 0 && (
        <div
          ref={pluginListScrollRef}
          className="marketplace-panel__virtual-scroll"
          style={{ height: "70vh", overflowY: "auto", position: "relative", border: "1px solid #ddd" }}
        >
          <div style={{ height: `${filtered.length * 96}px`, position: "relative", width: "100%" }}>
            {(pluginVirtualizer.getVirtualItems() ?? []).map((vi) => {
              const row = filtered[vi.index];
              if (!row) return null;
              const { source, plugin } = row;
              return (
                <div
                  key={`${source.sourceUrlOrPath}/${plugin.relativePath}`}
                  style={{
                    position: "absolute",
                    top: `${vi.start}px`,
                    left: 0,
                    right: 0,
                    height: `${vi.size}px`,
                  }}
                >
                  <MarketplacePluginCard
                    plugin={plugin}
                    sourceName={source.sourceName}
                    busy={busy === `${source.sourceName}/${plugin.name}`}
                    onInstall={handleInstall}
                    onUninstall={handleUninstall}
                    onUpdate={handleUpdate}
                    sourceRef={source}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
      {query && filtered.length === 0 && !loading && (
        <div className="marketplace-panel__empty">无匹配的插件</div>
      )}
      {loading && <div className="marketplace-panel__empty">加载中…</div>}
    </div>
  );
}

const MarketplacePluginCard = memo(function MarketplacePluginCard({
  plugin,
  sourceName,
  busy,
  onInstall,
  onUninstall,
  onUpdate,
  sourceRef,
}: {
  plugin: MarketplacePluginEntry;
  sourceName?: string;
  busy: boolean;
  onInstall: (source: MarketplaceScanResult, plugin: MarketplacePluginEntry) => void;
  onUninstall: (source: MarketplaceScanResult, plugin: MarketplacePluginEntry) => void;
  onUpdate: (source: MarketplaceScanResult, plugin: MarketplacePluginEntry) => void;
  sourceRef: MarketplaceScanResult;
}) {
  const installed = plugin.installStatus === "installed";
  // UX-1: when the installed package maps to a known pi compatibility
  // adapter that supports passthrough, surface a chip so the user can
  // see at a glance which installed packages take over the canonical
  // OpenBuddy capability (e.g. pi-mcp-adapter replaces openbuddy-mcp-client).
  // The catalog is the renderer-safe mirror of `compatibilityAdapters`; the
  // actual runtime decision still lives in the main-process loader.
  const piPriorityEntry: PiPackageCatalogEntry | undefined = useMemo(
    () => (installed ? findPiPackageCatalogEntry(plugin.name) : undefined),
    [installed, plugin.name],
  );
  const showPiPriorityChip = !!piPriorityEntry?.passthrough;
  return (
    <div className={`mp-plugin ${installed ? "mp-plugin--installed" : ""}`}>
      <div className="mp-plugin__body">
        <div className="mp-plugin__name">
          {plugin.name}
          {plugin.version && (
            <span className="mp-plugin__version">v{plugin.version}</span>
          )}
          {installed && (
            <span className="mp-plugin__badge mp-plugin__badge--installed">
              <Check size={10} /> 已安装
              {plugin.installedVersion && plugin.installedVersion !== plugin.version
                ? ` (v${plugin.installedVersion})`
                : ""}
            </span>
          )}
          {showPiPriorityChip && piPriorityEntry && (
            <span
              className="mp-plugin__badge mp-plugin__badge--pi-priority"
              title={`OpenBuddy 将优先使用原生 pi 实现 (capability: ${piPriorityEntry.capability})`}
              data-capability={piPriorityEntry.capability}
            >
              <span className="mp-plugin__pi-glyph" aria-hidden="true">π</span>
              Native · {piPriorityEntry.capabilityLabel}
            </span>
          )}
          {plugin.category && (
            <span className="mp-plugin__badge">{plugin.category}</span>
          )}
        </div>
        {plugin.description && (
          <div className="mp-plugin__desc">{plugin.description}</div>
        )}
        <div className="mp-plugin__meta">
          {sourceName && <span>来源：{sourceName}</span>}
          {plugin.author && <span>作者：{plugin.author}</span>}
          {plugin.skillCount > 0 && <span>{plugin.skillCount} 技能</span>}
          {plugin.hasAgents && <span>含助理</span>}
          {plugin.hasHooks && <span>含 Hooks</span>}
          {plugin.hasMcp && <span>含 MCP</span>}
          {plugin.homepage && (
            <a
              href={plugin.homepage}
              target="_blank"
              rel="noreferrer"
              className="mp-plugin__link"
            >
              主页
            </a>
          )}
        </div>
      </div>
      <div className="mp-plugin__actions">
        {busy ? (
          <span className="mp-plugin__busy">处理中…</span>
        ) : installed ? (
          <>
            {plugin.installedVersion &&
              plugin.installedVersion !== plugin.version && (
                <button
                  className="mp-plugin__btn mp-plugin__btn--update"
                  onClick={() => onUpdate(sourceRef, plugin)}
                  title={`更新到 v${plugin.version}`}
                >
                  更新
                </button>
              )}
            <button
              className="mp-plugin__btn mp-plugin__btn--danger"
              onClick={() => onUninstall(sourceRef, plugin)}
            >
              卸载
            </button>
          </>
        ) : (
          <button
            className="mp-plugin__btn mp-plugin__btn--install"
            onClick={() => onInstall(sourceRef, plugin)}
          >
            <Download size={12} /> 安装
          </button>
        )}
      </div>
    </div>
  );
  },
);
