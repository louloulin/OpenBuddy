/**
 * @openbuddy/ui-files-tree/LazyFileTree — lazy-loading adapter around <FileTree>.
 *
 * `<FileTree>` is fully controlled: it expects the *complete* node forest up
 * front. Real workspaces are far too large for that (a monorepo easily has 10⁵
 * paths, and most of it is never looked at), so this adapter keeps a
 * `dir path → entries` cache, loads a directory the first time it is expanded,
 * and projects that cache into the `TreeNode[]` the tree renders.
 *
 * Doing the projection here — instead of making `<FileTree>` aware of loading
 * state — keeps the virtualized renderer free of I/O concerns, and keeps the
 * file-system protocol (local IPC, remote FS, virtual FS) out of this package
 * entirely: the host passes in `loadDir`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileTreeContextMenuItem } from "./FileTree";
import { FileTree } from "./FileTree";
import type { TreeNode } from "../lib/tree-utils";

/** Shape the host's `loadDir` must return. Matches `DirEntry` from pi-client. */
export interface LazyFileTreeEntry {
  /** Basename shown in the row. */
  name: string;
  /** Absolute path — also used as the node id. */
  path: string;
  /** "file" | "directory" | "other". Anything but "file" is a leaf here. */
  kind: string;
  /** Bytes, for the size badge. Directories report 0. */
  size?: number;
}

type DirState =
  | { status: "loading" }
  | { status: "ready"; entries: LazyFileTreeEntry[] }
  | { status: "error"; message: string };

export interface LazyFileTreeProps {
  /** Workspace root (absolute). Empty/undefined renders `missingRootLabel`. */
  rootPath?: string;
  /**
   * Loads the immediate children of a directory. Must not recurse.
   *
   * Optional because this component is also the default `files.tree` slot
   * entry, and a slot's props come from whichever host renders it — a host
   * that forgets the loader gets an explicit message instead of a crash.
   */
  loadDir?(dirPath: string): Promise<LazyFileTreeEntry[]>;
  /** Highlighted file (single-select mode). */
  selectedPath?: string;
  /** Single click on a file row. */
  onFileSelect?(path: string): void;
  /**
   * When true the tree owns a multi-selection (⌘/Ctrl-click, Shift-range,
   * ⌘A) and reports it through `onSelectionChange`; `selectedPath` no longer
   * drives the highlight.
   */
  multiSelect?: boolean;
  onSelectionChange?(paths: ReadonlySet<string>): void;
  /**
   * Folder → folder drag & drop. Left undefined the rows are not draggable at
   * all, because offering a drop that cannot be honoured is worse than no DnD.
   */
  onMove?(source: LazyFileTreeEntry, targetDir: string): void;
  /** Host context-menu entries, appended after the built-ins. */
  contextMenuItems?(node: TreeNode): FileTreeContextMenuItem[];
  /** Enables the "在文件夹中显示" menu entry (needs a host IPC). */
  onReveal?(path: string): void;
  onToast?(message: string): void;
  /** Hides the byte-size badge. */
  showFileSize?: boolean;
  height?: number | string;
  className?: string;
  emptyLabel?: string;
  loadingLabel?: string;
  missingRootLabel?: string;
  /** Shown when the host rendered this tree without a `loadDir`. */
  noLoaderLabel?: string;
}

function toTreeNode(
  entry: LazyFileTreeEntry,
  loaded: ReadonlyMap<string, DirState>,
): TreeNode {
  const isDir = entry.kind !== "file";
  const state = isDir ? loaded.get(entry.path) : undefined;
  return {
    id: entry.path,
    name: entry.name,
    path: entry.path,
    kind: isDir ? "dir" : "file",
    // `children` stays undefined while a folder is unloaded / loading /
    // errored — flattenTree() then simply renders nothing underneath it.
    children:
      state?.status === "ready"
        ? state.entries.map((child) => toTreeNode(child, loaded))
        : undefined,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through — clipboard can be blocked without a user gesture */
  }
  return false;
}

