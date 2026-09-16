/**
 * slash-commands-active-r8.61.test.ts — guard spec for the R8.61
 * slash-command menu active-state neutralisation.
 *
 * Before R8.61 the keyboard-selected row used a brand-tinted background
 * + 3px brand left bar (R8.26). After the user feedback "颜色不要改成
 * 绿色,还是参考这个正常的黑色", the chat input popover is brought in
 * line with WorkBuddy's neutral pill language:
 *
 *   - hover        → neutral surface lift (var(--wb-bg-hover))
 *   - active       → neutral pill (var(--wb-bg-pill-active))
 *   - active:hover → neutral hover
 *   - 3px left bar → neutral pill-active token (same as sidebar pills)
 *
 * Brand colour is now reserved for streaming/loading dots and progress
 * indicators only — never for "selected row" affordances inside a chat
 * input popover.
 *
 * Coverage:
 *   - active and hover now have distinct backgrounds (still)
 *   - active uses var(--wb-bg-pill-active) — NOT brand/colour-mix brand
 *   - active carries a 3px inset pill-active shadow (sidebar parity)
 *   - adapter-badge is also neutral (border / bg / fg)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "..", "composer.css"), "utf8");

function ruleBody(input: string, selector: string): string | null {
  const idx = input.indexOf(selector + " {");
  if (idx < 0) return null;
  let depth = 0;
  let start = -1;
  for (let i = idx; i < input.length; i++) {
    const ch = input[i];
    if (ch === "{") { depth++; if (start < 0) start = i + 1; }
    else if (ch === "}") { depth--; if (depth === 0) return input.slice(start, i); }
  }
  return null;
}

describe("R8.61 .slash-commands__item neutral active/hover", () => {
  it("hover uses neutral --wb-bg-hover (no brand)", () => {
    const body = ruleBody(css, ".slash-commands__item:hover");
    expect(body).toBeTruthy();
    expect(body).toMatch(/var\(--wb-bg-hover\)/);
    expect(body).not.toMatch(/var\(--wb-brand/);
    expect(body).not.toMatch(/#00c29a/i);
  });

  it("active uses neutral pill --wb-bg-pill-active (NO brand tint, NO #00c29a)", () => {
    const body = ruleBody(css, ".slash-commands__item--active");
    expect(body).toBeTruthy();
    expect(body).toMatch(/var\(--wb-bg-pill-active\)/);
    expect(body).not.toMatch(/color-mix\(in srgb,\s*var\(--wb-brand/);
    expect(body).not.toMatch(/#00c29a/i);
  });

  it("active 3px left bar uses --wb-bg-pill-active, NOT brand", () => {
    const body = ruleBody(css, ".slash-commands__item--active");
    expect(body).toBeTruthy();
    expect(body).toMatch(/inset 3px 0 0 0 var\(--wb-bg-pill-active\)/);
    expect(body).not.toMatch(/inset 3px 0 0 0 var\(--wb-brand/);
    expect(body).not.toMatch(/inset 3px 0 0 0 #00c29a/i);
  });

  it("active:hover keeps neutral hover (not stronger brand tint)", () => {
    const body = ruleBody(css, ".slash-commands__item--active:hover");
    expect(body).toBeTruthy();
    expect(body).toMatch(/var\(--wb-bg-hover\)/);
    expect(body).not.toMatch(/color-mix\(in srgb,\s*var\(--wb-brand/);
    expect(body).not.toMatch(/#00c29a/i);
  });

  it("adapter-badge is fully neutral (no brand border / bg / text)", () => {
    const body = ruleBody(css, ".slash-commands__adapter-badge");
    expect(body).toBeTruthy();
    expect(body).toMatch(/var\(--wb-border-default\)/);
    expect(body).toMatch(/var\(--wb-bg-tertiary\)/);
    expect(body).toMatch(/var\(--wb-text-medium\)/);
    expect(body).not.toMatch(/color-mix\(in srgb,\s*var\(--wb-brand/);
    expect(body).not.toMatch(/#00c29a/i);
  });
});
