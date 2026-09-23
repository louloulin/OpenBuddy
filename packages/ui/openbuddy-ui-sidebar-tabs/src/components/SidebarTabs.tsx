/**
 * SidebarTabs — multi-project tabs bar for the sidebar.
 * Phase 2 / C6.
 *
 * Mirrors PI-Desktop `apps/desktop/components/SidebarOrganizationTabs.tsx`
 * (ADR 0016). Allows the user to keep several active projects pinned and
 * switch between them without losing scroll/cursor state.
 *
 * The component is purely additive — it renders as a header above the
 * existing `Sidebar` widget and calls back into the host shell via
 * `onActivate` / `onClose` so the host can persist the tab state.
 */
import { useEffect, useMemo, useRef } from "react";
import styles from "./SidebarTabs.module.css";

export interface SidebarTab {
  id: string;
  name: string;
  /** ISO timestamp; used for sort + freshness badge. */
  lastOpenedAt: string;
  /** Path badge; truncated for display. */
  path?: string;
  /** Optional indicator count (e.g. pending permission requests). */
  pending?: number;
}

export interface SidebarTabsProps {
  tabs: readonly SidebarTab[];
  activeId: string;
  onActivate?: (id: string) => void;
  onClose?: (id: string) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onNewProject?: () => void;
  className?: string;
  /** Sort order: "recency" (default) or "manual" (no auto-sort). */
  sortBy?: "recency" | "manual";
}

export function SidebarTabs(props: SidebarTabsProps) {
  const { tabs, activeId, onActivate, onClose, onReorder, onNewProject, className, sortBy = "recency" } = props;
  const sorted = useMemo(() => {
    if (sortBy === "manual") return tabs;
    return [...tabs].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  }, [tabs, sortBy]);
  const dragIndex = useRef<number | null>(null);

  return (
    <div
      className={[styles.wrap, className].filter(Boolean).join(" ")}
      role="tablist"
      data-testid="sidebar-tabs"
      data-tab-count={tabs.length}
    >
      <ol className={styles.list}>
        {sorted.map((tab, idx) => {
          const active = tab.id === activeId;
          return (
            <li
              key={tab.id}
              role="tab"
              aria-selected={active || undefined}
              data-active={active ? "true" : undefined}
              className={[styles.tab, active ? styles.tabActive : ""].filter(Boolean).join(" ")}
              data-testid={`sidebar-tab-${tab.id}`}
              draggable={!!onReorder}
              onDragStart={() => { dragIndex.current = idx; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex.current !== null && dragIndex.current !== idx && onReorder) {
                  onReorder(dragIndex.current, idx);
                }
                dragIndex.current = null;
              }}
              onClick={() => onActivate?.(tab.id)}
            >
              <span className={styles.tabName}>{tab.name}</span>
              {tab.path ? <span className={styles.tabPath}>{tab.path}</span> : null}
              {typeof tab.pending === "number" && tab.pending > 0 ? (
                <span className={styles.tabPending} data-testid={`sidebar-tab-pending-${tab.id}`}>
                  {tab.pending}
                </span>
              ) : null}
              {onClose ? (
                <button
                  type="button"
                  className={styles.close}
                  aria-label={`Close ${tab.name}`}
                  onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                  data-testid={`sidebar-tab-close-${tab.id}`}
                >
                  ×
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
      {onNewProject ? (
        <button
          type="button"
          className={styles.newProject}
          onClick={onNewProject}
          data-testid="sidebar-tab-new"
          aria-label="Open new project"
        >
          +
        </button>
      ) : null}
    </div>
  );
}
