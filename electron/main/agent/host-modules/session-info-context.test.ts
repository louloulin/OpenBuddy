/**
 * 20261031 Phase 1.7 — agent:session-info 返回渲染层上下文胶囊读取的 `context`
 * 结构。此前直接透传 Pi 的 `{ tokens, contextWindow, percent }`(字段名
 * `contextUsage`),胶囊读 `context.total` 永远为空,上下文环从未显示。
 */
import { describe, expect, it } from "vitest";
import { toContextInfo } from "./session-store";

describe("toContextInfo", () => {
  it("映射 Pi 用量并给出自动压缩阈值", () => {
    const ctx = toContextInfo({
      usage: { tokens: 50_000, contextWindow: 200_000, percent: 25 },
      systemPrompt: "x".repeat(4000),
      toolDefinitions: [{ name: "read", description: "d", parameters: {} }],
      messageCount: 6,
      compaction: { enabled: true, reserveTokens: 16_384 },
    });
    expect(ctx).toMatchObject({
      used: 50_000,
      total: 200_000,
      usagePct: 25,
      systemPromptTokens: 1000,
      toolDefinitionsCount: 1,
      messageCount: 6,
      freeTokens: 150_000,
      autoCompactThresholdPercent: 92,
    });
    expect((ctx as { messageTokens: number }).messageTokens).toBeLessThan(49_000);
  });

  it("压缩后用量未知(tokens=null)或无模型窗口时返回 null,不伪造 0%", () => {
    const base = { systemPrompt: "", toolDefinitions: [], messageCount: 0 };
    expect(toContextInfo({ ...base, usage: { tokens: null, contextWindow: 1000, percent: null } })).toBeNull();
    expect(toContextInfo({ ...base, usage: undefined })).toBeNull();
  });

  it("关闭自动压缩时不给阈值", () => {
    const ctx = toContextInfo({
      usage: { tokens: 10, contextWindow: 1000, percent: 1 },
      systemPrompt: "",
      toolDefinitions: [],
      messageCount: 1,
      compaction: { enabled: false, reserveTokens: 100 },
    });
    expect(ctx).not.toHaveProperty("autoCompactThresholdPercent");
  });
});
