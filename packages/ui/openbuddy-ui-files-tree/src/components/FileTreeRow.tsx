/**
 * @openbuddy/ui-files-tree/FileTreeRow — one row of the tree.
 *
 * Extracted so the virtualization layer can render it in isolation and so
 * the row's DOM shape (chevron / icon / label / badge) stays consistent.
 */
import type { ReactNode } from "react";
import type { TreeNode } from "../lib/tree-utils";
import styles from "./FileTree.module.css";

export interface FileTreeRowProps {
  node: TreeNode;
  depth: number;
  expanded: boolean;
  selected: boolean;
  focused: boolean;
  dropTarget: boolean;
  badge?: ReactNode;
  onClick(node: TreeNode, e: React.MouseEvent): void;
  onDoubleClick(node: TreeNode): void;
  onChevronClick(node: TreeNode, e: React.MouseEvent): void;
  onDragStart(node: TreeNode, e: React.DragEvent): void;
  onDragOver(node: TreeNode, e: React.DragEvent): void;
  onDragLeave(node: TreeNode): void;
  onDrop(node: TreeNode, e: React.DragEvent): void;
  onContextMenu(node: TreeNode, e: React.MouseEvent): void;
}

const INDENT = 14;

export function FileTreeRow({
  node,
  depth,
  expanded,
  selected,
  focused,
  dropTarget,
  badge,
  onClick,
  onDoubleClick,
  onChevronClick,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onContextMenu,
}: FileTreeRowProps) {
  const isDir = node.kind === "dir";
  return (
    <div
      className={
        styles.row +
        (selected ? " " + styles.rowSelected : "") +
        (focused ? " " + styles.rowFocused : "") +
        (dropTarget ? " " + styles.rowDropTarget : "")
      }
      style={{ paddingLeft: 6 + depth * INDENT }}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={isDir ? expanded : undefined}
      aria-level={depth + 1}
      draggable={isDir}
      onClick={(e) => onClick(node, e)}
      onDoubleClick={() => onDoubleClick(node)}
      onContextMenu={(e) => onContextMenu(node, e)}
      onDragStart={(e) => onDragStart(node, e)}
      onDragOver={(e) => onDragOver(node, e)}
      onDragLeave={() => onDragLeave(node)}
      onDrop={(e) => onDrop(node, e)}
      data-node-id={node.id}
      data-node-kind={node.kind}
    >
      {isDir ? (
        <span
          className={styles.chevron + (expanded ? " " + styles.chevronOpen : "")}
          onClick={(e) => onChevronClick(node, e)}
          aria-hidden
        >
          ▸
        </span>
      ) : (
        <span className={styles.chevronSpacer} aria-hidden />
      )}
      <span className={styles.icon} aria-hidden>
        {isDir ? "📁" : fileGlyph(node)}
      </span>
      <span className={styles.label} title={node.path}>
        {node.name}
      </span>
      {node.badge ? <span className={styles.badge}>{node.badge}</span> : null}
      {badge}
    </div>
  );
}

function fileGlyph(node: TreeNode): string {
  const name = node.name.toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  switch (ext) {
    case ".md":
    case ".mdx":
      return "📝";
    case ".json":
    case ".yaml":
    case ".yml":
    case ".toml":
      return "⚙️";
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".gif":
    case ".svg":
    case ".webp":
      return "🖼️";
    case ".pdf":
      return "📕";
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "🧩";
    case ".css":
    case ".scss":
      return "🎨";
    case ".sh":
    case ".zsh":
    case ".bash":
      return "⌨️";
    default:
      return "📄";
  }
}
