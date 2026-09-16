/**
 * quick-prompts-r8.10.test.ts — guard spec for the R8.10 quick-prompt
 * cards on the welcome empty state. Pins the new selectors so future
 * refactors can't silently drop the hover / focus / active styling that
 * makes the cards feel polished.
 *
 * Coverage:
 *   - .chatview__quick-prompts is a CSS grid (auto-fit, min 220px)
 *   - .chatview__quick-prompt renders as a flex row with icon left, body right
 *   - .chatview__quick-prompt:hover lifts 1px + brand-tinted bg + shadow
 *   - .chatview__quick-prompt:focus-visible paints a brand ring (no default outline)
 *   - .chatview__quick-prompt:active returns to baseline translate
 *   - .chatview__quick-prompt-icon is a 32px brand-tinted square
 *   - .chatview__quick-prompt-title/desc use correct font sizes
 *   - dark theme overrides give cards a translucent dark surface + brand border
 *   - transitions use motion tokens (--wb-duration-fast / --wb-ease-out-expo)
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const stylesDir = join(__dirname, "..");
const allCss = readdirSync(stylesDir)
  .filter((f) => f.endsWith(".css"))
  .map((f) => readFileSync(join(stylesDir, f), "utf8"))
  .join("\n");

const chatShell = readFileSync(join(stylesDir, "chat-shell.css"), "utf8");

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

describe("R8.10 quick-prompt grid container", () => {
  it("uses CSS grid auto-fit with a 220px minimum column width", () => {
    const m = ruleBody(chatShell, ".chatview__quick-prompts");
    expect(m).toBeTruthy();
    expect(m!).toMatch(/display:\s*grid/);
    expect(m!).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(220px,\s*1fr\)\)/);
    expect(m!).toMatch(/gap:\s*10px/);
    expect(m!).toMatch(/max-width:\s*560px/);
  });
});

describe("R8.10 quick-prompt card base", () => {
  it("is a flex row, primary bg, 10px radius, transition driven by motion tokens", () => {
    const b = ruleBody(chatShell, ".chatview__quick-prompt");
    expect(b).toBeTruthy();
    expect(b!).toMatch(/display:\s*flex/);
    expect(b!).toMatch(/border-radius:\s*10px/);
    expect(b!).toMatch(/padding:\s*12px 14px/);
    // Transitions should reference motion tokens (with fallbacks)
    expect(b!).toMatch(/transition:[^;]*var\(--wb-duration-fast/);
    expect(b!).toMatch(/transition:[^;]*var\(--wb-ease-out-expo/);
  });

  it("hover state lifts 1px, brand-tints bg, paints subtle shadow", () => {
    const h = ruleBody(chatShell, ".chatview__quick-prompt:hover");
    expect(h).toBeTruthy();
    expect(h!).toMatch(/transform:\s*translateY\(-1px\)/);
    expect(h!).toMatch(/border-color:[^;]*wb-brand/);
    expect(h!).toMatch(/box-shadow:[^;]*0 4px 12px/);
  });

  it("focus-visible paints a brand ring (no default outline)", () => {
    const f = ruleBody(chatShell, ".chatview__quick-prompt:focus-visible");
    expect(f).toBeTruthy();
    expect(f!).toMatch(/outline:\s*none/);
    expect(f!).toMatch(/box-shadow:[^;]*0 0 0 3px/);
  });

  it("active state resets translate + darkens bg", () => {
    const a = ruleBody(chatShell, ".chatview__quick-prompt:active");
    expect(a).toBeTruthy();
    expect(a!).toMatch(/transform:\s*translateY\(0\)/);
    expect(a!).toMatch(/background:[^;]*wb-brand/);
  });
});

describe("R8.10 quick-prompt icon + body", () => {
  it("icon is a 32px brand-tinted square that intensifies on hover", () => {
    const i = ruleBody(chatShell, ".chatview__quick-prompt-icon");
    expect(i).toBeTruthy();
    expect(i!).toMatch(/width:\s*32px/);
    expect(i!).toMatch(/height:\s*32px/);
    expect(i!).toMatch(/border-radius:\s*8px/);
    expect(i!).toMatch(/background:[^;]*wb-brand/);

    const hover = ruleBody(chatShell, ".chatview__quick-prompt:hover .chatview__quick-prompt-icon");
    expect(hover).toBeTruthy();
    expect(hover!).toMatch(/background:[^;]*wb-brand/);
  });

  it("title is 13px semibold, desc is 11px muted with ellipsis", () => {
    const t = ruleBody(chatShell, ".chatview__quick-prompt-title");
    expect(t).toBeTruthy();
    expect(t!).toMatch(/font-size:\s*13px/);
    expect(t!).toMatch(/font-weight:\s*600/);

    const d = ruleBody(chatShell, ".chatview__quick-prompt-desc");
    expect(d).toBeTruthy();
    expect(d!).toMatch(/font-size:\s*11px/);
    expect(d!).toMatch(/text-overflow:\s*ellipsis/);
    expect(d!).toMatch(/white-space:\s*nowrap/);
  });
});

describe("R8.10 quick-prompt dark theme overrides", () => {
  it("cards get a translucent dark surface + brand-tinted border on hover", () => {
    const dark = ruleBody(chatShell, '[data-theme="dark"] .chatview__quick-prompt');
    expect(dark).toBeTruthy();
    expect(dark!).toMatch(/background:[^;]*rgba\(255, 255, 255/);
    expect(dark!).toMatch(/border-color:[^;]*rgba\(255, 255, 255/);

    const darkHover = ruleBody(
      chatShell,
      '[data-theme="dark"] .chatview__quick-prompt:hover',
    );
    expect(darkHover).toBeTruthy();
    expect(darkHover!).toMatch(/background:[^;]*wb-brand/);
    expect(darkHover!).toMatch(/box-shadow:[^;]*rgba\(0, 0, 0/);
  });
});
