/**
 * 文件树视图 —— 对齐 WorkBuddy `context-viewer-components/DetailPanel/FileTree`。
 *
 * 左列：可展开/折叠的目录树（懒加载 `listDir`，展开时按需拉取子目录）。
 * 选中文件由父组件通过 onFileSelect 回调驱动主区域预览。
 *
 * 根目录取 cwd（会话工作区）。隐藏/构建目录已在后端过滤。
 */
import { useCallback, useEffect, useState } from "react";
import { listDir, type DirEntry } from "@/lib/agent/pi-client";
import { pickFileEmoji } from "./file-tab-icon";
import { ChevronRightIcon } from "@openbuddy/ui-primitives/icons";

/** 已加载的目录条目缓存：path → entries（undefined=未加载，[]=已加载空）。 */
type LoadedMap = Map<string, DirEntry[] | undefined>;

interface FileTreeViewProps {
  /** 工作区根目录（绝对路径）。 */
  rootPath?: string;
  /** 当前选中的文件路径（高亮）。 */
  selectedPath?: string;
  /** 选中文件回调。 */
  onFileSelect: (path: string) => void;
  /** 错误/提示回调。 */
  onToast?: (msg: string) => void;
}

export function FileTreeView({
  rootPath,
  selectedPath,
  onFileSelect,
  onToast,
}: FileTreeViewProps) {
  const [loaded, setLoaded] = useState<LoadedMap>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const root = rootPath ?? "";
  const rootLoaded = loaded.get(root);

  // 加载根目录。
  const loadDir = useCallback(
    async (dirPath: string) => {
      if (loaded.has(dirPath)) return; // 已加载（含空数组）
      setLoaded((prev) => {
        const next = new Map(prev);
        next.set(dirPath, undefined); // 标记为「加载中」
        return next;
      });
      try {
        const entries = await listDir(dirPath);
        setLoaded((prev) => {
          const next = new Map(prev);
          next.set(dirPath, entries);
          return next;
        });
      } catch (e) {
        const msg = String(e).replace(/^Error:\s*/, "");
        onToast?.(`读取目录失败：${msg}`);
        setLoaded((prev) => {
          const next = new Map(prev);
          next.delete(dirPath); // 失败：移除标记，允许重试
          return next;
        });
      }
    },
    [loaded, onToast],
  );

  // 根目录变化时重置并加载。
  useEffect(() => {
    setLoaded(new Map());
    setExpanded(new Set());
    if (!root) return;
    setLoading(true);
    loadDir(root).finally(() => setLoading(false));
  }, [root]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDir = useCallback(
    async (dirPath: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(dirPath)) next.delete(dirPath);
        else next.add(dirPath);
        return next;
      });
      await loadDir(dirPath);
    },
    [loadDir],
  );

  if (!root) {
    return (
      <div className="file-tree__empty">未设置工作区目录（cwd）。</div>
    );
  }

  if (loading && rootLoaded === undefined) {
    return <div className="file-tree__empty">加载文件树中…</div>;
  }

  const rootEntries = loaded.get(root) ?? [];
  if (rootEntries.length === 0 && rootLoaded !== undefined) {
    return <div className="file-tree__empty">空目录。</div>;
  }

  return (
    <div className="file-tree" role="tree" aria-label="工作区文件树">
      {rootEntries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          expanded={expanded}
          loaded={loaded}
          selectedPath={selectedPath}
          onToggleDir={toggleDir}
          onFileSelect={onFileSelect}
        />
      ))}
      {rootEntries.length === 0 && (
        <div className="file-tree__empty">选择文件查看内容</div>
      )}
    </div>
  );
}

/** 单个树节点（目录或文件），递归渲染子目录。 */
function TreeNode({
  entry,
  depth,
  expanded,
  loaded,
  selectedPath,
  onToggleDir,
  onFileSelect,
}: {
  entry: DirEntry;
  depth: number;
  expanded: Set<string>;
  loaded: LoadedMap;
  selectedPath?: string;
  onToggleDir: (path: string) => void;
  onFileSelect: (path: string) => void;
}) {
  const isDir = entry.kind === "directory";
  const isExpanded = expanded.has(entry.path);
  const isSelected = entry.path === selectedPath;
  const children = isDir ? loaded.get(entry.path) : undefined;
  const childLoading = isDir && isExpanded && children === undefined;

  const handleClick = () => {
    if (isDir) onToggleDir(entry.path);
    else onFileSelect(entry.path);
  };

  return (
    <>
      <div
        className={
          "file-tree__node" +
          (isDir ? " file-tree__node--dir" : " file-tree__node--file") +
          (isSelected ? " file-tree__node--selected" : "")
        }
        style={{ paddingInlineStart: `${depth * 14 + 8}px` }}
        role="treeitem"
        aria-expanded={isDir ? isExpanded : undefined}
        aria-selected={isSelected}
        onClick={handleClick}
        title={entry.path}
      >
        {isDir ? (
          <ChevronRightIcon
            size="sm"
            className={
              "file-tree__chevron" + (isExpanded ? " file-tree__chevron--open" : "")
            }
          />
        ) : (
          <span className="file-tree__chevron-placeholder" />
        )}
        <span className="file-tree__icon">
          {isDir ? "📁" : pickFileEmoji(entry.name)}
        </span>
        <span className="file-tree__name">{entry.name}</span>
      </div>
      {isDir &&
        isExpanded &&
        children &&
        children.map((child) => (
          <TreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            expanded={expanded}
            loaded={loaded}
            selectedPath={selectedPath}
            onToggleDir={onToggleDir}
            onFileSelect={onFileSelect}
          />
        ))}
      {childLoading && (
        <div
          className="file-tree__node file-tree__node--loading"
          style={{ paddingInlineStart: `${(depth + 1) * 14 + 8}px` }}
        >
          …
        </div>
      )}
    </>
  );
}
