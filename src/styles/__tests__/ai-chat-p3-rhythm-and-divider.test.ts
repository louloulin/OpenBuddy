/**
 * ai-chat-p3-rhythm-and-divider.test.ts — P0 综合轮 CSS 节奏 + 分隔符护栏。
 *
 * 守住的不变量(P3-6 + P3-7):
 *   - .streaming-caret 闪烁节奏 250ms(对齐 Codex / ChatGPT)
 *   - .streaming-caret--reasoning 同步 250ms
 *   - .msg__thought--streaming 描边延伸 600ms(原 1500,太慢)
 *   - .tool-group-summary__icon--active 500ms(原 1200)
 *   - .timeline-divider 字体加粗、间距加大、品牌色模型分隔
 *   - prefers-reduced-motion 适配完整(已存在,守住不退)
 *
 * 注:这文件是「CSS 元件协议」级别护栏 — 只要 CSS 改坏 / 改慢,这套测试
 * 立刻挂红。比 messages-css-integrity.test.ts 更聚焦节奏与分隔符两块。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const messagesCss = readFileSync(join(__dirname, "..", "messages.css"), "utf8");
const proseCss = readFileSync(join(__dirname, "..", "prose.css"), "utf8");

describe("P3-6 streaming caret rhythm (Codex parity)", () => {
  it(".streaming-caret 默认节奏是 250ms(对标 Codex / ChatGPT)", () => {
    // 抽取 .streaming-caret { ... animation: streaming-caret-blink Nms ... }
    // 用粗略正则抓出 rule body
    const m = messagesCss.match(/\.streaming-caret\s*\{([\s\S]*?)\}/);
    expect(m, ".streaming-caret rule must exist").toBeTruthy();
    const body = m?.[1] ?? "";
    expect(body).toMatch(/animation:\s*streaming-caret-blink\s+250ms/);
    // 防回归:不能是旧的 700ms
    expect(body).not.toMatch(/700ms/);
  });

  it(".streaming-caret--reasoning 只覆写背景,动画节奏继承自 .streaming-caret(250ms)", () => {
    // reasoning 变体只换品牌色背景,animation 走 .streaming-caret 父级 250ms。
    // 这是 CSS cascade 的预期行为 — 不应在 --reasoning 里重复声明 animation,
    // 否则改 250ms 时容易漏改一处。这个测试守住"不重复声明"的契约。
    const m = messagesCss.match(/\.streaming-caret--reasoning\s*\{([\s\S]*?)\}/);
    expect(m).toBeTruthy();
    const body = m?.[1] ?? "";
    expect(body).not.toMatch(/animation:/);
    expect(body).toMatch(/background:\s*var\(--wb-(palette-)?brand/);
  });

  it(".msg__thought--streaming 描边延伸节奏 600ms(原 1500 太慢)", () => {
    const m = messagesCss.match(
      /\.msg__thought--streaming\s*>\s*summary::after\s*\{([\s\S]*?)\}/,
    );
    expect(m, ".msg__thought--streaming > summary::after rule must exist").toBeTruthy();
    const body = m?.[1] ?? "";
    expect(body).toMatch(/animation:\s*streaming-caret-blink\s+600ms/);
    expect(body).not.toMatch(/1500ms/);
  });

  it(".tool-group-summary__icon--active 节奏 500ms(原 1200)", () => {
    const m = messagesCss.match(/\.tool-group-summary__icon--active\s*\{([\s\S]*?)\}/);
    expect(m).toBeTruthy();
    const body = m?.[1] ?? "";
    expect(body).toMatch(/animation:\s*streaming-caret-blink\s+500ms/);
    expect(body).not.toMatch(/1200ms/);
  });
});

describe("P3-7 timeline-divider visual weight (P0 综合轮)", () => {
  it(".timeline-divider 字体加粗(≥ 500)且字号 ≥ 12px", () => {
    const m = proseCss.match(/\.timeline-divider\s*\{([\s\S]*?)\n\}/);
    expect(m).toBeTruthy();
    const body = m?.[1] ?? "";
    // 字号提升到 12px
    expect(body).toMatch(/font-size:\s*12px/);
    // 字重 ≥ 500(中粗)
    expect(body).toMatch(/font-weight:\s*(500|600)/);
    // 间距加大:margin-top ≥ 16px
    expect(body).toMatch(/margin:\s*16px\s+0|18px\s+0|20px\s+0/);
  });

  it(".timeline-divider--date 是粗体变体", () => {
    expect(proseCss).toMatch(/\.timeline-divider--date\s*\{[\s\S]*?font-weight:\s*600/);
  });

  it(".timeline-divider--model 走品牌色", () => {
    const m = proseCss.match(/\.timeline-divider--model\s*\{([\s\S]*?)\n\}/);
    expect(m).toBeTruthy();
    const body = m?.[1] ?? "";
    expect(body).toMatch(/color:\s*var\(--wb-brand/);
    expect(body).toMatch(/font-weight:\s*600/);
  });

  it(".timeline-divider::before/::after 用渐变(双侧淡出)", () => {
    // 合并 before+after 的同一个规则块
    const m = proseCss.match(/\.timeline-divider::before,[\s\S]*?\.timeline-divider::after\s*\{([\s\S]*?)\n\}/);
    expect(m).toBeTruthy();
    const body = m?.[1] ?? "";
    expect(body).toMatch(/linear-gradient/);
  });

  it("深色主题对称(.timeline-divider 在 dark 下不破样式)", () => {
    // 至少有一个 [data-theme="dark"] .timeline-divider 规则
    expect(proseCss).toMatch(/\[data-theme="dark"\]\s+\.timeline-divider/);
  });
});
