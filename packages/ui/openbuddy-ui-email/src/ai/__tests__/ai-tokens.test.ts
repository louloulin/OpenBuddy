/**
 * ai-tokens — CSS 变量定义一致性校验单测。
 */
import { describe, expect, it } from "vitest";
import { AI_TOKEN_PALETTE, WB_TOKEN_FALLBACK, validateTokensConsistency } from "../ai-tokens";

describe("ai-tokens", () => {
  it("AI_TOKEN_PALETTE 至少 13 个 token", () => {
    expect(Object.keys(AI_TOKEN_PALETTE).length).toBeGreaterThanOrEqual(13);
  });

  it("WB_TOKEN_FALLBACK 覆盖 ai.css 引用的 19 个 token", () => {
    // 这些是 ai.css 里 var(--wb-*) 引用的 token — 必须都在 fallback 里。
    const usedInAiCss = [
      "--wb-accent", "--wb-accent-fg", "--wb-accent-soft",
      "--wb-bg-primary", "--wb-bg-secondary", "--wb-bg-tertiary", "--wb-bg-elevated",
      "--wb-border", "--wb-border-soft",
      "--wb-fg-primary", "--wb-fg-secondary", "--wb-fg-tertiary",
      "--wb-font",
      "--wb-radius-sm", "--wb-radius-md", "--wb-radius-lg", "--wb-radius-xl",
      "--wb-shadow-md", "--wb-shadow-lg",
    ];
    const { missing } = validateTokensConsistency(usedInAiCss);
    expect(missing).toEqual([]);
  });

  it("validateTokensConsistency 报告 orphan references", () => {
    const { missing } = validateTokensConsistency(["--wb-does-not-exist"]);
    expect(missing).toContain("--wb-does-not-exist");
  });

  it("validateTokensConsistency 报告 unused fallback token", () => {
    const { unused } = validateTokensConsistency([]);
    expect(unused.length).toBeGreaterThan(0);
  });

  it("token 值不为空", () => {
    for (const [name, value] of Object.entries(WB_TOKEN_FALLBACK)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
    for (const [name, value] of Object.entries(AI_TOKEN_PALETTE)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
