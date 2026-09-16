/**
 * R27 — 实心胶囊色 `--wb-bg-pill-active` 的配对前景色守卫。
 *
 * 背景:亮色主题下 `--wb-bg-pill-active` 是 `rgba(0, 0, 0, 0.75)`(实心黑胶囊,
 * 给发送按钮 / 场景 tab 用)。它一旦被拿来当"选中行 / 选中片"的底色、却继续用
 * `--wb-text-strong`(亮色下接近纯黑)当文字色,就是**黑底黑字**。
 *
 * 真机实测到的两处(修复前):
 *   - `/` 补全菜单的选中行:bg rgba(0,0,0,0.75) + color rgba(0,0,0,0.9) → 对比度 ≈ 1.0
 *   - `@` mention 补全的选中行:同上
 *
 * 这条守卫是静态的(不需要真机):任何把 `--wb-bg-pill-active` 当背景的规则,
 * 都不允许把 `--wb-text-*` 当文字色 —— 必须用配对令牌 `--wb-pill-active-fg`。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const STYLE_DIR = join(process.cwd(), "src", "styles");

function styleFiles(): Array<[name: string, css: string]> {
  return readdirSync(STYLE_DIR)
    .filter((name) => name.endsWith(".css"))
    .map((name) => [name, readFileSync(join(STYLE_DIR, name), "utf8")] as [name: string, css: string]);
}

interface Rule {
  file: string;
  selector: string;
  background: string;
  color: string;
}

function rulesUsingPillActive(): Rule[] {
  const out: Rule[] = [];
  for (const [file, css] of styleFiles()) {
    // 朴素但够用:选择器 + { 声明块 },块内出现 --wb-bg-pill-active 即算。
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1].trim().split("\n").pop()?.trim() ?? "";
      const body = match[2];
      const background = /background(?:-color)?:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? "";
      if (!background.includes("--wb-bg-pill-active")) continue;
      const color = /[^-]color:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? "";
      out.push({ file, selector, background, color });
    }
  }
  return out;
}

describe("R27 实心胶囊色必须配对的文字色", () => {
  it("没有任何规则把 --wb-bg-pill-active 当背景却用 --wb-text-* 当文字", () => {
    const offenders = rulesUsingPillActive()
      .filter((rule) => /--wb-text-(strong|medium|tertiary)/.test(rule.color))
      .map((rule) => `${rule.file} :: ${rule.selector} => color: ${rule.color}`);
    expect(offenders).toEqual([]);
  });

  it("`--wb-pill-active-fg` 在亮 / 暗两套里都有定义", () => {
    const tokens = readFileSync(join(STYLE_DIR, "tokens.css"), "utf8");
    const hits = tokens.match(/^\s*--wb-pill-active-fg:/gm) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
    // 亮色胶囊是 75% 黑 → 前景必须是白系
    expect(tokens).toMatch(/--wb-pill-active-fg:\s*var\(--wb-palette-white-100\)/);
  });

  it("列表行 / 选项行用中性活动表面(--wb-bg-active),不吞实心胶囊色", () => {
    const composer = readFileSync(join(STYLE_DIR, "composer.css"), "utf8");
    expect(composer).toMatch(/\.slash-commands__item--active\s*\{[^}]*background:\s*var\(--wb-bg-active\)/);
    const misc = readFileSync(join(STYLE_DIR, "misc.css"), "utf8");
    expect(misc).toMatch(/\.mention-picker__item:hover\s*\{[^}]*background:\s*var\(--wb-bg-active\)/);
    const modals = readFileSync(join(STYLE_DIR, "modals.css"), "utf8");
    expect(modals).toMatch(/\.question-inline__option--selected\s*\{[^}]*background:\s*var\(--wb-bg-active/);
  });
});
