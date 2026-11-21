/**
 * Split streamed Markdown into top-level chunks that render independently, so
 * finished chunks keep their parsed output and only the tail is re-parsed.
 *
 * A split happens only at a blank line outside code fences / math blocks whose
 * next line clearly starts a new block (not indented, not a list item, not a
 * table row). Documents with reference-style definitions or footnotes are kept
 * whole, because those resolve across the document.
 */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const DEFINITION = /^ {0,3}\[[^\]]+\]:\s|\[\^[^\]]+\]/m;

export function splitMarkdownBlocks(text: string): string[] {
  if (!text || DEFINITION.test(text)) return text ? [text] : [];
  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let math = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(FENCE);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && !line.trim().slice(fenceMatch[1].length).trim()) fence = null;
    } else if (fenceMatch) {
      fence = fenceMatch[1];
    } else if (line.trim() === "$$") {
      math = !math;
    }
    if (!fence && !math && line.trim() === "" && current.some((l) => l.trim() !== "")) {
      const next = lines.slice(i + 1).find((l) => l.trim() !== "");
      const previous = [...current].reverse().find((l) => l.trim() !== "") ?? "";
      const safe = next !== undefined && !/^\s/.test(next) && !LIST_ITEM.test(next) && !next.startsWith("|") && !LIST_ITEM.test(previous) && !/^\s/.test(previous);
      if (safe) {
        blocks.push(current.join("\n"));
        current = [];
        continue;
      }
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks.filter((b) => b.trim() !== "");
}
