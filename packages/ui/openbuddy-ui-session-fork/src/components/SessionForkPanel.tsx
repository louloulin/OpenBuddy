/**
 * SessionForkPanel — visualize and manage forked conversation threads.
 * Phase 2 / C7.
 *
 * Mirrors PI-Desktop `apps/desktop/components/ConversationSessionForkPanel.tsx`
 * (ADR 0023). Each fork is shown as a tree branch from its parent, with the
 * active fork highlighted. The user can switch focus to any fork, create new
 * forks at any message, and prune forks they no longer need.
 */
import { useMemo, useState } from "react";
import styles from "./SessionForkPanel.module.css";

export interface SessionFork {
  id: string;
  parentId: string | null;
  label: string;
  createdAt: string;
  /** Message line where the fork originated. */
  fromLineNo?: number;
  messageCount: number;
}

export interface SessionForkPanelProps {
  rootSessionId: string;
  forks: readonly SessionFork[];
  activeForkId: string;
  onSelectFork?: (forkId: string) => void;
  onCreateFork?: (fromLineNo: number) => void;
  onDeleteFork?: (forkId: string) => void;
  className?: string;
}

interface ForkNode {
  fork: SessionFork;
  children: ForkNode[];
  depth: number;
}

function buildTree(forks: readonly SessionFork[]): ForkNode[] {
  const byParent = new Map<string | null, SessionFork[]>();
  for (const f of forks) {
    const list = byParent.get(f.parentId) ?? [];
    list.push(f);
    byParent.set(f.parentId, list);
  }
  function build(parent: string | null, depth: number): ForkNode[] {
    const list = byParent.get(parent) ?? [];
    return list.map((fork) => ({
      fork,
      depth,
      children: build(fork.id, depth + 1),
    }));
  }
  return build(null, 0);
}

export function SessionForkPanel(props: SessionForkPanelProps) {
  const { rootSessionId, forks, activeForkId, onSelectFork, onCreateFork, onDeleteFork, className } = props;
  const [pendingForkLine, setPendingForkLine] = useState<string>("");
  const tree = useMemo(() => buildTree(forks), [forks]);

  const renderNode = (node: ForkNode) => {
    const active = node.fork.id === activeForkId;
    return (
      <li
        key={node.fork.id}
        className={styles.branchLi}
        data-testid={`fork-${node.fork.id}`}
        data-active={active ? "true" : undefined}
      >
        <div
          className={[styles.branch, active ? styles.branchActive : ""].filter(Boolean).join(" ")}
          style={{ marginLeft: node.depth * 16 }}
          onClick={() => onSelectFork?.(node.fork.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSelectFork?.(node.fork.id);
          }}
          tabIndex={0}
          role="treeitem"
          aria-selected={active || undefined}
        >
          <span className={styles.label}>{node.fork.label}</span>
          <span className={styles.meta}>
            {node.fork.messageCount} msgs · {node.fork.createdAt}
            {typeof node.fork.fromLineNo === "number" ? ` · from L${node.fork.fromLineNo}` : ""}
          </span>
          {onDeleteFork && node.fork.parentId !== null ? (
            <button
              type="button"
              className={styles.deleteBtn}
              onClick={(e) => { e.stopPropagation(); onDeleteFork(node.fork.id); }}
              data-testid={`fork-delete-${node.fork.id}`}
              aria-label={`Delete fork ${node.fork.label}`}
            >
              ×
            </button>
          ) : null}
        </div>
        {node.children.length > 0 ? (
          <ul className={styles.children}>{node.children.map(renderNode)}</ul>
        ) : null}
      </li>
    );
  };

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(" ")} data-testid="session-fork-panel" data-root={rootSessionId}>
      <header className={styles.header}>
        <h2 className={styles.title}>Session forks</h2>
        <p className={styles.subtitle}>Conversation {rootSessionId.slice(0, 8)} · {forks.length} fork{forks.length === 1 ? "" : "s"}</p>
      </header>
      {onCreateFork ? (
        <div className={styles.create}>
          <input
            type="number"
            min={1}
            placeholder="Line no"
            value={pendingForkLine}
            onChange={(e) => setPendingForkLine(e.target.value)}
            className={styles.lineInput}
            data-testid="fork-create-line"
          />
          <button
            type="button"
            className={styles.createBtn}
            disabled={!pendingForkLine.trim()}
            onClick={() => {
              const n = parseInt(pendingForkLine, 10);
              if (Number.isFinite(n) && n > 0) {
                onCreateFork(n);
                setPendingForkLine("");
              }
            }}
            data-testid="fork-create-btn"
          >
            New fork
          </button>
        </div>
      ) : null}
      <ul className={styles.tree} role="tree">{tree.map(renderNode)}</ul>
    </div>
  );
}
