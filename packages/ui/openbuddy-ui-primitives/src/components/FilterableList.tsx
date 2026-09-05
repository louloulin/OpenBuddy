import { useMemo, useState, type ReactNode } from "react";

export interface FilterableListItem<T> {
  /** Stable identifier used as the React key and for selection. */
  id: string;
  /** Original record the consumer can render. */
  record: T;
}

export interface FilterableListProps<T> {
  items: readonly T[];
  /** Human-readable haystack extracted from each record; usually a string or array of strings. */
  getHaystack: (record: T) => string | readonly string[];
  /** Default filter text shown in the input on first mount. */
  initialQuery?: string;
  /** Optional placeholder rendered when no record matches the filter. */
  emptyState?: ReactNode;
  /** Optional header rendered above the search input. */
  header?: ReactNode;
  /** Optional class names applied to the outer wrapper. */
  className?: string;
  /** Render the items; the consumer decides how to map record → JSX. */
  children: (visible: readonly FilterableListItem<T>[]) => ReactNode;
}

/**
 * Reusable "type-to-search + list" container that mirrors the
 * `FilterableList` abstraction found in the pi TUI. Keeps every list
 * page (sessions, tasks, automation, memory, inspiration) visually
 * consistent and removes ~250 lines of inline filter plumbing.
 */
export function FilterableList<T>({
  items,
  getHaystack,
  initialQuery = "",
  emptyState,
  header,
  className,
  children,
}: FilterableListProps<T>) {
  const [query, setQuery] = useState(initialQuery);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items.map((record, index) => ({ id: `idx-${index}`, record }));
    return items
      .filter((record) => {
        const haystack = getHaystack(record);
        const parts = Array.isArray(haystack) ? haystack : [haystack];
        return parts.some((part) => typeof part === "string" && part.toLowerCase().includes(needle));
      })
      .map((record, index) => ({ id: `idx-${index}`, record }));
  }, [items, query, getHaystack]);

  return (
    <section className={className}>
      {header}
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder="Filter…"
        aria-label="Filter list"
      />
      {visible.length === 0 ? (emptyState ?? <p>No matches.</p>) : children(visible)}
    </section>
  );
}