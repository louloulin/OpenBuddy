/**
 * streaming-metrics.ts — Phase R3.0 (pi-web-alignment).
 *
 * Real-time streaming TPS + token estimation for the chat view.
 * Pattern mirrors pi-web `components/MessageView.tsx:5-90` + `:759-826`:
 *
 *   - CJK token estimator: 1 token per CJK char, ~4 chars/token for others.
 *   - Streaming TPS via setInterval(300ms) over accumulated token count.
 *   - Surrogate-pair correction: a streamed delta can complete a surrogate
 *     pair that was counted as two non-CJK code points in the previous
 *     update, so we subtract 1/4 token when the prefix ends on a high
 *     surrogate and the suffix starts on a low surrogate.
 *
 * All inputs are pure data — no React, no store reads. Consumed by
 * `useStreamingMetrics` (React hook) and `estimateTokens` (direct call).
 */

const CJK_PATTERN = /[　-ヿ㐀-鿿豈-﫿\u{20000}-\u{2fa1f}가-힯]/u;

export function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

export function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

/**
 * Estimate token count for a string.
 *   - 1 token per CJK character.
 *   - 4 chars per token for non-CJK content.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let rest = 0;
  for (const ch of text) {
    if (CJK_PATTERN.test(ch)) cjk++;
    else rest++;
  }
  return cjk + rest / 4;
}

/**
 * Streaming-friendly token estimator. If `previous` is provided and the new
 * text extends the previous, we only count the new suffix. Also corrects
 * for a surrogate pair that crosses the previous→current boundary.
 */
export function estimateUpdatedTokens(
  previous: { text: string; tokens: number } | undefined,
  text: string,
): number {
  if (!previous || !text.startsWith(previous.text)) return estimateTokens(text);

  let baseTokens = previous.tokens;
  let suffixStart = previous.text.length;
  if (
    suffixStart > 0 &&
    suffixStart < text.length &&
    isHighSurrogate(previous.text.charCodeAt(suffixStart - 1)) &&
    isLowSurrogate(text.charCodeAt(suffixStart))
  ) {
    baseTokens -= 1 / 4;
    suffixStart--;
  }
  return baseTokens + estimateTokens(text.slice(suffixStart));
}

/**
 * Pick the badge color for a given TPS reading. Mirrors pi-web's
 * MessageView.tsx tps badge palette (>=50 cyan / >=30 green / >=15 yellow
 * / <15 red). Returned as a CSS variable name so the caller can drop it
 * straight into `style={{ background: var(--tps-color) }}`.
 */
export function tpsColor(tps: number): string {
  if (tps >= 50) return "var(--tps-color-fast, #53b3cb)";
  if (tps >= 30) return "var(--tps-color-ok, #9bc53d)";
  if (tps >= 15) return "var(--tps-color-slow, #f9c22e)";
  return "var(--tps-color-laggy, #e01a4f)";
}

/**
 * Format a TPS reading for display: at least 1 decimal place, no trailing
 * zero padding. `12.0 → "12"`, `12.345 → "12.3"`.
 */
export function formatTps(tps: number): string {
  return Number.isInteger(tps) ? tps.toFixed(0) : tps.toFixed(1);
}

/**
 * Format a token count with k/M suffix. 999 → "999", 1234 → "1.2k", 1_500_000
 * → "1.5M". Used by the chat header status pill.
 */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens < 1000) return Math.round(tokens).toString();
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}