export function LazyFileTree({
  rootPath,
  loadDir,
  selectedPath,
  onFileSelect,
  multiSelect = false,
  onSelectionChange,
  onMove,
  contextMenuItems,
  onReveal,
  onToast,
  showFileSize = true,
  height = "100%",
  className,
  emptyLabel = "选择文件查看内容",
  loadingLabel = "加载文件树中…",
  missingRootLabel = "未设置工作区目录(cwd)。",
  noLoaderLabel = "宿主未提供目录加载器(loadDir)。",
}: LazyFileTreeProps) {
  const root = rootPath ?? "";
  const [dirs, setDirs] = useState<Map<string, DirState>>(() => new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Guards against React 18 StrictMode double-invoking the mount effect and
  // firing two identical directory reads.
  const inFlightRef = useRef<Set<string>>(new Set());
  // A directory read can outlive the component (the session/panel is closed
  // while it is in flight). Without this the resolution would setState on an
  // unmounted tree — harmless in React 18, but it makes every test that
  // unmounts mid-load noisy.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (dirPath: string): Promise<void> => {
      if (!dirPath || !loadDir) return;
      if (inFlightRef.current.has(dirPath)) return;
      inFlightRef.current.add(dirPath);
      if (mountedRef.current) {
        setDirs((prev) => {
          const next = new Map(prev);
          next.set(dirPath, { status: "loading" });
          return next;
        });
      }
      try {
        const entries = await loadDir(dirPath);
        if (!mountedRef.current) return;
        setDirs((prev) => {
          const next = new Map(prev);
          next.set(dirPath, { status: "ready", entries });
          return next;
        });
      } catch (error) {
        if (!mountedRef.current) return;
        const message = String(error).replace(/^Error:\s*/, "");
        setDirs((prev) => {
          const next = new Map(prev);
          next.set(dirPath, { status: "error", message });
          return next;
        });
        // Collapse again so the chevron does not look "open but empty", and
        // so the next expand is an explicit retry.
        setExpanded((prev) => {
          if (!prev.has(dirPath)) return prev;
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
        onToast?.(`读取目录失败:${message}`);
      } finally {
        inFlightRef.current.delete(dirPath);
      }
    },
    [loadDir, onToast],
  );

  // Reset on root change, then expand + load the root itself so the first
  // level is visible without a click.
  useEffect(() => {
    inFlightRef.current.clear();
    setDirs(new Map());
    if (!root) {
      setExpanded(new Set());
      return;
    }
    setExpanded(new Set([root]));
    void load(root);
    // `load` is intentionally not a dependency: it changes whenever the host
    // passes a new inline callback, and re-running this reset on every parent
    // render would throw away the whole cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  const handleExpandedChange = useCallback(
    (next: Set<string>) => {
      for (const id of next) {
        if (expanded.has(id)) continue;
        const state = dirs.get(id);
        if (state?.status === "ready" || state?.status === "loading") continue;
        void load(id); // first expand, or retry after an error
      }
      setExpanded(next);
    },
    [dirs, expanded, load],
  );

  const nodes = useMemo(() => {
    const state = dirs.get(root);
    if (state?.status !== "ready") return [];
    return state.entries.map((entry) => toTreeNode(entry, dirs));
  }, [dirs, root]);

  const rootState = dirs.get(root);

  const selectedIds = useMemo<ReadonlySet<string> | undefined>(() => {
    if (multiSelect) return undefined; // tree owns the set
    return new Set(selectedPath ? [selectedPath] : []);
  }, [multiSelect, selectedPath]);

  const handleSelect = useCallback(
    (node: TreeNode) => {
      if (node.kind === "file") {
        onFileSelect?.(node.path);
        return;
      }
      // Folder: single click toggles, mirroring the chevron.
      const next = new Set(expanded);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      handleExpandedChange(next);
    },
    [expanded, handleExpandedChange, onFileSelect],
  );

  const renderContextMenu = useCallback(
    (node: TreeNode): FileTreeContextMenuItem[] => {
      const isFile = node.kind === "file";
      const items: FileTreeContextMenuItem[] = [];
      if (isFile) {
        items.push({ label: "打开", onSelect: () => onFileSelect?.(node.path) });
      }
      items.push({
        label: "复制路径",
        onSelect: () => {
          void copyText(node.path).then((ok) => {
            if (!ok) onToast?.("复制路径失败:剪贴板不可用");
          });
        },
      });
      if (onReveal) {
        items.push({
          label: "在文件夹中显示",
          onSelect: () => onReveal(node.path),
        });
      }
      // Reload the folder itself, or the parent when the row is a file.
      const refreshTarget = isFile ? parentDirOf(node.path, root) : node.path;
      items.push({
        label: "刷新",
        separatorBefore: true,
        onSelect: () => void load(refreshTarget),
      });
      const extra = contextMenuItems?.(node);
      return extra?.length ? [...items, ...extra] : items;
    },
    [contextMenuItems, load, onFileSelect, onReveal, onToast, root],
  );

  if (!root) {
    return <div className="file-tree__empty">{missingRootLabel}</div>;
  }
  if (!loadDir) {
    return (
      <div className="file-tree__empty">{noLoaderLabel}</div>
    );
  }

  return (
    <FileTree
      nodes={nodes}
      expandedIds={expanded}
      onExpandedChange={handleExpandedChange}
      selectedIds={selectedIds}
      onSelectionChange={
        multiSelect
          ? (next) => onSelectionChange?.(next)
          : undefined
      }
      onSelect={handleSelect}
      onOpen={(node) => {
        if (node.kind === "file") onFileSelect?.(node.path);
      }}
      dragEnabled={Boolean(onMove)}
      onMove={
        onMove
          ? (source, target) => {
              const entry = findEntry(dirs, source.path, root);
              if (entry) onMove(entry, target.path);
            }
          : undefined
      }
      renderContextMenu={renderContextMenu}
      renderBadge={
        showFileSize
          ? (node) => {
              if (node.kind !== "file") return null;
              const entry = findEntry(dirs, node.path, root);
              if (!entry?.size) return null;
              return formatBytes(entry.size);
            }
          : undefined
      }
      className={className}
      height={height}
      emptyLabel={
        rootState?.status === "loading" || rootState === undefined
          ? loadingLabel
          : emptyLabel
      }
    />
  );
}

/**
 * The badge renderer only receives a TreeNode. Entry metadata (size) is not
 * part of that contract, so look it up in the cache by path. The parent map is
 * one hop back along the path, which is enough — `renderBadge` never needs to
 * walk the whole tree.
 */
function findEntry(
  dirs: ReadonlyMap<string, DirState>,
  targetPath: string,
  fallbackDir: string,
): LazyFileTreeEntry | undefined {
  const parent = dirs.get(parentDirOf(targetPath, fallbackDir));
  if (parent?.status !== "ready") return undefined;
  return parent.entries.find((e) => e.path === targetPath);
}

/** Directory part of a path, tolerating both `/` and `\` separators. */
function parentDirOf(target: string, fallback: string): string {
  const cut = Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\"));
  if (cut <= 0) return fallback;
  return target.slice(0, cut) || fallback;
}
