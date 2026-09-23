/**
 * Project Archive — manage archived (closed-out) projects in Settings.
 * Phase 2 / C5.
 *
 * Mirrors PI-Desktop `apps/desktop/components/ProjectArchiveSection.tsx`
 * (ADR 0024). The archive is a flat list of inactive projects the user can
 * restore or permanently delete. Each row shows:
 *   - project name + path
 *   - archived date + reason
 *   - restore / delete buttons (destructive actions require explicit confirm)
 */
import { useMemo, useState } from "react";
import styles from "./ProjectArchive.module.css";

export interface ArchivedProject {
  id: string;
  name: string;
  path: string;
  archivedAt: string;
  reason?: string;
  /** Number of sessions / messages in the archive (for the badge). */
  size?: number;
}

export interface ProjectArchiveProps {
  items: readonly ArchivedProject[];
  onRestore?: (id: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onSearch?: (query: string) => void;
  className?: string;
}

export function ProjectArchive(props: ProjectArchiveProps) {
  const { items, onRestore, onDelete, onSearch, className } = props;
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((i) => i.name.toLowerCase().includes(q) || i.path.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(" ")} data-testid="project-archive">
      <header className={styles.header}>
        <h2 className={styles.title}>Project Archive</h2>
        <p className={styles.subtitle}>{items.length} archived project{items.length === 1 ? "" : "s"}.</p>
      </header>
      <input
        type="search"
        placeholder="Search archive…"
        className={styles.search}
        value={query}
        onChange={(e) => { setQuery(e.target.value); onSearch?.(e.target.value); }}
        aria-label="Search archive"
        data-testid="archive-search"
      />
      <ul className={styles.list} role="list">
        {filtered.length === 0 ? (
          <li className={styles.empty} data-testid="archive-empty">
            {items.length === 0 ? "No archived projects yet." : "No matches."}
          </li>
        ) : null}
        {filtered.map((item) => (
          <li key={item.id} className={styles.row} data-testid={`archive-${item.id}`}>
            <div className={styles.info}>
              <div className={styles.name}>
                {item.name}
                {typeof item.size === "number" ? <span className={styles.sizeBadge}>{item.size}</span> : null}
              </div>
              <div className={styles.path}>{item.path}</div>
              <div className={styles.meta}>
                Archived {item.archivedAt}{item.reason ? ` · ${item.reason}` : ""}
              </div>
            </div>
            <div className={styles.actions}>
              {onRestore ? (
                <button
                  type="button"
                  className={styles.btn}
                  onClick={async () => {
                    setBusyId(item.id);
                    try { await onRestore(item.id); } finally { setBusyId(null); }
                  }}
                  disabled={busyId === item.id}
                  data-testid={`archive-restore-${item.id}`}
                >
                  {busyId === item.id ? "Restoring…" : "Restore"}
                </button>
              ) : null}
              {onDelete ? (
                pendingId === item.id ? (
                  <>
                    <button type="button" className={styles.btnDangerConfirm} onClick={async () => { await onDelete(item.id); setPendingId(null); }} data-testid={`archive-confirm-${item.id}`}>
                      Confirm delete
                    </button>
                    <button type="button" className={styles.btn} onClick={() => setPendingId(null)} data-testid={`archive-cancel-${item.id}`}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button type="button" className={styles.btnDanger} onClick={() => setPendingId(item.id)} data-testid={`archive-delete-${item.id}`}>
                    Delete
                  </button>
                )
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
