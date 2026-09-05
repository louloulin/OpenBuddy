/**
 * BranchNavigator.tsx — session fork tree navigator.
 *
 * Phase 5 (UI 差距补齐) sub-item B: 对标 pi-web 的会话树分叉导航。渲染会话树
 * （含分支/压缩/消息节点），点击节点跳转到对应会话位置。数据来自阶段 4 的
 * `sessionTree` 投影（`{ id, parentId, branch, summary, createdAt, children }`）。
 *
 * 纯展示组件：输入为 `tree`（纯数据），输出为可点击的树。为保持包解耦，
 * 本组件接受与 `@openbuddy/core-session` 的 `SessionTreeBranch` 同形的节点，
 * 由消费方（App）负责把 sessionTree 输出映射进来。
 */
import type { ReactNode } from "react";

export interface BranchNode {
  id: string;
  parentId: string | null;
  branch: string;
  summary?: string;
  createdAt: string;
  children: BranchNode[];
}

export interface BranchNavigatorProps {
  /** Session tree roots (from sessionTree projection). */
  tree: BranchNode[];
  /** Currently active node id. */
  activeId?: string;
  /** Called when a node is selected. */
  onSelect?: (id: string) => void;
  className?: string;
}

/** Map a branch kind to a short label + icon. */
export function branchLabel(branch: string): { label: string; icon: ReactNode } {
  switch (branch) {
    case "message":
      return { label: "消息", icon: "💬" };
    case "compaction":
      return { label: "压缩", icon: "🗜️" };
    case "branch_summary":
      return { label: "分支", icon: "🌿" };
    case "model_change":
      return { label: "模型", icon: "🤖" };
    case "thinking_level_change":
      return { label: "思考", icon: "🧠" };
    case "custom":
      return { label: "自定义", icon: "🧩" };
    case "custom_message":
      return { label: "扩展消息", icon: "🧩" };
    case "label":
      return { label: "标记", icon: "🏷️" };
    case "session_info":
      return { label: "会话", icon: "📄" };
    default:
      return { label: branch, icon: "•" };
  }
}

export function BranchNavigator({ tree, activeId, onSelect, className }: BranchNavigatorProps) {
  if (tree.length === 0) return null;

  return (
    <div
      className={"branch-navigator" + (className ? ` ${className}` : "")}
      role="tree"
      aria-label="会话分支导航"
      data-testid="branch-navigator"
    >
      {tree.map((node) => (
        <BranchNodeView key={node.id} node={node} depth={0} activeId={activeId} onSelect={onSelect} />
      ))}
    </div>
  );
}

function BranchNodeView({
  node,
  depth,
  activeId,
  onSelect,
}: {
  node: BranchNode;
  depth: number;
  activeId?: string;
  onSelect?: (id: string) => void;
}) {
  const active = node.id === activeId;
  const { label, icon } = branchLabel(node.branch);
  return (
    <div className="branch-navigator__node" role="treeitem" aria-selected={active || undefined}>
      <button
        type="button"
        className={"branch-navigator__node-button" + (active ? " branch-navigator__node-button--active" : "")}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onSelect?.(node.id)}
        data-testid={`branch-node-${node.id}`}
        title={node.summary ?? label}
      >
        <span className="branch-navigator__node-icon" aria-hidden="true">{icon}</span>
        <span className="branch-navigator__node-label">{label}</span>
        {node.summary ? <span className="branch-navigator__node-summary">{node.summary}</span> : null}
      </button>
      {node.children.length > 0 && (
        <div className="branch-navigator__children" role="group">
          {node.children.map((child) => (
            <BranchNodeView key={child.id} node={child} depth={depth + 1} activeId={activeId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
