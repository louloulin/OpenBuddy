/**
 * theme-font-wiring.test.ts — guard spec for "主题字体真的影响 UI"。
 *
 * 背景(修复前):`@openbuddy/ui-theme` 的 19 套主题都声明了 `font` /
 * `headingFont`,但它们只用在 ThemePicker 的预览卡片里 —— 没有任何 CSS 消费
 * 这两个字段写出的变量,于是"换主题只换颜色,字体一动不动"。
 *
 * 修复分两步,这个 spec 钉住第二步(消费侧):
 *   1. `resolveThemeVars()` 把主题字体展开成 `--wb-font` / `--wb-font-heading`
 *      (展开自引用,见 `packages/ui/openbuddy-ui-theme/src/__tests__`)。
 *   2. 产品样式必须真的读这两个 token:
 *      - `base.css` 的 body 用 `var(--wb-font, …)`;
 *      - `prose.css` 的 markdown h1-h4 用 `var(--wb-font-heading, …)`;
 *      - `ui-editor` 正文沿用 `var(--wb-font, inherit)`(无需改动,但钉住它)。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const baseCss = read("src/styles/base.css");
const proseCss = read("src/styles/prose.css");
const editorCss = read("packages/ui/openbuddy-ui-editor/src/styles/index.css");

function ruleBody(css: string, selector: string): string | null {
  const idx = css.indexOf(selector + " {");
  if (idx < 0) return null;
  const end = css.indexOf("}", idx);
  return end < 0 ? null : css.slice(idx, end);
}

describe("主题字体 token 消费侧", () => {
  it("body 读 --wb-font,并保留 --wb-font-family-base 作为宿主覆盖点", () => {
    const body = ruleBody(baseCss, "body");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/font-family:\s*var\(--wb-font,/);
    expect(body!).toContain("var(--wb-font-family-base");
  });

  it("markdown 标题读 --wb-font-heading,默认 inherit", () => {
    const headings = ruleBody(proseCss, ".markdown-body h4");
    expect(headings).toBeTruthy();
    expect(proseCss).toMatch(/font-family:\s*var\(--wb-font-heading,\s*inherit\)/);
  });

  it("编辑器正文沿用 --wb-font(主题字体自动作用于编辑区)", () => {
    expect(editorCss).toMatch(/font-family:\s*var\(--wb-font,\s*inherit\)/);
  });
});
