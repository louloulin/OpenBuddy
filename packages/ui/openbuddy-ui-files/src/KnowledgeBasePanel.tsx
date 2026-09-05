/**
 * 知识库面板 —— 对齐 WorkBuddy `knowledge-base-panel`(可插拔知识源)。
 *
 * OpenBuddy 的知识源 provider-agnostic(本地文件夹/网盘/文档库均可注册,见
 * lib/knowledge-base)。本面板提供搜索框 + 跨源结果列表。无 provider 时显示空态。
 */
import { useEffect, useState } from "react";
import { invoke, open as openDialog } from "@/lib/platform/electron-api";
import { searchKb, listKbProvidersWithStats, registerKbProvider, unregisterKbProvider, rebuildAllKbProviders, type KbEntry, type KbIndexStats } from "@openbuddy/files-kb";
import { createLocalKbProvider } from "@openbuddy/files-kb";
import { createElectronDirectoryReader, isElectronAvailable } from "@/lib/files/electron-kb-reader";

interface KnowledgeBasePanelProps {
  /** 打开条目回调(可选)。 */
  onOpen?: (entryId: string, url?: string) => void;
  /** 临时反馈(可选)。 */
  onToast?: (msg: string) => void;
}

export function KnowledgeBasePanel({ onOpen, onToast }: KnowledgeBasePanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KbEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sources, setSources] = useState<Array<{ id: string; label: string; stats: KbIndexStats }>>([]);
  const q = query.trim();
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(invoke<string[]>("knowledge-sources:list")).then((storedRoots) => {
      const roots = Array.isArray(storedRoots) ? storedRoots : [];
      if (cancelled) return;
      for (const [index, root] of roots.entries()) {
        registerKbProvider(createLocalKbProvider(root, createElectronDirectoryReader(), { providerId: index === 0 ? "local" : `local:${encodeURIComponent(root)}`, label: "本地文件夹" }));
      }
      setRefreshKey((k) => k + 1);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  // 每当 refreshKey 变化(添加/移除/重建/搜索)重新拉取含索引状态的源列表。
  useEffect(() => {
    let cancelled = false;
    void listKbProvidersWithStats().then((s) => {
      if (!cancelled) setSources(s);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  /** 添加本地文件夹知识源:弹出原生目录选择 → 注册 local KbProvider。 */
  const addLocalFolder = async () => {
    if (!isElectronAvailable()) {
      onToast?.("添加知识源需要桌面环境(Electron-compatible)");
      return;
    }
    try {
      const dir = await openDialog({ directory: true, multiple: false });
      if (!dir || Array.isArray(dir)) return;
      const root = dir as string;
      const storedSources = await Promise.resolve(invoke<string[]>("knowledge-sources:list")).catch(() => []);
      const sources = Array.isArray(storedSources) ? storedSources : [];
      const providerId = sources.length === 0 ? "local" : `local:${encodeURIComponent(root)}`;
      registerKbProvider(createLocalKbProvider(root, createElectronDirectoryReader(), { providerId, label: "本地文件夹" }));
      await invoke("knowledge-sources:save", { sources: [...new Set([...sources, root])] });
      setRefreshKey((k) => k + 1);
      onToast?.("已添加本地知识源");
    } catch (e) {
      onToast?.(`添加失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  };

  /** 移除一个已注册知识源(by id)。 */
  const removeSource = (id: string) => {
    if (unregisterKbProvider(id)) {
      const encodedRoot = id.startsWith("local:") ? id.slice("local:".length) : undefined;
      void Promise.resolve(invoke<string[]>("knowledge-sources:list")).then((storedSources) => {
        const sources = Array.isArray(storedSources) ? storedSources : [];
        const root = encodedRoot ? decodeURIComponent(encodedRoot) : sources[0];
        if (!root) return;
        return invoke("knowledge-sources:save", { sources: sources.filter((source) => source !== root) });
      }).catch(() => undefined);
      setRefreshKey((k) => k + 1);
      onToast?.("已移除知识源");
    }
  };

  /** 重建索引:刷新所有知识源缓存(本地文件夹内容变化后手动重新扫描)。 */
  const [rebuilding, setRebuilding] = useState(false);
  const rebuildIndex = async () => {
    setRebuilding(true);
    try {
      const res = await rebuildAllKbProviders();
      setRefreshKey((k) => k + 1);
      const total = res.reduce((s, r) => s + (r.count ?? 0), 0);
      onToast?.(res.length > 0 ? `已重建索引(${total} 项)` : "无可重建的知识源");
    } catch (e) {
      onToast?.(`重建失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setRebuilding(false);
    }
  };

  useEffect(() => {
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    void searchKb(q)
      .then((r) => {
        if (!cancelled) setResults(r);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q]);

  return (
    <div className="kb-panel" role="region" aria-label="知识库">
      <div className="kb-panel__head">
        <span className="kb-panel__title">知识库</span>
        <div className="kb-panel__head-right">
          <span className="kb-panel__sources">
            {sources.length > 0 ? `${sources.length} 个源` : "未配置知识源"}
          </span>
          <button
            type="button"
            className="kb-panel__add-btn"
            onClick={() => void addLocalFolder()}
            title="添加本地文件夹作为知识源"
          >
            + 添加本地文件夹
          </button>
          {sources.length > 0 && (
            <button
              type="button"
              className="kb-panel__refresh-btn"
              onClick={() => void rebuildIndex()}
              disabled={rebuilding}
              title="重新扫描所有知识源(文件夹内容变化后刷新)"
            >
              {rebuilding ? "重建中…" : "↻ 刷新索引"}
            </button>
          )}
        </div>
      </div>
      {/* 已注册知识源 chip 列表(每个可移除)。 */}
      {sources.length > 0 && (
        <div className="kb-panel__sources-row">
          {sources.map((s) => (
            <span key={s.id} className="kb-panel__source-chip" title={s.label}>
              <span className="kb-panel__source-chip-label">{s.label}</span>
              <button
                type="button"
                className="kb-panel__source-chip-remove"
                onClick={() => removeSource(s.id)}
                aria-label={`移除知识源 ${s.label}`}
                title="移除此知识源"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {/* 索引状态指示:已索引文件数 + 最近重建时间(让用户直观感知覆盖范围)。 */}
      {sources.length > 0 && (
        <div className="kb-panel__index-status" aria-live="polite">
          <span className="kb-panel__index-count">
            已索引 {sources.reduce((sum, s) => sum + (s.stats.fileCount ?? 0), 0)} 个文件
          </span>
          {(() => {
            const ts = sources
              .map((s) => s.stats.lastRebuiltAt)
              .filter((t): t is number => typeof t === "number")
              .sort((a, b) => b - a)[0];
            return ts ? (
              <span className="kb-panel__index-time">最近更新 {formatRelativeTime(ts)}</span>
            ) : null;
          })()}
        </div>
      )}
      <input
        className="kb-panel__input"
        type="text"
        value={query}
        placeholder="搜索知识库…"
        onChange={(e) => setQuery(e.target.value)}
        aria-label="搜索知识库"
      />
      {q && (
        <ul className="kb-panel__list">
          {searching ? (
            <li className="kb-panel__empty">搜索中…</li>
          ) : results.length === 0 ? (
            <li className="kb-panel__empty">无匹配结果</li>
          ) : (
            results.map((e) => (
              <li
                key={`${e.source}:${e.id}`}
                className="kb-panel__row"
                onClick={() => onOpen?.(e.id, e.url)}
                title={e.url ?? e.title}
              >
                <span className="kb-panel__row-source">{e.source}</span>
                <span className="kb-panel__row-title">{e.title}</span>
                {e.snippet && <span className="kb-panel__row-snippet">{e.snippet}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** 把时间戳(ms)格式化为相对时间(如「刚刚 / 3 分钟前 / 2 小时前 / 昨天」)。 */
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "昨天";
  if (day < 30) return `${day} 天前`;
  return new Date(ts).toLocaleDateString();
}
