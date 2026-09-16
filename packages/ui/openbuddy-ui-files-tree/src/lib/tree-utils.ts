/**
 * @openbuddy/ui-files-tree/lib/tree-utils — pure tree helpers.
 *
 * Kept dependency-free so it can be unit-tested without React and reused by
 * the host (ui-files, ui-workbench) when projecting raw filesystem entries
 * into the tree model.
 */

export interface TreeNode {
  /** Stable id, usually the absolute path. */
  id: string;
  /** Display name (basename). */
  name: string;
  /** Free-form path or virtual path. */
  path: string;
  kind: "file" | "dir";
  children?: TreeNode[];
  /** Optional mime type for icon selection. */
  mime?: string;
  /** Host-provided badge (e.g. "modified"). */
  badge?: string;
}

export type TreeNodeId = string;

/** Depth-first walk in display order. */
export function flattenTree(
  nodes: TreeNode[],
  expanded: ReadonlySet<TreeNodeId>,
): Array<{ node: TreeNode; depth: number }> {
  const out: Array<{ node: TreeNode; depth: number }> = [];
  const walk = (list: TreeNode[], depth: number) => {
    for (const node of list) {
      out.push({ node, depth });
      if (node.kind === "dir" && expanded.has(node.id) && node.children?.length) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(nodes, 0);
  return out;
}

/** Find a node by id anywhere in the tree. O(n). */
export function findNode(
  nodes: TreeNode[],
  id: TreeNodeId,
): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children?.length) {
      const hit = findNode(node.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** Collect the ids of a node and all its descendants. */
export function collectSubtreeIds(node: TreeNode): Set<TreeNodeId> {
  const ids = new Set<TreeNodeId>();
  const walk = (n: TreeNode) => {
    ids.add(n.id);
    for (const c of n.children ?? []) walk(c);
  };
  walk(node);
  return ids;
}

/** Ancestor chain (root → parent) for a node; excludes the node itself. */
export function ancestorsOf(
  nodes: TreeNode[],
  id: TreeNodeId,
): TreeNode[] {
  const chain: TreeNode[] = [];
  const walk = (list: TreeNode[], path: TreeNode[]): boolean => {
    for (const node of list) {
      if (node.id === id) {
        chain.push(...path);
        return true;
      }
      if (node.children?.length) {
        if (walk(node.children, [...path, node])) return true;
      }
    }
    return false;
  };
  walk(nodes, []);
  return chain;
}

/** Range selection between two visible ids, inclusive, in display order. */
export function rangeSelect(
  visible: Array<{ node: TreeNode; depth: number }>,
  fromId: TreeNodeId,
  toId: TreeNodeId,
): Set<TreeNodeId> {
  const fromIdx = visible.findIndex((v) => v.node.id === fromId);
  const toIdx = visible.findIndex((v) => v.node.id === toId);
  if (fromIdx === -1 || toIdx === -1) return new Set();
  const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
  const out = new Set<TreeNodeId>();
  for (let i = lo; i <= hi; i++) out.add(visible[i].node.id);
  return out;
}

/**
 * Whether `sourceId` may be dropped onto `targetId`. Prevents dropping a
 * folder into itself / its own descendant.
 */
export function canDrop(
  nodes: TreeNode[],
  sourceId: TreeNodeId,
  targetId: TreeNodeId,
): boolean {
  if (sourceId === targetId) return false;
  const source = findNode(nodes, sourceId);
  const target = findNode(nodes, targetId);
  if (!source || !target) return false;
  if (source.kind !== "dir") return false; // v1: only folders are draggable
  if (target.kind !== "dir") return false; // can only drop onto folders
  if (collectSubtreeIds(source).has(targetId)) return false;
  return true;
}

/** Sort: directories first, then case-insensitive name. */
export function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/** Apply a sort recursively. */
export function sortTree(nodes: TreeNode[]): TreeNode[] {
  return sortNodes(nodes).map((n) =>
    n.children?.length ? { ...n, children: sortTree(n.children) } : n,
  );
}

/** Immutably move `sourceId` under `targetId`; returns the new tree. */
export function moveNode(
  nodes: TreeNode[],
  sourceId: TreeNodeId,
  targetId: TreeNodeId,
): TreeNode[] {
  const source = findNode(nodes, sourceId);
  if (!source) return nodes;
  const target = findNode(nodes, targetId);
  if (!target || target.kind !== "dir") return nodes;
  // Reject invalid moves (into self/descendant, files, or onto files) so
  // hosts that call moveNode directly get the same safety as the UI.
  if (!canDrop(nodes, sourceId, targetId)) return nodes;

  const remove = (list: TreeNode[]): TreeNode[] =>
    list
      .filter((n) => n.id !== sourceId)
      .map((n) =>
        n.children?.length ? { ...n, children: remove(n.children) } : n,
      );

  const insert = (list: TreeNode[]): TreeNode[] =>
    list.map((n) => {
      if (n.id === targetId) {
        return {
          ...n,
          children: sortNodes([...(n.children ?? []), source]),
        };
      }
      return n.children?.length ? { ...n, children: insert(n.children) } : n;
    });

  return insert(remove(nodes));
}
