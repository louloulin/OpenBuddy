/**
 * mention-picker-neutral-r8.61.test.ts — guard spec for the R8.61
 * mention-picker neutralisation (matches workbuddy's neutral pill
 * language, brand reserved for streaming/loading dots only).
 *
 * Coverage:
 *   - .mention-picker__icon: neutral grey, no --wb-accent / brand
 *   - .mention-picker__item--active & :hover: neutral pill, no brand tint
 *   - .mention-picker__kind badge: neutral text/bg, no brand colour
 *   - [data-theme="dark"] .mention-picker__item--active: neutral
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "..", "misc.css"), "utf8");

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

describe("R8.61 .mention-picker neutral contract", () => {
  it("icon: neutral text-medium, NO --wb-accent / brand", () => {
    const body = ruleBody(css, ".mention-picker__icon");
    expect(body).toBeTruthy();
    expect(body).toMatch(/var\(--wb-text-medium\)/);
    expect(body).not.toMatch(/var\(--wb-accent/);
    expect(body).not.toMatch(/#00c29a/i);
  });

  it("active & hover: neutral pill-active, NO brand colour-mix", () => {
    const body = ruleBody(css, ".mention-picker__item--active,\n.mention-picker__item:hover");
    expect(body).toBeTruthy();
    expect(body).toMatch(/var\(--wb-bg-pill-active\)/);
    expect(body).not.toMatch(/color-mix\(in srgb,\s*var\(--wb-brand/);
    expect(body).not.toMatch(/#00c29a/i);
  });

  it("kind badge: neutral text + tertiary bg, NO brand colour-mix", () => {
    const body = ruleBody(css, ".mention-picker__kind");
    expect(body).toBeTruthy();
    expect(body).toMatch(/var\(--wb-text-medium\)/);
    expect(body).toMatch(/var\(--wb-bg-tertiary\)/);
    expect(body).not.toMatch(/color-mix\(in srgb,\s*var\(--wb-brand/);
    expect(body).not.toMatch(/#00c29a/i);
  });

  it("[data-theme=\"dark\"] active override uses pill-active (not brand)", () => {
    const darkStart = css.indexOf('[data-theme="dark"] .mention-picker__item--active');
    expect(darkStart).toBeGreaterThan(-1);
    let depth = 0, start = -1;
    for (let i = darkStart; i < css.length; i++) {
      const ch = css[i];
      if (ch === "{") { depth++; if (start < 0) start = i + 1; }
      else if (ch === "}") { depth--; if (depth === 0) {
        const body = css.slice(start, i);
        expect(body).toMatch(/var\(--wb-bg-pill-active\)/);
        expect(body).not.toMatch(/#00c29a/i);
        return;
      }}
    }
  });
});
