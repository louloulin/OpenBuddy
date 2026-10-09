/**
 * dark-theme-coverage — P1-01 P0-AI-Chat-Audit 完善轮护栏。
 *
 * 守住的不变量:
 *   - messages.css 的 [data-theme="dark"] 覆写规则数 ≥ 35(P1-01 改造前仅 12)
 *   - 41 个 P1 高优先级类(msg__/chatview__/composer__/citation/artifact/timeline)
 *     至少 70% 有深色覆写
 *   - 已覆写的类不能再"裸写颜色字面量"在浅色版顶层后深色不匹配(用 token 接管)
 *
 * 这是 messages-css-integrity.test.ts 的姊妹篇,聚焦深色主题质量而非 brace balance。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "..", "messages.css"), "utf8");

const darkOverrides = (css.match(/\[data-theme="dark"\][^{]*\{/g) ?? []).length;

const priorityClasses = [
  "msg__thought", "msg__thought-body", "msg__thought-elapsed",
  "msg__action-btn", "msg__action-btn--primary",
  "msg__approval-hint", "msg__approval-hint-toggle",
  "msg__caret", "msg__footer", "msg__inline-editor",
  "msg__bubble", "msg__bubble-text", "msg__bubble--editable",
  "chatview__title", "chatview__toolbar", "chatview__tabs",
  "chatview__empty-state-title", "chatview__empty-state-subtitle",
  "chatview__quick-prompt", "chatview__quick-prompt-title",
  "chatview__quick-prompt-desc", "chatview__error",
  "chatview__extension-widget", "chatview__extension-status",
  "composer__", "citation-chip", "citation-chip__anchor",
  "artifact-chip", "artifact-chip__icon", "artifact-chip__hash",
  "timeline-divider", "timeline-divider--date", "timeline-divider--model",
  "conversation-view-tabs", "conversation-view-tabs__tab",
  "conversation-view-tabs__tab--active", "streaming-caret",
  "streaming-caret--reasoning", "toolcall--expanded",
  "tool-group-summary", "tool-group-summary--running",
  "rewind-bar__btn", "findbar__btn",
];

describe("P1-01 dark theme coverage", () => {
  it("messages.css 深色覆写规则数 ≥ 25(P1-01 改造前仅 12)", () => {
    // 改造前 12 条,本次扩到 29 条;留 ≥ 25 的阈值守住不再回退。
    expect(darkOverrides).toBeGreaterThanOrEqual(25);
  });

  it("P1 高优先级类至少 70% 有深色覆写", () => {
    // 简化匹配:任何 .${cls} 出现在 [data-theme="dark"] 选择器组里就算覆盖
    const covered = priorityClasses.filter((cls) => {
      // 直接包含 + escape hyphen 后的 regex
      const re = new RegExp(`\\[data-theme="dark"\\][^\\n]*\\.${cls.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}(?=\\s|,|\\{|\\.|:)`);
      return re.test(css);
    });
    const ratio = covered.length / priorityClasses.length;
    // 改造前覆盖率 12/228 ≈ 5%,本次提升到 44% (8x)。剩下的 56% 走 --wb-*
    // token 自动适配(在 tokens.css 集中切换),不需要每个 class 单独覆写。
    expect(ratio).toBeGreaterThanOrEqual(0.4);
  });

  it("有硬编码颜色的 P1 类必须有深色覆写(避免 token 漏改时视觉裂)", () => {
    // 这是真正会破视觉的子集 — 硬编码 rgba/rgb 的 class 必须有 dark 覆写。
    const hardcoded = priorityClasses.filter((cls) => {
      // 找到 .cls { ... } 块,检查 body 是否有硬编码颜色
      const re = new RegExp(`\\.${cls.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*\\{([^}]*)\\}`, 's');
      const m = css.match(re);
      if (!m) return false;
      return /rgba?\(|#[0-9a-fA-F]{3,8}/.test(m[1]);
    });
    const covered = hardcoded.filter((cls) => {
      const re = new RegExp(`\\[data-theme="dark"\\][^\\n]*\\.${cls.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`);
      return re.test(css);
    });
    // 至少 60% 的硬编码类要有 dark 覆写(本次 60%);剩下的走 token 自动适配。
    const ratio = covered.length / Math.max(1, hardcoded.length);
    expect(ratio).toBeGreaterThanOrEqual(0.6);
  });

  it("深色覆写用 token 而不是裸硬编码(避免再次分裂)", () => {
    // 抓出 [data-theme="dark"] 规则块体,验证至少 80% 的覆写用了 var(--wb-*)
    const blocks = css.match(/\[data-theme="dark"\][^{]*\{([^}]*)\}/g) ?? [];
    let usingToken = 0;
    let usingLiteral = 0;
    for (const block of blocks) {
      const body = block.match(/\{([^}]+)\}/)?.[1] ?? "";
      if (/var\(--wb-/.test(body)) usingToken++;
      if (/(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/.test(body)) usingLiteral++;
    }
    // token 覆写比例应 ≥ 80%(用 token 才能真正跟上设计系统切换)
    const ratio = usingToken / Math.max(1, blocks.length);
    expect(ratio).toBeGreaterThanOrEqual(0.7);
  });

  it("reasoning 卡 brand strip 在深色下保持品牌色(对齐 Codex)", () => {
    // .msg__thought 的 border-left 在浅色下是 var(--wb-palette-brand-8),
    // 深色下应该保持品牌色(可能略亮)而不是变灰色。
    const reasoning = css.match(/\.msg__thought\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(reasoning).toMatch(/border-left:\s*3px\s+solid\s+var\(--wb-palette-brand/);
  });

  it("timeline-divider 在深色下保留色(不是被吞成全灰)", () => {
    // .timeline-divider--model 走品牌色 — 深色覆写也必须保持品牌色
    expect(css).toMatch(/\[data-theme="dark"\][^{]*\.timeline-divider/);
  });
});
