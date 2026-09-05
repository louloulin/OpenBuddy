/**
 * 云存储浏览面板 —— 腾讯 Drive/文档 替代的 UI。
 *
 * 列出已注册 StorageProvider,浏览/读取/删除文件。provider-agnostic(WebDAV/S3/本地)。
 */
import { useEffect, useState } from "react";
import { invoke, open as openDialog } from "@/lib/platform/electron-api";
import {
  createLocalStorageProvider,
  listStorageProviders,
  getStorageProvider,
  registerStorageProvider,
  normalizePath,
  type StorageEntry,
} from "@/lib/files/cloud-storage";

const localAdapter = {
  list: async (path: string, root: string) => invoke<Array<{ name: string; path: string; kind: "directory" | "file" | "other"; size: number }>>("shellfs:list-dir", { path, cwd: root }),
  readText: async (path: string, root: string) => invoke<string>("shellfs:read-text", { path, cwd: root }),
  writeText: async (path: string, content: string, root: string) => { await invoke("shellfs:write-text", { path, content, workspaceRoot: root }); return true; },
  remove: async (path: string, root: string) => { await invoke("shellfs:remove", { path, workspaceRoot: root }); return true; },
  makeDir: async (path: string, root: string) => { await invoke("shellfs:mkdir", { path, workspaceRoot: root }); return true; },
};

export function CloudStoragePanel({ onToast }: { onToast?: (msg: string) => void }) {
  const [providers, setProviders] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [currentPath, setCurrentPath] = useState("/");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(invoke<string[]>("storage-sources:list")).then((roots) => {
      for (const root of Array.isArray(roots) ? roots : []) registerStorageProvider(createLocalStorageProvider(root, localAdapter));
      if (!cancelled) setProviders(listStorageProviders());
    }).catch(() => setProviders(listStorageProviders()));
    return () => { cancelled = true; };
  }, []);

  const addLocalStorage = async () => {
    const selected = await openDialog({ directory: true, multiple: false, title: "选择本地存储目录" });
    if (!selected || Array.isArray(selected)) return;
    const root = selected as string;
    registerStorageProvider(createLocalStorageProvider(root, localAdapter));
    const existing = await Promise.resolve(invoke<string[]>("storage-sources:list")).catch(() => []);
    await invoke("storage-sources:save", { sources: [...new Set([...(Array.isArray(existing) ? existing : []), root])] }).catch(() => undefined);
    setProviders(listStorageProviders());
    onToast?.("已添加本地存储源");
  };

  const browse = async (providerId: string, path: string) => {
    const provider = getStorageProvider(providerId);
    if (!provider) return;
    setLoading(true);
    try {
      const list = await provider.list(normalizePath(path));
      setEntries(list.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1)));
      setCurrentPath(normalizePath(path));
    } catch (e) {
      onToast?.(`浏览失败：${String(e).replace(/^Error:\s*/, "")}`);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  const selectProvider = (id: string) => {
    setSelectedProvider(id);
    void browse(id, "/");
  };

  const openEntry = (entry: StorageEntry) => {
    if (entry.isDir && selectedProvider) {
      void browse(selectedProvider, entry.path);
    }
  };

  const goUp = () => {
    if (!selectedProvider) return;
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    void browse(selectedProvider, "/" + parts.join("/"));
  };

  const deleteEntry = async (entry: StorageEntry) => {
    if (!selectedProvider) return;
    const provider = getStorageProvider(selectedProvider);
    if (!provider) return;
    try {
      await provider.delete(entry.path);
      onToast?.(`已删除 ${entry.name}`);
      void browse(selectedProvider, currentPath);
    } catch (e) {
      onToast?.(`删除失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  };

  const readFile = async (entry: StorageEntry) => {
    if (!selectedProvider) return;
    const provider = getStorageProvider(selectedProvider);
    if (!provider) return;
    try {
      const content = await provider.readText(entry.path);
      if (content != null) {
        onToast?.(content.slice(0, 200));
      } else {
        onToast?.("(空文件或二进制)");
      }
    } catch {
      onToast?.("读取失败");
    }
  };

  return (
    <div className="storage-panel" role="region" aria-label="云存储">
      <div className="storage-panel__head">
        <span className="storage-panel__title">云存储</span>
        {providers.length > 0 ? (
          <select value={selectedProvider ?? ""} onChange={(e) => selectProvider(e.target.value)}>
            <option value="">选择存储源…</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        ) : <span className="storage-panel__muted">未配置存储源</span>}
        <button type="button" onClick={() => void addLocalStorage()}>+ 添加本地目录</button>
      </div>

      {/* 面包屑 */}
      {selectedProvider && (
        <div className="storage-panel__breadcrumb">
          {currentPath !== "/" && (
            <button type="button" onClick={goUp} className="storage-panel__up">↑ 上级</button>
          )}
          <span className="storage-panel__path">{currentPath}</span>
        </div>
      )}

      {/* 文件列表 */}
      {loading ? (
        <div className="storage-panel__loading">加载中…</div>
      ) : selectedProvider && entries.length > 0 ? (
        <ul className="storage-panel__list">
          {entries.map((e) => (
            <li key={e.path} className={"storage-panel__entry" + (e.isDir ? " dir" : "")}>
              <span className="storage-panel__entry-icon">{e.isDir ? "📁" : "📄"}</span>
              <span className="storage-panel__entry-name" onClick={() => openEntry(e)} title={e.isDir ? "打开目录" : undefined}>
                {e.name}
              </span>
              {!e.isDir && e.size != null && (
                <span className="storage-panel__entry-size">{formatSize(e.size)}</span>
              )}
              {!e.isDir && (
                <div className="storage-panel__entry-actions">
                  <button type="button" onClick={() => void readFile(e)} title="读取">👁</button>
                  <button type="button" onClick={() => void deleteEntry(e)} title="删除" className="danger">🗑</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : selectedProvider && !loading ? (
        <div className="storage-panel__empty">空目录</div>
      ) : null}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}
