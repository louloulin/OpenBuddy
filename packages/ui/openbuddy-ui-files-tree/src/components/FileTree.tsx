/**
 * @openbuddy/ui-files-tree/FileTree — virtualized, multi-select tree.
 *
 * Features (v1, matching cabinet's tree-view):
 *   - Windowing: only rows in (or near) the viewport are mounted, so 10k
 *     nodes stay smooth. Fixed row height (28px) keeps the math trivial.
 *   - Multi-select: Cmd/Ctrl+click toggles, Shift+click selects a range of
 *     *visible* rows, plain click replaces the selection.
 *   - Drag & drop: folders are draggable onto other folders. The host decides
 *     what to do via `onMove` (we never mutate the tree ourselves).
 *   - Keyboard: ↑/↓ move, ←/→ collapse/expand, Enter opens, Space selects,
 *     Home/End jump, Cmd/Ctrl+A select-all-visible.
 *   - Context menu: the host injects items via `renderContextMenu(node)`,
 *     positioned at the pointer.
 *
 * The component is fully controlled: `nodes`, `expandedIds`, `selectedIds`
 * come from the host, and every user gesture is surfaced through a callback.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ancestorsOf,
  canDrop,
  flattenTree,
  moveNode,
  rangeSelect,
  type TreeNode,
  type TreeNodeId,
} from "../lib/tree-utils";
import { FileTreeRow } from "./FileTreeRow";
import styles from "./FileTree.module.css";

const ROW_HEIGHT = 28;
const OVERSCAN = 8;

export interface FileTreeContextMenuItem {
  label: string;
  onSelect(): void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export interface FileTreeProps {
  nodes: TreeNode[];
  /** Controlled expanded set. When omitted the tree owns it. */
  expandedIds?: ReadonlySet<TreeNodeId>;
  onExpandedChange?(next: Set<TreeNodeId>): void;
  /** Controlled selection. When omitted the tree owns it. */
  selectedIds?: ReadonlySet<TreeNodeId>;
  onSelectionChange?(next: Set<TreeNodeId>): void;

  onOpen?(node: TreeNode): void;
  /** Invoked when a folder is dropped onto another folder. */
  onMove?(source: TreeNode, target: TreeNode): void;
  /** Host-provided context menu items for a node. */
  renderContextMenu?(node: TreeNode): FileTreeContextMenuItem[];
  /** Optional per-row accessory (badges, trailing actions). */
  renderBadge?(node: TreeNode): ReactNode;

  className?: string;
  /** Height of the scroll container. Falls back to 100% of the parent. */
  height?: number | string;
  emptyLabel?: string;
}

