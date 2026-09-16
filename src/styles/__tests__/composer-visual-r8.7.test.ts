/**
 * composer-visual-r8.7.test.ts — guard spec for the R8.7 Composer visual
 * polish. Pins the new CSS selectors so future refactors can't silently
 * drop them (which would degrade mention picker shadows / @-chip colors /
 * image-attach remove button feedback).
 *
 * Coverage:
 *   - mention-picker uses the modern 12px radius + 420px width
 *   - mention-picker has the ob-mention-picker-in enter animation
 *   - mention-picker__kind chip uses brand-tinted bg (not hardcoded gray)
 *   - composer-blocks__chip uses color-mix brand (not hardcoded blue)
 *   - composer-image-attachments__remove supports transform transition
 *   - composer-blocks__chip has a hover variant (interactive feedback)
 *   - composer-attachments__chip-remove has focus-visible ring
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const stylesDir = join(__dirname, "..");
const allCss = readdirSync(stylesDir)
  .filter((f) => f.endsWith(".css"))
  .map((f) => readFileSync(join(stylesDir, f), "utf8"))
  .join("\n");

/** Extract the first rule body for `selector` from `css`. Returns the
 *  substring between the opening `{` and the matching `}` (handles
 *  nested braces from @media / nested selectors). */
function ruleBody(css: string, selector: string): string | null {
  const idx = css.indexOf(selector + " {");
  if (idx < 0) return null;
  let depth = 0;
  let start = -1;
  for (let i = idx; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      depth++;
      if (start < 0) start = i + 1;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return css.slice(start, i);
    }
  }
  return null;
}

describe("R8.7 Composer visual polish CSS", () => {
  it("mention-picker has 12px radius (modern popover look)", () => {
    const m = ruleBody(allCss, ".mention-picker");
    expect(m).toBeTruthy();
    expect(m!).toMatch(/border-radius:\s*12px/);
  });

  it("mention-picker has 420px width", () => {
    const m = ruleBody(allCss, ".mention-picker");
    expect(m).toBeTruthy();
    expect(m!).toMatch(/width:\s*420px/);
  });

  it("mention-picker has layered box-shadow (modern depth)", () => {
    const m = ruleBody(allCss, ".mention-picker");
    expect(m).toBeTruthy();
    expect(m!).toMatch(/box-shadow:[^;]*12px 40px rgba\(0,\s*0,\s*0,\s*0\.18\)[^;]*,\s*0 2px 8px rgba\(0,\s*0,\s*0,\s*0\.08\)/);
  });

  it("mention-picker defines the ob-mention-picker-in keyframe", () => {
    expect(allCss).toMatch(/@keyframes\s+ob-mention-picker-in\b/);
    const m = ruleBody(allCss, ".mention-picker");
    expect(m).toBeTruthy();
    expect(m!).toMatch(/animation:\s*ob-mention-picker-in\s+var\(--wb-motion-duration-fast,\s*140ms\)/);
  });

  it("mention-picker__kind chip uses neutral tertiary bg (NOT brand colour-mix)", () => {
    const m = ruleBody(allCss, ".mention-picker__kind");
    expect(m).toBeTruthy();
    // R8.61 - Small chip uses --wb-bg-tertiary (neutral surface);
    // --wb-bg-pill-active is reserved for the full-row selected state.
    expect(m!).toMatch(/var\(--wb-bg-tertiary\)/);
    expect(m!).not.toMatch(/color-mix\(in srgb,\s*var\(--wb-brand/);
  });

  it("mention-picker active item uses neutral pill (NOT brand colour-mix)", () => {
    const m = ruleBody(allCss, ".mention-picker__item--active,\n.mention-picker__item:hover");
    expect(m).toBeTruthy();
    // R8.61 / R27 - Neutral contract: active uses a neutral *surface*
    // (--wb-bg-active). 早期用 --wb-bg-pill-active(亮色 75% 黑),配本行
    // 深色文字 → 亮色主题下黑底黑字。
    expect(m!).toMatch(/var\(--wb-bg-active\)/);
    expect(m!).not.toMatch(/color-mix\(in srgb,\s*var\(--wb-brand/);
  });

  it("composer-blocks__chip uses brand color-mix (not hardcoded blue)", () => {
    const m = ruleBody(allCss, ".composer-blocks__chip");
    expect(m).toBeTruthy();
    expect(m!).toMatch(/color-mix\(in srgb,\s*var\(--wb-brand[^)]*\)/);
    // The hardcoded rgba(0, 122, 255, ...) is gone — that was the old
    // Apple-system blue that clashed in dark theme.
    expect(m!).not.toMatch(/rgba\(0,\s*122,\s*255/);
  });

  it("composer-blocks__chip has a hover variant", () => {
    expect(allCss).toMatch(/\.composer-blocks__chip:hover\s*\{/);
  });

  it("composer-image-attachments__remove supports transform transition", () => {
    const m = ruleBody(allCss, ".composer-image-attachments__remove");
    expect(m).toBeTruthy();
    expect(m!).toMatch(/transition:[^;]*\btransform\b/);
  });

  it("composer-image-attachments__remove has :active scale feedback", () => {
    const m = ruleBody(allCss, ".composer-image-attachments__remove:active");
    expect(m).toBeTruthy();
    expect(m!).toMatch(/transform:\s*scale\(/);
  });

  it("composer-image-attachments__remove has focus-visible ring", () => {
    const m = ruleBody(allCss, ".composer-image-attachments__remove:focus-visible");
    expect(m).toBeTruthy();
    expect(m!).toMatch(/outline:\s*2px solid/);
  });

  it("composer-attachments__chip-remove has focus-visible ring", () => {
    const m = ruleBody(allCss, ".composer-attachments__chip-remove:focus-visible");
    expect(m).toBeTruthy();
    expect(m!).toMatch(/outline:\s*2px solid/);
  });
});
