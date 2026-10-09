/**
 * prefers-contrast-coverage — P2-04 P0-AI-Chat-Audit 完善轮护栏。
 *
 * 守住的不变量:
 *   - messages.css 至少 1 个 `@media (prefers-contrast: more)` 块(改造前 0)
 *   - 块内规则数 ≥ 15(覆盖主要可见元素)
 *   - 必须包含以下不变量类:.msg__approval-hint, .streaming-caret, .timeline-divider,
 *     .conversation-view-tabs__tab, .chatview__quick-prompt
 *   - 全局 a11y.css 必须把 focus-visible outline-width 在 contrast 模式下 → 3px
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "..", "messages.css"), "utf8");
const a11y = readFileSync(join(__dirname, "..", "a11y.css"), "utf8");

const contrastBlock = css.match(/@media\s*\(prefers-contrast:\s*more\)\s*\{([\s\S]*?)\n\}/);
const contrastRuleCount = contrastBlock
  ? (contrastBlock[1].match(/^\s*\.[a-zA-Z][^{]*\{/gm) ?? []).length
  : 0;

describe("P2-04 prefers-contrast: more coverage", () => {
  it("messages.css 至少 1 个 prefers-contrast 块(改造前 0)", () => {
    expect(contrastBlock).toBeTruthy();
  });

  it("块内规则数 ≥ 15(覆盖主要可见元素)", () => {
    expect(contrastRuleCount).toBeGreaterThanOrEqual(15);
  });

  it("必须包含核心可见元素覆写", () => {
    expect(css).toMatch(/@media\s*\(prefers-contrast:\s*more\)[\s\S]*\.msg__approval-hint/);
    expect(css).toMatch(/@media\s*\(prefers-contrast:\s*more\)[\s\S]*\.streaming-caret/);
    expect(css).toMatch(/@media\s*\(prefers-contrast:\s*more\)[\s\S]*\.timeline-divider/);
    expect(css).toMatch(/@media\s*\(prefers-contrast:\s*more\)[\s\S]*\.conversation-view-tabs__tab/);
    expect(css).toMatch(/@media\s*\(prefers-contrast:\s*more\)[\s\S]*\.chatview__quick-prompt/);
  });

  it("全局 a11y.css 把 focus 宽度在 contrast 模式下 → 3px", () => {
    // 这是改造前就有的不变量,本次确认守住不退
    const block = a11y.match(/@media\s*\(prefers-contrast:\s*more\)\s*\{([\s\S]*?)\n\}/);
    expect(block).toBeTruthy();
    expect(block?.[1]).toMatch(/outline-width:\s*3px/);
  });

  it("全局 a11y.css prefers-contrast 块存在(已有 a11y 锚点)", () => {
    expect(a11y).toMatch(/@media\s*\(prefers-contrast:\s*more\)/);
  });
});