export function FileTree({
  nodes,
  expandedIds,
  onExpandedChange,
  selectedIds,
  onSelectionChange,
  onOpen,
  onMove,
  renderContextMenu,
  renderBadge,
  className,
  height = "100%",
  emptyLabel = "暂无文件",
}: FileTreeProps) {
  // ----- controlled / uncontrolled state --------------------------------
  const [internalExpanded, setInternalExpanded] = useState<Set<TreeNodeId>>(
    () => new Set(),
  );
  const [internalSelected, setInternalSelected] = useState<Set<TreeNodeId>>(
    () => new Set(),
  );
  const expanded = expandedIds ?? internalExpanded;
  const selected = selectedIds ?? internalSelected;

  const setExpanded = useCallback(
    (updater: (prev: ReadonlySet<TreeNodeId>) => Set<TreeNodeId>) => {
      if (expandedIds === undefined) setInternalExpanded(updater);
      onExpandedChange?.(updater(expanded));
    },
    [expandedIds, expanded, onExpandedChange],
  );
  const setSelected = useCallback(
    (updater: (prev: ReadonlySet<TreeNodeId>) => Set<TreeNodeId>) => {
      if (selectedIds === undefined) setInternalSelected(updater);
      onSelectionChange?.(updater(selected));
    },
    [selectedIds, selected, onSelectionChange],
  );

  // ----- virtualization --------------------------------------------------
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);

  const visible = useMemo(
    () => flattenTree(nodes, expanded),
    [nodes, expanded],
  );

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportHeight(el.clientHeight || 400);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totalHeight = visible.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(
    visible.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const windowRows = visible.slice(startIdx, endIdx);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // ----- selection -------------------------------------------------------
  const anchorRef = useRef<TreeNodeId | null>(null);
  const [focusedId, setFocusedId] = useState<TreeNodeId | null>(null);

  const toggleExpand = useCallback(
    (id: TreeNodeId) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [setExpanded],
  );

  const handleRowClick = useCallback(
    (node: TreeNode, e: React.MouseEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      const isShift = e.shiftKey;
      anchorRef.current = node.id;
      setFocusedId(node.id);

      if (isShift && anchorRef.current) {
        const range = rangeSelect(visible, anchorRef.current, node.id);
        if (range.size === 0) {
          range.add(node.id);
        }
        setSelected(() => range);
        return;
      }
      if (isMeta) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
        return;
      }
      setSelected(() => new Set([node.id]));
    },
    [visible, setSelected],
  );

  const handleChevronClick = useCallback(
    (node: TreeNode, e: React.MouseEvent) => {
      e.stopPropagation();
      if (node.kind === "dir") toggleExpand(node.id);
    },
    [toggleExpand],
  );

  const handleDoubleClick = useCallback(
    (node: TreeNode) => {
      if (node.kind === "dir") toggleExpand(node.id);
      else onOpen?.(node);
    },
    [toggleExpand, onOpen],
  );

  // ----- keyboard --------------------------------------------------------
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (visible.length === 0) return;
      const currentIdx = focusedId
        ? visible.findIndex((v) => v.node.id === focusedId)
        : -1;
      const current = currentIdx >= 0 ? visible[currentIdx] : null;

      const moveFocus = (nextIdx: number) => {
        const clamped = Math.max(0, Math.min(visible.length - 1, nextIdx));
        const nextNode = visible[clamped].node;
        setFocusedId(nextNode.id);
        setSelected(() => new Set([nextNode.id]));
        // Scroll into view.
        const el = scrollRef.current;
        if (el) {
          const top = clamped * ROW_HEIGHT;
          const bottom = top + ROW_HEIGHT;
          if (top < el.scrollTop) el.scrollTop = top;
          else if (bottom > el.scrollTop + el.clientHeight) {
            el.scrollTop = bottom - el.clientHeight;
          }
        }
      };

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          moveFocus(currentIdx + 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          moveFocus(currentIdx - 1);
          break;
        case "ArrowRight":
          if (current?.node.kind === "dir" && !expanded.has(current.node.id)) {
            e.preventDefault();
            toggleExpand(current.node.id);
          } else if (current) {
            e.preventDefault();
            moveFocus(currentIdx + 1);
          }
          break;
        case "ArrowLeft":
          if (current?.node.kind === "dir" && expanded.has(current.node.id)) {
            e.preventDefault();
            toggleExpand(current.node.id);
          } else if (current) {
            e.preventDefault();
            // Jump to parent.
            const chain = ancestorsOf(nodes, current.node.id);
            const parent = chain[chain.length - 1];
            if (parent) moveFocus(visible.findIndex((v) => v.node.id === parent.id));
          }
          break;
        case "Home":
          e.preventDefault();
          moveFocus(0);
          break;
        case "End":
          e.preventDefault();
          moveFocus(visible.length - 1);
          break;
        case "Enter":
          if (current) {
            e.preventDefault();
            if (current.node.kind === "dir") toggleExpand(current.node.id);
            else onOpen?.(current.node);
          }
          break;
        case " ":
          if (current) {
            e.preventDefault();
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(current.node.id)) next.delete(current.node.id);
              else next.add(current.node.id);
              return next;
            });
          }
          break;
        case "a":
        case "A":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            setSelected(() => new Set(visible.map((v) => v.node.id)));
          }
          break;
        default:
          break;
      }
    },
    [
      visible,
      focusedId,
      expanded,
      nodes,
      toggleExpand,
      setSelected,
      onOpen,
    ],
  );

  // ----- drag & drop -----------------------------------------------------
  const dragSourceRef = useRef<TreeNodeId | null>(null);
  const [dropTargetId, setDropTargetId] = useState<TreeNodeId | null>(null);

  const handleDragStart = useCallback(
    (node: TreeNode, e: React.DragEvent) => {
      dragSourceRef.current = node.id;
      // jsdom omits dataTransfer; browsers always provide it. Guard so the
      // same code path is testable without a DOM drag implementation.
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", node.id);
      }
    },
    [],
  );

  const handleDragOver = useCallback(
    (node: TreeNode, e: React.DragEvent) => {
      const sourceId = dragSourceRef.current;
      if (!sourceId) return;
      if (canDrop(nodes, sourceId, node.id)) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        setDropTargetId(node.id);
      }
    },
    [nodes],
  );

  const handleDragLeave = useCallback((node: TreeNode) => {
    setDropTargetId((prev) => (prev === node.id ? null : prev));
  }, []);

  const handleDrop = useCallback(
    (node: TreeNode, e: React.DragEvent) => {
      e.preventDefault();
      const sourceId = dragSourceRef.current;
      dragSourceRef.current = null;
      setDropTargetId(null);
      if (!sourceId) return;
      if (!canDrop(nodes, sourceId, node.id)) return;
      const source = findSource(nodes, sourceId);
      if (source) onMove?.(source, node);
    },
    [nodes, onMove],
  );

  // ----- context menu ----------------------------------------------------
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    node: TreeNode;
    items: FileTreeContextMenuItem[];
  } | null>(null);

  const handleContextMenu = useCallback(
    (node: TreeNode, e: React.MouseEvent) => {
      if (!renderContextMenu) return;
      e.preventDefault();
      // Select the node if it's not already part of the selection.
      if (!selected.has(node.id)) {
        setSelected(() => new Set([node.id]));
      }
      setFocusedId(node.id);
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        node,
        items: renderContextMenu(node),
      });
    },
    [renderContextMenu, selected, setSelected],
  );

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  // ----- render ----------------------------------------------------------
  if (visible.length === 0) {
    return (
      <div className={styles.empty + (className ? " " + className : "")}>
        {emptyLabel}
      </div>
    );
  }

  return (
    <div
      className={styles.root + (className ? " " + className : "")}
      style={{ height }}
      data-testid="file-tree"
    >
      <div
        ref={scrollRef}
        className={styles.scroll}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="tree"
        aria-label="文件树"
      >
        <div className={styles.spacer} style={{ height: totalHeight }}>
          {windowRows.map(({ node, depth }, i) => {
            const absoluteIdx = startIdx + i;
            return (
              <div
                key={node.id}
                className={styles.rowSlot}
                style={{ top: absoluteIdx * ROW_HEIGHT }}
              >
                <FileTreeRow
                  node={node}
                  depth={depth}
                  expanded={node.kind === "dir" && expanded.has(node.id)}
                  selected={selected.has(node.id)}
                  focused={focusedId === node.id}
                  dropTarget={dropTargetId === node.id}
                  onClick={handleRowClick}
                  onDoubleClick={handleDoubleClick}
                  onChevronClick={handleChevronClick}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onContextMenu={handleContextMenu}
                  badge={renderBadge?.(node)}
                />
              </div>
            );
          })}
        </div>
      </div>

      {ctxMenu ? (
        <div
          className={styles.contextMenu}
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {ctxMenu.items.map((item, idx) => (
            <div key={idx}>
              {item.separatorBefore ? <div className={styles.menuSep} /> : null}
              <button
                type="button"
                role="menuitem"
                className={
                  styles.menuItem + (item.danger ? " " + styles.menuItemDanger : "")
                }
                disabled={item.disabled}
                onClick={() => {
                  setCtxMenu(null);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function findSource(nodes: TreeNode[], id: TreeNodeId): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const hit = findSource(n.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** Re-export the pure helper so hosts can apply the same move semantics. */
export { moveNode };
