'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search, CornerDownLeft, FileText } from 'lucide-react';
import { CATEGORY_LABELS, type SearchEntry } from '@/lib/docs-meta';
import { extractLocaleFromPath, getDictionary, localizedPath, type Locale } from '@/lib/i18n';

export const OPEN_SEARCH_EVENT = 'openbuddy:search';

interface SearchDialogProps {
  index: SearchEntry[];
}

interface Scored {
  entry: SearchEntry;
  score: number;
  /** The heading that matched, when the hit came from a section rather than the doc itself */
  matchedHeading?: string;
}

const MAX_RESULTS = 8;

/**
 * Score one entry against the tokenized query.
 * Weighting: title ≫ heading > description > excerpt. Every token must hit
 * something (AND semantics) so multi-word queries narrow instead of widen.
 */
function scoreEntry(entry: SearchEntry, tokens: string[]): Scored | null {
  if (tokens.length === 0) return null;
  const title = entry.title.toLowerCase();
  const desc = entry.description.toLowerCase();
  const excerpt = entry.excerpt.toLowerCase();
  const headings = entry.headings.map((h) => h.toLowerCase());
  const slug = entry.slug.toLowerCase();

  let score = 0;
  let matchedHeading: string | undefined;

  for (const token of tokens) {
    let tokenScore = 0;
    if (title.startsWith(token)) tokenScore += 120;
    else if (title.includes(token)) tokenScore += 80;
    if (slug.includes(token)) tokenScore += 30;

    const headingIdx = headings.findIndex((h) => h.includes(token));
    if (headingIdx >= 0) {
      tokenScore += 40;
      if (!matchedHeading) matchedHeading = entry.headings[headingIdx];
    }
    if (desc.includes(token)) tokenScore += 18;
    if (excerpt.includes(token)) tokenScore += 6;
    if (entry.category.includes(token)) tokenScore += 5;

    if (tokenScore === 0) return null; // AND semantics
    score += tokenScore;
  }
  return { entry, score, matchedHeading };
}

export default function SearchDialog({ index }: SearchDialogProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const locale: Locale = extractLocaleFromPath(pathname ?? '/');
  const dict = getDictionary(locale).search;

  const results = useMemo<Scored[]>(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    return index
      .map((entry) => scoreEntry(entry, tokens))
      .filter((r): r is Scored => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS);
  }, [index, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActive(0);
    restoreFocusRef.current?.focus();
    restoreFocusRef.current = null;
  }, []);

  const openDialog = useCallback(() => {
    restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    setOpen(true);
  }, []);

  // Global triggers: Cmd/Ctrl+K toggles, and any component may dispatch OPEN_SEARCH_EVENT.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => {
          if (o) {
            setQuery('');
            setActive(0);
            return false;
          }
          restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;
          return true;
        });
        return;
      }
      if (e.key === 'Escape') {
        setOpen((o) => {
          if (!o) return false;
          setQuery('');
          setActive(0);
          return false;
        });
      }
    };
    const onOpen = () => openDialog();
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
    };
  }, [openDialog]);

  // Focus the input once the dialog mounts.
  useEffect(() => {
    if (!open) return;
    const t = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [open]);

  // Keep the active row scrolled into view during arrow navigation.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const go = useCallback(
    (entry: SearchEntry) => {
      const base = localizedPath(`/docs/${entry.slug}`, locale);
      close();
      router.push(base);
    },
    [close, locale, router]
  );

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = results[active];
      if (hit) go(hit.entry);
    }
  }

  if (!open) return null;

  const hasQuery = query.trim().length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={dict.trigger}
      className="fixed inset-0 z-[60] flex items-start justify-center bg-[var(--wb-mask)] p-4 pt-[12vh] backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] shadow-wb-overlay"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="flex items-center gap-3 border-b border-[var(--wb-border)] px-4">
          <Search className="h-4 w-4 shrink-0 text-[var(--wb-fg-faint)]" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={dict.placeholder}
            aria-label={dict.placeholder}
            className="h-14 w-full bg-transparent text-[15px] text-[var(--wb-fg)] outline-none placeholder:text-[var(--wb-fg-faint)]"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden shrink-0 rounded-md border border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--wb-fg-muted)] sm:inline-block">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[52vh] overflow-y-auto">
          {!hasQuery ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[13px] text-[var(--wb-fg-muted)]">{dict.empty}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {index.slice(0, 5).map((d) => (
                  <button
                    key={d.slug}
                    type="button"
                    onClick={() => setQuery(d.title)}
                    className="rounded-full border border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-2.5 py-1 text-[11.5px] text-[var(--wb-fg-muted)] transition-colors hover:text-[var(--wb-fg)]"
                  >
                    {d.title}
                  </button>
                ))}
              </div>
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-[var(--wb-fg-muted)]">
              {dict.noResults}
            </div>
          ) : (
            <ul ref={listRef} className="py-1.5">
              {results.map((r, i) => (
                <li key={r.entry.slug}>
                  <button
                    type="button"
                    data-idx={i}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r.entry)}
                    className={`flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                      i === active ? 'bg-[var(--wb-bg-soft)]' : ''
                    }`}
                  >
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[var(--wb-fg-faint)]" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-medium text-[var(--wb-fg)]">
                          {r.entry.title}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--wb-fg-faint)]">
                          {CATEGORY_LABELS[r.entry.category][locale === 'zh-CN' ? 'zh' : 'en']}
                        </span>
                      </span>
                      {r.matchedHeading ? (
                        <span className="mt-0.5 block truncate text-[12px] text-[var(--wb-brand-deep)]">
                          ↳ {r.matchedHeading}
                        </span>
                      ) : (
                        <span className="mt-0.5 block truncate text-[12.5px] text-[var(--wb-fg-muted)]">
                          {r.entry.description}
                        </span>
                      )}
                    </span>
                    {i === active ? (
                      <CornerDownLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--wb-fg-faint)]" aria-hidden />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between border-t border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-4 py-2 text-[11px] text-[var(--wb-fg-faint)]">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="wb-kbd">↑</kbd>
              <kbd className="wb-kbd">↓</kbd>
              {dict.hintNavigate}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="wb-kbd">↵</kbd>
              {dict.hintSelect}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="wb-kbd">esc</kbd>
            {dict.hintClose}
          </span>
        </div>
      </div>
    </div>
  );
}
