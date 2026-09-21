/**
 * ai-tokens — CSS 变量定义一致性校验单测。
 *
 * 覆盖:
 *   - WB_TOKEN_FALLBACK + AI_TOKEN_PALETTE 内容合法性
 *   - ai.css 引用闭合(missing = 0)
 *   - parseCssTokenDefinitions 从任意 CSS 文本抽取 token
 *   - validateTokensConsistency 接受 globalTokenSource(权威来源)做二级校验
 */
import { describe, expect, it } from "vitest";
import {
  AI_TOKEN_PALETTE,
  WB_TOKEN_FALLBACK,
  parseCssTokenDefinitions,
  validateTokensConsistency,
} from "../ai-tokens";

describe("ai-tokens", () => {
  it("AI_TOKEN_PALETTE 至少 13 个 token", () => {
    expect(Object.keys(AI_TOKEN_PALETTE).length).toBeGreaterThanOrEqual(13);
  });

  it("WB_TOKEN_FALLBACK 覆盖 ai.css 引用的所有 token(含 --wb-font-mono)", () => {
    const usedInAiCss = [
      "--wb-accent", "--wb-accent-fg", "--wb-accent-soft",
      "--wb-bg-primary", "--wb-bg-secondary", "--wb-bg-tertiary", "--wb-bg-elevated",
      "--wb-border", "--wb-border-soft",
      "--wb-fg-primary", "--wb-fg-secondary", "--wb-fg-tertiary",
      "--wb-font",
      "--wb-font-mono", // P3-收尾 第 5 轮新增
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
    for (const [, value] of Object.entries(WB_TOKEN_FALLBACK)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
    for (const [, value] of Object.entries(AI_TOKEN_PALETTE)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

describe("parseCssTokenDefinitions", () => {
  it("从 CSS 文本抽取 --name: value 对", () => {
    const css = `
      :root {
        --wb-bg-primary: #ffffff;
        --wb-fg-primary: #1a1a1a;
      }
      .dark { --wb-bg-primary: #000; }
    `;
    const tokens = parseCssTokenDefinitions(css);
    expect(tokens["--wb-bg-primary"]).toBe("#ffffff"); // base :root 取第一个
    expect(tokens["--wb-fg-primary"]).toBe("#1a1a1a");
  });

  it("跳过 var(--xxx) 引用 — 只挑 leaf value", () => {
    const css = `:root { --wb-bg: var(--wb-palette-gray-3); --wb-fg: #111; }`;
    const tokens = parseCssTokenDefinitions(css);
    expect(tokens["--wb-bg"]).toBeUndefined(); // alias 被跳过
    expect(tokens["--wb-fg"]).toBe("#111");
  });

  it("跳过注释里的示例定义", () => {
    const css = `
      /* --wb-fake: 不应被解析; */
      :root { --wb-real: red; }
    `;
    const tokens = parseCssTokenDefinitions(css);
    expect(tokens["--wb-fake"]).toBeUndefined();
    expect(tokens["--wb-real"]).toBe("red");
  });

  it("空 / 非法输入返回空对象", () => {
    expect(parseCssTokenDefinitions("")).toEqual({});
    expect(parseCssTokenDefinitions("/* only comment */")).toEqual({});
  });
});

describe("validateTokensConsistency + globalTokenSource", () => {
  it("传入 globalTokenSource 时,缺口的 token 由 source 兜底", () => {
    const referenced = ["--wb-button-primary", "--wb-text-strong"];
    // 这些 token 都不在 fallback,但在权威 source 里
    const source: Record<string, string> = {
      "--wb-button-primary": "oklch(0.7 0.2 25)",
      "--wb-text-strong": "#1a1a1a",
    };
    const { missing } = validateTokensConsistency(referenced, source);
    expect(missing).toEqual([]);
  });

  it("fallback 和 source 都没命中,才报 missing", () => {
    const referenced = ["--wb-button-primary", "--wb-truly-orphan"];
    const source: Record<string, string> = {
      "--wb-button-primary": "oklch(0.7 0.2 25)",
    };
    const { missing } = validateTokensConsistency(referenced, source);
    expect(missing).toEqual(["--wb-truly-orphan"]);
  });

  it("globalTokenSource 不影响 unused 计算", () => {
    // 即使 source 里有 fallback 没声明的 token,unused 报告 fallback 内部。
    const { unused } = validateTokensConsistency([], { "--wb-foo": "red" });
    // 应该至少有 spacing-* / radius-xl 等 fallback 内部但没被引用
    expect(Array.isArray(unused)).toBe(true);
    expect(unused.length).toBeGreaterThan(0);
  });

  it("parseCssTokenDefinitions 喂入 tokens.css 后,connection-banner 缺口被兜底", () => {
    // 真实场景:读 tokens.css 当 globalTokenSource,跑 validate 应当 zero-missing。
    const tokensCss = `
      :root {
        --wb-button-primary: oklch(0.7 0.2 25);
        --wb-text-strong: #1a1a1a;
        --wb-border-default: #e6e6e6;
        --wb-font-size-md: 14px;
      }
    `;
    const source = parseCssTokenDefinitions(tokensCss);
    // connection-banner.css 实际引用的、fallback 没声明的子集
    const referenced = ["--wb-button-primary", "--wb-text-strong", "--wb-border-default"];
    const { missing } = validateTokensConsistency(referenced, source);
    expect(missing).toEqual([]);
  });
});
