import { parseSessionEntries, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SearchMatchRange } from "@openbuddy/protocol/search";

/**
 * Full-text session search (pii W1.4). The index keeps the normalized message text (user +
 * assistant text, as Pi's `SessionManager.listAll()` reports it in `allMessagesText`) per session
 * file. A refresh stats every file and parses only the new or changed ones (mtime/size), so a
 * search over an unchanged directory costs one readdir + stat per file, and one changed session
 * costs one parse. It never touches the sidebar's list cache.
 */

type MessageLike = { role?: unknown; content?: unknown; timestamp?: unknown };
const textOf = (message: MessageLike) =>
  typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
      ? message.content.filter((b: { type?: string }) => b?.type === "text").map((b: { text?: string }) => b.text ?? "").join(" ")
      : "";

/**
 * One session file as Pi's `listAll()` describes it (same header check, name, first message,
 * message text and activity time), read on its own. Null when it is not a session file.
 */
export async function readSessionInfo(path: string): Promise<SessionInfo | null> {
  try {
    const [content, stats] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    const [header, ...entries] = parseSessionEntries(content) as Array<Record<string, any>>;
    if (header?.type !== "session") return null;
    let name: string | undefined;
    let firstMessage = "";
    let messageCount = 0;
    let lastActivity: number | undefined;
    const texts: string[] = [];
    for (const entry of entries) {
      if (entry.type === "session_info") name = (entry.name as string | undefined)?.trim() || undefined;
      if (entry.type !== "message") continue;
      messageCount++;
      const message = (entry.message ?? {}) as MessageLike;
      if ((message.role !== "user" && message.role !== "assistant") || !("content" in message)) continue;
      const at = typeof message.timestamp === "number" ? message.timestamp : new Date(entry.timestamp).getTime();
      if (!Number.isNaN(at)) lastActivity = Math.max(lastActivity ?? 0, at);
      const text = textOf(message);
      if (!text) continue;
      texts.push(text);
      if (!firstMessage && message.role === "user") firstMessage = text;
    }
    const headerTime = typeof header.timestamp === "string" ? new Date(header.timestamp).getTime() : NaN;
    return {
      path,
      id: header.id,
      cwd: typeof header.cwd === "string" ? header.cwd : "",
      name,
      parentSessionPath: header.parentSession,
      created: new Date(header.timestamp),
      modified: lastActivity ? new Date(lastActivity) : !Number.isNaN(headerTime) ? new Date(headerTime) : stats.mtime,
      messageCount,
      firstMessage: firstMessage || "(no messages)",
      allMessagesText: texts.join(" "),
    };
  } catch {
    return null;
  }
}

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
    /** Reads one session file (tests count the calls). */
    private readonly read: (path: string) => Promise<SessionInfo | null> = readSessionInfo,
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
    const next = new Map<string, Doc>();
    let rebuilt = 0;
    const changed: Array<[string, string]> = [];
    for (const [name, stamp] of stamps) {
      const path = join(this.dir, name);
      const previous = this.docs.get(path);
      if (previous && previous.stamp === stamp) next.set(path, previous);
      else changed.push([path, stamp]);
    }
    // Parse the new and changed files only, a few at a time.
    for (let i = 0; i < changed.length; i += 16) {
      await Promise.all(changed.slice(i, i + 16).map(async ([path, stamp]) => {
        const info = await this.read(path);
        if (!info) return;
        rebuilt++;
        const text = searchableText(info.allMessagesText ?? "");
        next.set(path, { id: info.id, path, cwd: info.cwd, name: info.name, firstMessage: info.firstMessage, modified: info.modified, stamp, text, lower: text.toLowerCase() });
      }));
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
