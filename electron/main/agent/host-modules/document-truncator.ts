/**
 * document-truncator.ts — pure-function sliding-window truncation for
 * document blocks that the host injects into a user prompt.
 *
 * Why: `promptContent` in agent-prompt.ts may concatenate many `<document>`
 * blocks (one per PDF page or per docx paragraph). For a 200-page PDF or a
 * long docx with thousands of paragraphs, the assembled text can blow
 * past the model's context window. Pi upstream currently surfaces a generic
 * "context exceeded" error; users have no recourse but to remove the
 * document.
 *
 * Strategy (plan4.3 §3.6):
 *   - When the *combined* block text exceeds `maxChars`, keep the first
 *     `keepFirst` blocks + the last `keepLast` blocks; emit a synthetic
 *     `<document-truncated>` marker so the model knows middle sections
 *     were dropped (so it doesn't fabricate citations for missing pages).
 *   - The marker is intentionally cheap so it does not push the next
 *     round past the budget (regression test in document-truncator.test.ts).
 *
 * The module is a pure function so it is trivial to test in vitest without
 * booting Electron or pi upstream.
 */
export interface TruncationOptions {
  /** Total character budget for the joined document blocks. */
  maxChars: number;
  /** How many leading blocks to always preserve. */
  keepFirst: number;
  /** How many trailing blocks to always preserve. */
  keepLast: number;
}

export interface TruncationResult {
  blocks: string[];
  /** Total chars in the joined (truncated) blocks. */
  totalChars: number;
  /** Number of blocks dropped during truncation. 0 when no truncation. */
  dropped: number;
  /** True when at least one block was dropped. */
  truncated: boolean;
}

/**
 * Default option set: 24k chars (~6k output tokens for CJK mixed text),
 * keeping the first 4 + last 4 blocks. Calibrated against the
 * `contextWindow: 128_000` default in agent-host so a single very long
 * PDF never pushes the prompt past ~25% of context on its own.
 */
export const DEFAULT_TRUNCATION_OPTIONS: TruncationOptions = Object.freeze({
  maxChars: 24_000,
  keepFirst: 4,
  keepLast: 4,
});

const TRUNCATION_MARKER = "<document-truncated";

const TRUNCATION_MARKER_TEMPLATE = (
  dropped: number,
  keptFirst: number,
  keptLast: number,
): string =>
  `\n\n<document-truncated dropped=${JSON.stringify(dropped)} ` +
  `keptFirst=${JSON.stringify(keptFirst)} keptLast=${JSON.stringify(keptLast)}>\n` +
  `中间 ${dropped} 个文档块已被截断，仅保留首 ${keptFirst} 块与末 ${keptLast} 块；` +
  `请不要引用未提供的段落。\n</document-truncated>`;

function isMarker(block: string): boolean {
  // Markers are wrapped with leading newlines for readability; match the
  // marker tag itself, not the surrounding whitespace.
  return block.includes(TRUNCATION_MARKER);
}

export function truncateDocumentBlocks(
  blocks: readonly string[],
  options: TruncationOptions,
): TruncationResult {
  const totalChars = blocks.join("").length;
  // Real blocks = blocks minus any synthetic markers we previously inserted.
  // Otherwise an idempotency check (`already truncated?`) would treat the
  // marker as just another block and either drop it or recurse forever.
  const realCount = blocks.filter((b) => !isMarker(b)).length;
  const keepable = options.keepFirst + options.keepLast;
  // Skip the marker when one side of the window is empty — the surviving
  // content is unambiguous so the model has no risk of fabricating
  // missing-section citations.
  const emitMarker = options.keepFirst > 0 && options.keepLast > 0;
  if (
    realCount <= keepable ||
    totalChars <= options.maxChars - 256
  ) {
    return { blocks: blocks.slice(), totalChars, dropped: 0, truncated: false };
  }

  const head = blocks.slice(0, options.keepFirst);
  const tail = options.keepLast > 0 ? blocks.slice(-options.keepLast) : [];
  const dropped = realCount - head.length - tail.length;
  if (!emitMarker) {
    const next = [...head, ...tail];
    return {
      blocks: next,
      totalChars: next.join("").length,
      dropped,
      truncated: dropped > 0,
    };
  }
  const marker = TRUNCATION_MARKER_TEMPLATE(dropped, head.length, tail.length);
  const next = [...head, marker, ...tail];
  return {
    blocks: next,
    totalChars: next.join("").length,
    dropped,
    truncated: true,
  };
}