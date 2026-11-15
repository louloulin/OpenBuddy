/**
 * In-chat find highlighting (U3.5) with the CSS Custom Highlight API: the matches inside the
 * current hit's message are painted without touching the Markdown DOM, and the first one is
 * scrolled into view. Browsers without the API (and jsdom) only get the scroll.
 */
const NAME = "ob-find";

interface HighlightRegistryLike { set(name: string, value: unknown): void; delete(name: string): void }
const registry = (): HighlightRegistryLike | undefined =>
  typeof CSS !== "undefined" && "highlights" in CSS ? (CSS as unknown as { highlights: HighlightRegistryLike }).highlights : undefined;
const HighlightCtor = (): (new (...ranges: Range[]) => unknown) | undefined =>
  (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

export function clearFindHighlight() {
  registry()?.delete(NAME);
}

/** Ranges of `query` (case-insensitive) in the text under `root`. */
export function findRanges(root: Node, query: string, limit = 200): Range[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && ranges.length < limit; node = walker.nextNode()) {
    const text = (node.nodeValue ?? "").toLowerCase();
    for (let at = text.indexOf(needle); at !== -1 && ranges.length < limit; at = text.indexOf(needle, at + needle.length)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
    }
  }
  return ranges;
}

/** Paint the matches inside the message's container and bring the first into view. */
export function highlightInMessage(container: ParentNode | null, messageId: string, query: string): number {
  const root = container?.querySelector(`[data-msg-ids~="${messageId.replace(/["\\]/g, "\\$&")}"]`);
  clearFindHighlight();
  if (!root) return 0;
  const ranges = findRanges(root, query);
  const Ctor = HighlightCtor();
  if (ranges.length && Ctor) registry()?.set(NAME, new Ctor(...ranges));
  ranges[0]?.startContainer.parentElement?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  return ranges.length;
}
