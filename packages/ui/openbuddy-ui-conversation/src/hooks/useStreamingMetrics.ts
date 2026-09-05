/**
 * useStreamingMetrics — Phase R3.0 (pi-web-alignment).
 *
 * Real-time tokens/sec + estimated-token-count calculator for a streaming
 * assistant message. Mirrors pi-web `MessageView.tsx` behavior:
 *
 *   - `setInterval(tick, 300)` during streaming; cleared on unmount.
 *   - Token count is updated each tick via `estimateUpdatedTokens` so we
 *     only pay for the suffix, not the whole accumulated string.
 *   - TPS = totalTokens / (now - streamStartMs).
 *   - `streamStartMs` resets on every isStreaming transition.
 *
 * Returns `{ estimatedTokens, tps }` — both numbers, both referentially
 * stable when unchanged (the hook only re-renders on tick, not on every
 * delta).
 */
import { useEffect, useRef, useState } from "react";
import {
  estimateTokens,
  estimateUpdatedTokens,
} from "../lib/streaming-metrics";

const TICK_INTERVAL_MS = 300;

export interface UseStreamingMetricsInput {
  /** Concatenated streaming text (current snapshot). */
  text: string;
  /** True while the message is still streaming. */
  isStreaming: boolean;
}

export interface UseStreamingMetricsResult {
  /** Most-recent estimated token count. */
  estimatedTokens: number;
  /** Tokens/sec (0 when no stream has started yet). */
  tps: number | null;
}

export function useStreamingMetrics({
  text,
  isStreaming,
}: UseStreamingMetricsInput): UseStreamingMetricsResult {
  const [tick, setTick] = useState(0);
  const streamStartMsRef = useRef<number | null>(null);
  const lastTextRef = useRef<string>("");
  const lastTokensRef = useRef<number>(0);

  // Drive a 300 ms timer while the message is streaming. Cleared on unmount
  // and when isStreaming flips off.
  useEffect(() => {
    if (!isStreaming) {
      streamStartMsRef.current = null;
      return;
    }
    const handle = window.setInterval(() => {
      setTick((n) => n + 1);
    }, TICK_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [isStreaming]);

  // Empty state for non-streaming messages — keep last reading frozen so
  // the badge doesn't flicker to "0 t/s" right after the model finishes.
  if (!isStreaming && tick === 0) {
    return { estimatedTokens: estimateTokens(text), tps: null };
  }

  const now = Date.now();
  if (streamStartMsRef.current === null && isStreaming) {
    streamStartMsRef.current = now;
  }

  const lastText = lastTextRef.current;
  const updatedTokens = estimateUpdatedTokens(
    { text: lastText, tokens: lastTokensRef.current },
    text,
  );
  lastTextRef.current = text;
  lastTokensRef.current = updatedTokens;

  let tps: number | null = null;
  if (streamStartMsRef.current !== null) {
    const elapsedMs = now - streamStartMsRef.current;
    if (elapsedMs > 0) {
      tps = (updatedTokens / elapsedMs) * 1000;
    }
  }
  // tick is read to keep this hook re-rendering on every interval tick;
  // the actual numbers above are stable per tick.
  void tick;

  return { estimatedTokens: Math.round(updatedTokens), tps };
}