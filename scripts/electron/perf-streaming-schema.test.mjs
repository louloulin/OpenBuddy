import { describe, expect, it } from "vitest";
import {
  STREAMING_REPORT_SCHEMA,
  STREAMING_REPORT_FIELDS,
  STREAMING_PROMPT,
  createStreamingReport,
  estimateOutputTokens,
  summarizeFrameDeltas,
} from "./perf-streaming-schema.mjs";

describe("perf-streaming schema", () => {
  it("uses the documented schema id and freezes the field catalogue", () => {
    expect(STREAMING_REPORT_SCHEMA).toBe("openbuddy.ai-chat-streaming.v1");
    // Frozen so the runner can't accidentally mutate the catalogue.
    expect(Object.isFrozen(STREAMING_REPORT_FIELDS)).toBe(true);
  });

  it("createStreamingReport populates every documented field with the right type", () => {
    const report = createStreamingReport({
      credentialSource: "env",
      model: "MiniMax-M3",
      baseUrl: "https://example.invalid",
    });

    for (const [field, expected] of Object.entries(STREAMING_REPORT_FIELDS)) {
      expect(report[field], `field ${field} should exist`).toBeDefined();
      expect(typeof report[field], `field ${field} type`).toBe(expected);
    }
    expect(report.schema).toBe(STREAMING_REPORT_SCHEMA);
    expect(report.credentialSource).toBe("env");
    expect(report.model).toBe("MiniMax-M3");
    expect(report.baseUrl).toBe("https://example.invalid");
    expect(report.promptChars).toBe(STREAMING_PROMPT.length);
    // Numeric sentinels must be -1 so JSON shape is stable across runs.
    expect(report.streamDurationMs).toBe(-1);
    expect(report.tokensPerSecond).toBe(-1);
    expect(report.dropRate).toBe(-1);
  });

  it("createStreamingReport tolerates missing metadata", () => {
    const report = createStreamingReport({});
    expect(report.credentialSource).toBe("unknown");
    expect(report.model).toBe("unknown");
    expect(report.baseUrl).toBe("");
  });

  it("estimateOutputTokens applies the 4-chars-per-token heuristic", () => {
    expect(estimateOutputTokens("")).toBe(1); // never zero — fallback for empty text
    expect(estimateOutputTokens("abcd")).toBe(1);
    expect(estimateOutputTokens("abcdefgh")).toBe(2);
    expect(estimateOutputTokens("a".repeat(400))).toBe(100);
  });

  it("estimateOutputTokens ignores whitespace so Markdown lists stay honest", () => {
    // 100 visible chars but 50% whitespace => still 100 chars => 25 tokens.
    const text = "你好 ".repeat(25);
    expect(estimateOutputTokens(text)).toBe(Math.round(50 / 4));
  });

  it("summarizeFrameDeltas reports fps + dropRate from rAF samples", () => {
    const deltas = [16, 16, 16, 33, 16, 50, 16]; // 2 dropped frames
    const summary = summarizeFrameDeltas(deltas);
    expect(summary.totalFrames).toBe(7);
    expect(summary.droppedFrames).toBe(2);
    expect(summary.dropRate).toBeCloseTo(2 / 7, 4);
    expect(summary.rendererFps).toBeGreaterThan(0);
  });

  it("summarizeFrameDeltas returns a stable empty-report shape", () => {
    expect(summarizeFrameDeltas([])).toEqual({
      rendererFps: -1,
      totalFrames: 0,
      droppedFrames: 0,
      dropRate: -1,
    });
    expect(summarizeFrameDeltas(undefined)).toEqual({
      rendererFps: -1,
      totalFrames: 0,
      droppedFrames: 0,
      dropRate: -1,
    });
  });

  it("summarizeFrameDeltas skips non-numeric entries defensively", () => {
    const summary = summarizeFrameDeltas([16, null, 16, undefined, 100]);
    expect(summary.totalFrames).toBe(5);
    expect(summary.droppedFrames).toBe(1); // only 100ms > 32ms
  });
});
