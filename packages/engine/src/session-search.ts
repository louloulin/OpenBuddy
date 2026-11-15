import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SearchMatchRange } from "@openbuddy/protocol/search";

/**
 * Full-text session search (pii W1.4). The text comes from Pi's `SessionManager.listAll()`
 * (`SessionInfo.allMessagesText`: user + assistant text). The index keeps the normalized text
 * per session file and only rebuilds files whose mtime/size changed; a search over an unchanged
 * directory costs one readdir + stat per file, no parsing.
 */

/**
 * Wrappers the host and renderer put into prompts before Pi records them (see chat-core
 * `user-text.ts`): mode instructions, expert personas, skill bodies, inlined attachment bodies,
 * project briefs. They would make every session match common words, so they are not searchable;
 * attachment and skill names are kept.
 */
const INJECTED: Array<[RegExp, string]> = [
  [/<openbuddy-(plan|ask)-mode>[\s\S]*?<\/openbuddy-\1-mode>/g, " "],
  [/<!--EXPERT_PERSONA_BEGIN-->[\s\S]*?<!--EXPERT_PERSONA_END-->/g, " "],
  [/<skill name="([^"]*)"[^>]*>[\s\S]*?<\/skill>/g, " $1 "],
  [/<attachment name="([^"]*)">[\s\S]*?<\/attachment>/g, " $1 "],
  [/\[项目「[^」]*」背景与规范\][\s\S]*?\[用户消息\]/g, " "],
  [/【角色设定 — [^】]*】[\s\S]*?用户的第一个问题：/g, " "],
];

/** The searchable form of a session's message text: injected blocks removed, whitespace collapsed. */
export function searchableText(raw: string): string {
  let text = raw;
  for (const [pattern, replacement] of INJECTED) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, " ").trim();
}

