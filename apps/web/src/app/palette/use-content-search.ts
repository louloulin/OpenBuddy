import { useEffect, useRef, useState } from "react";
import { sessionSearch } from "@openbuddy/client/api/session";
import type { SessionSearchHit } from "@openbuddy/protocol/search";

const CJK = /[぀-ヿ㐀-鿿가-힯]/;
/** Long enough to search message text: 2 characters, or 1 CJK character. */
export const searchable = (query: string) => {
  const q = query.trim();
  return q.length >= 2 || (q.length === 1 && CJK.test(q));
};

/**
 * The palette's 内容 group (pii W1.4): debounced `session_search`, newest request wins.
 * `enabled` comes from the FeatureRegistry (the host serves `session_search`).
 */
export function useContentSearch(query: string, enabled: boolean, delay = 180) {
  const [hits, setHits] = useState<SessionSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    if (!enabled || !searchable(query)) {
      setHits([]);
      setSearching(false);
      setFailed(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      sessionSearch(query.trim(), undefined, 20)
        .then((result) => { if (id === seq.current) { setHits(result); setFailed(false); } })
        .catch(() => { if (id === seq.current) { setHits([]); setFailed(true); } })
        .finally(() => { if (id === seq.current) setSearching(false); });
    }, delay);
    return () => clearTimeout(timer);
  }, [query, enabled, delay]);
  return { hits, searching, failed };
}

/**
 * What to put in the chat's find bar after opening a hit: the whole query when it occurs as a
 * phrase in the snippet, else its longest term (the bar matches one substring).
 */
export function findTermFor(query: string, hit: Pick<SessionSearchHit, "snippet">): string {
  const q = query.trim();
  const terms = q.split(/\s+/).filter(Boolean);
  if (terms.length <= 1 || hit.snippet.toLowerCase().includes(q.toLowerCase())) return q;
  return terms.reduce((a, b) => (b.length > a.length ? b : a));
}
