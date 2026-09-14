/**
 * perf-streaming-schema.mjs — extracted schema + helpers for
 * `perf-streaming.mjs`. Kept separate so vitest can import the
 * pure helpers without booting Electron, and so the JSON report
 * shape has a single source of truth shared by the runner, the
 * nightly aggregator, and the test.
 *
 * Schemas are described as plain objects so a vitest unit test can
 * iterate `Object.entries(report)` and assert every documented field
 * is present and well-typed.
 */
export const STREAMING_REPORT_SCHEMA = "openbuddy.ai-chat-streaming.v1";

export const STREAMING_REPORT_FIELDS = Object.freeze({
  schema: "string",
  generatedAt: "string",
  credentialSource: "string",
  model: "string",
  baseUrl: "string",
  promptChars: "number",
  streamDurationMs: "number",
  firstDeltaMs: "number",
  outputTokensEst: "number",
  tokensPerSecond: "number",
  rendererFps: "number",
  totalFrames: "number",
  droppedFrames: "number",
  dropRate: "number",
});

export const STREAMING_PROMPT =
  "请用中文详细列出 80 条常见的 Python 编程最佳实践，每条至少两句话，不少于 30 个汉字；" +
  "输出 Markdown 项目符号列表。不要调用任何工具，直接回答。";

/**
 * Estimate output tokens from the rendered assistant text. CJK + markdown
 * mixed text averages ~4 characters per output token for the MiniMax
 * family — the same heuristic `perf-baseline.mjs` uses for its transcript
 * rendering measurement, kept here so the streaming report and the
 * baseline report stay comparable.
 */
export function estimateOutputTokens(text) {
  const chars = (text ?? "").replace(/\s+/g, "").length;
  return Math.max(1, Math.round(chars / 4));
}

/**
 * Compute FPS + dropped-frame rate from an array of frame deltas
 * (milliseconds between consecutive rAF callbacks). A frame is
 * "dropped" when its dt > 32ms (i.e. < 30 fps).
 */
export function summarizeFrameDeltas(deltas) {
  if (!Array.isArray(deltas) || deltas.length === 0) {
    return { rendererFps: -1, totalFrames: 0, droppedFrames: 0, dropRate: -1 };
  }
  const total = deltas.length;
  const dropped = deltas.filter((dt) => typeof dt === "number" && dt > 32).length;
  const sum = deltas.reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
  const avgDt = sum / total;
  return {
    rendererFps: Number((1000 / avgDt).toFixed(2)),
    totalFrames: total,
    droppedFrames: dropped,
    dropRate: Number((dropped / total).toFixed(4)),
  };
}

/**
 * Build an empty report skeleton pre-populated with sentinel
 * `-1` values for every numeric field. The runner overwrites them
 * with real measurements; the sentinel shape keeps the JSON shape
 * stable across runs (CI dashboards rely on it).
 */
export function createStreamingReport({ credentialSource, model, baseUrl }) {
  return {
    schema: STREAMING_REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    credentialSource: credentialSource ?? "unknown",
    model: model ?? "unknown",
    baseUrl: baseUrl ?? "",
    promptChars: STREAMING_PROMPT.length,
    streamDurationMs: -1,
    firstDeltaMs: -1,
    outputTokensEst: -1,
    tokensPerSecond: -1,
    rendererFps: -1,
    totalFrames: -1,
    droppedFrames: -1,
    dropRate: -1,
  };
}