/** Lower-cased, de-duplicated whitespace-separated terms (at most 8); all of them must match. */
export function searchTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, 8);
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Sorted, merged [start, end) ranges of every term inside `text` (case-insensitive). */
export function highlightRanges(text: string, terms: string[]): SearchMatchRange[] {
  const ranges: SearchMatchRange[] = [];
  for (const term of terms) {
    if (!term) continue;
    for (const match of text.matchAll(new RegExp(escapeRegExp(term), "giu"))) {
      const at = match.index ?? 0;
      ranges.push([at, at + match[0].length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: SearchMatchRange[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** Index of `needle` (lower-cased) in `text`, using the cached lower-case copy when it lines up. */
function indexIn(text: string, lower: string, needle: string): number {
  if (lower.length === text.length) return lower.indexOf(needle);
  return text.search(new RegExp(escapeRegExp(needle), "iu"));
}

/**
 * A ~`size`-character excerpt around the first hit (the whole phrase first, else the earliest
 * term), with `…` on cut ends and the term ranges inside the excerpt.
 */
export function makeSnippet(text: string, terms: string[], phrase?: string, lower = text.toLowerCase(), size = 120, before = 32) {
  let pos = phrase && terms.length > 1 ? indexIn(text, lower, phrase) : -1;
  if (pos < 0) {
    const hits = terms.map((term) => indexIn(text, lower, term)).filter((i) => i >= 0);
    pos = hits.length ? Math.min(...hits) : 0;
  }
  let end = Math.min(text.length, Math.max(pos - before, 0) + size);
  let start = Math.max(0, Math.min(pos - before, end - size));
  if (start > 0 && isLowSurrogate(text.charCodeAt(start))) start--;
  if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end++;
  const prefix = start > 0 ? "…" : "";
  const body = text.slice(start, end);
  const snippet = prefix + body + (end < text.length ? "…" : "");
  const matches = highlightRanges(body, terms).map(([a, b]): SearchMatchRange => [a + prefix.length, b + prefix.length]);
  return { snippet, matches };
}

function countIn(lower: string, term: string, cap: number): number {
  let count = 0;
  for (let i = lower.indexOf(term); i !== -1 && count < cap; i = lower.indexOf(term, i + term.length)) count++;
  return count;
}

export interface IndexedSession {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  firstMessage: string;
  modified: Date;
}
interface Doc extends IndexedSession {
  /** `mtimeMs:size` of the file when its text was indexed. */
  stamp: string;
  text: string;
  lower: string;
}
export interface SearchResult {
  session: IndexedSession;
  snippet: string;
  matches: SearchMatchRange[];
  matchedIn: "title" | "content" | "both";
  matchCount: number;
  rank: number;
}
export interface SearchOptions {
  /** Only sessions whose cwd is exactly this (already canonical). */
  cwd?: string;
  limit?: number;
  /** Display title, matched as well as the text (defaults to the session name). */
  title?: (session: IndexedSession) => string;
}

export class SessionSearchIndex {
  private docs = new Map<string, Doc>();
  private signature?: string;
  private pending?: Promise<void>;
  /** What the last refresh did (diagnostics and tests). */
  lastRefresh = { rebuilt: 0, total: 0, skipped: true };
  constructor(
    private readonly dir: string,
    /** Fresh `SessionManager.listAll(dir)` results. */
    private readonly list: () => Promise<SessionInfo[]>,
  ) {}

  /** `mtimeMs:size` per session file name in the directory. */
  private async stamps(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((name) => name.endsWith(".jsonl"));
    } catch {
      return out;
    }
    await Promise.all(names.map(async (name) => {
      try {
        const s = await stat(join(this.dir, name));
        out.set(name, `${s.mtimeMs}:${s.size}`);
      } catch { /* removed while listing */ }
    }));
    return out;
  }

  /** Bring the index up to date; a no-op (no parsing) when no session file changed. */
  refresh(): Promise<void> {
    this.pending ??= this.doRefresh().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async doRefresh() {
    const stamps = await this.stamps();
    const signature = [...stamps].map(([name, stamp]) => `${name}=${stamp}`).sort().join("|");
    if (signature === this.signature) {
      this.lastRefresh = { rebuilt: 0, total: this.docs.size, skipped: true };
      return;
    }
    const infos = await this.list();
    const next = new Map<string, Doc>();
    let rebuilt = 0;
    for (const info of infos) {
      const stamp = stamps.get(basename(info.path)) ?? `modified:${info.modified.getTime()}`;
      const meta = { id: info.id, path: info.path, cwd: info.cwd, name: info.name, firstMessage: info.firstMessage, modified: info.modified };
      const previous = this.docs.get(info.path);
      if (previous && previous.stamp === stamp) {
        next.set(info.path, { ...previous, ...meta });
        continue;
      }
      rebuilt++;
      const text = searchableText(info.allMessagesText ?? "");
      next.set(info.path, { ...meta, stamp, text, lower: text.toLowerCase() });
    }
    this.docs = next;
    this.signature = signature;
    this.lastRefresh = { rebuilt, total: next.size, skipped: false };
  }

  /** Sessions where every term appears in the title or the messages, best first. */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    await this.refresh();
    const terms = searchTerms(query);
    if (!terms.length) return [];
    const phrase = query.trim().toLowerCase().replace(/\s+/g, " ");
    const results: Array<SearchResult & { doc: Doc }> = [];
    for (const doc of this.docs.values()) {
      if (options.cwd !== undefined && doc.cwd !== options.cwd) continue;
      const titleLower = (options.title?.(doc) ?? doc.name ?? "").toLowerCase();
      let rank = 0, matchCount = 0, inTitle = false, inContent = false, all = true;
      for (const term of terms) {
        const titleHit = titleLower.includes(term);
        const count = countIn(doc.lower, term, 50);
        if (!titleHit && !count) { all = false; break; }
        if (titleHit) { inTitle = true; rank += 8; }
        if (count) { inContent = true; matchCount += count; rank += Math.min(count, 10); }
      }
      if (!all) continue;
      if (terms.length > 1 && (doc.lower.includes(phrase) || titleLower.includes(phrase))) rank += 5;
      results.push({ doc, session: doc, snippet: "", matches: [], matchedIn: inTitle && inContent ? "both" : inTitle ? "title" : "content", matchCount, rank });
    }
    results.sort((a, b) => b.rank - a.rank || b.doc.modified.getTime() - a.doc.modified.getTime());
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    return results.slice(0, limit).map(({ doc, ...result }) => {
      // Snippets only for what is returned; a title-only hit previews the start of the conversation.
      const excerpt = result.matchedIn === "title" ? { snippet: makeSnippet(doc.text, [], undefined, doc.lower).snippet, matches: [] } : makeSnippet(doc.text, terms, phrase, doc.lower);
      const session: IndexedSession = { id: doc.id, path: doc.path, cwd: doc.cwd, name: doc.name, firstMessage: doc.firstMessage, modified: doc.modified };
      return { ...result, ...excerpt, session };
    });
  }
}
