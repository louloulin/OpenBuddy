/**
 * chatview-controls-r8.8.test.ts — guard spec for the R8.8 ChatView
 * control polish (FindBar / BranchNavigator / RewindBar). Pins the new
 * selectors so future refactors can't silently drop the focus / active
 * / enter-animation styling that makes keyboard navigation usable.
 *
 * Coverage:
 *   - findbar has enter animation + dual box-shadow + focus-within ring
 *   - findbar__count[data-empty="true"] uses error red + font-weight 500
 *   - findbar__btn has focus-visible + active + disabled states
 *   - branch-navigator__node-button has focus-visible + active + active variant
 *   - rewind-bar__btn has focus-visible + active feedback
 *   - rewind-bar__dropdown has enter animation + transform-origin top right
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const stylesDir = join(__dirname, "..");
const allCss = readdirSync(stylesDir)
  .filter((f) => f.endsWith(".css"))
  .map((f) => readFileSync(join(stylesDir, f), "utf8"))
  .join("\n");

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

describe("R8.8 ChatView control polish CSS", () => {
  it("findbar has enter animation + dual box-shadow + focus-within ring", () => {
    const fb = ruleBody(allCss, ".findbar");
    expect(fb).toBeTruthy();
    expect(fb!).toMatch(/animation:\s*ob-findbar-in\s+var\(--wb-motion-duration-fast,\s*120ms\)/);
    expect(fb!).toMatch(/box-shadow:[^;]*0 2px 12px[^;]*,\s*0 8px 24px/);
    const fw = ruleBody(allCss, ".findbar:focus-within");
    expect(fw).toBeTruthy();
    expect(fw!).toMatch(/border-color:[^;]*wb-brand/);
    expect(fw!).toMatch(/box-shadow:[^;]*0 0 0 3px/);
  });

  it("findbar__count[data-empty=\"true\"] is error red + font-weight 500", () => {
    const c = ruleBody(allCss, '.findbar__count[data-empty="true"]');
    expect(c).toBeTruthy();
    expect(c!).toMatch(/color:\s*color-mix\(in srgb,\s*var\(--wb-status-error/);
    expect(c!).toMatch(/font-weight:\s*500/);
  });

  it("findbar__btn has focus-visible + active + disabled states", () => {
    expect(allCss).toMatch(/\.findbar__btn:focus-visible\s*\{/);
    expect(allCss).toMatch(/\.findbar__btn:active:not\(:disabled\)\s*\{/);
    expect(allCss).toMatch(/\.findbar__btn:disabled\s*\{/);
  });

  it("branch-navigator node-button has focus-visible + active feedback", () => {
    expect(allCss).toMatch(/\.branch-navigator__node-button:focus-visible\s*\{/);
    expect(allCss).toMatch(/\.branch-navigator__node-button:active\s*\{/);
    // active variant rule still preserved.
    expect(allCss).toMatch(/\.branch-navigator__node-button--active\s*\{/);
  });

  it("rewind-bar__btn has focus-visible + active feedback", () => {
    expect(allCss).toMatch(/\.rewind-bar__btn:focus-visible\s*\{/);
    expect(allCss).toMatch(/\.rewind-bar__btn:active\s*\{/);
  });

  it("rewind-bar__dropdown has enter animation + transform-origin top right", () => {
    const dd = ruleBody(allCss, ".rewind-bar__dropdown");
    expect(dd).toBeTruthy();
    expect(dd!).toMatch(/animation:\s*ob-rewind-dropdown-in\s+var\(--wb-motion-duration-fast,\s*140ms\)/);
    expect(dd!).toMatch(/transform-origin:\s*top right/);
    expect(allCss).toMatch(/@keyframes\s+ob-rewind-dropdown-in\b/);
  });

  it("findbar defines the ob-findbar-in keyframe referenced by the rule", () => {
    expect(allCss).toMatch(/@keyframes\s+ob-findbar-in\b/);
  });
});
