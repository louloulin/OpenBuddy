/**
 * md-code-lang-r8.32.test.ts — guard spec for the R8.32 code-block
 * language label pill upgrade.
 *
 * Before R8.32 the language label was a plain 14px text. R8.32
 * converts it into a brand-tinted pill that lets users scan code
 * blocks at a glance and identify the language without reading
 * syntax. The pill uses the same color-mix token pattern as the
 * other brand-tinted chips for consistency.
 *
 * Coverage:
 *   - .md-code-lang is now a 20px pill with brand-tinted bg/border/text
 *   - max-width 220px + ellipsis for long language strings
 *   - font weight 600 + lowercase + letter-spacing for monospace-like
 *     pill feel (without sacrificing scannability)
 *   - dark-theme uses stronger brand tint
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prose = readFileSync(join(__dirname, "..", "prose.css"), "utf8");

function ruleBody(input: string, selector: string): string | null {
  const idx = input.indexOf(selector + " {");
  if (idx < 0) return null;
  let depth = 0;
  let start = -1;
  for (let i = idx; i < input.length; i++) {
    const ch = input[i];
    if (ch === "{") {
      depth++;
      if (start < 0) start = i + 1;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return input.slice(start, i);
    }
  }
  return null;
}

describe("R8.32 .md-code-lang pill", () => {
  it("is a 20px pill (not a text label) with brand-tinted bg", () => {
    const body = ruleBody(prose, ".md-code-lang");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/height:\s*20px/);
    expect(body!).toMatch(/padding:\s*1px 8px/);
    expect(body!).toMatch(/border-radius:\s*999px/);
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+12%/);
  });

  it("carries a 1px brand-tinted border (24% alpha)", () => {
    const body = ruleBody(prose, ".md-code-lang");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border:\s*1px solid color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+24%/);
  });

  it("uses brand-tinted text colour via color-mix (85% brand + 10% strong)", () => {
    const body = ruleBody(prose, ".md-code-lang");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+85%/);
  });

  it("is constrained to max-width 220px with ellipsis for long languages", () => {
    const body = ruleBody(prose, ".md-code-lang");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/max-width:\s*220px/);
    expect(body!).toMatch(/overflow:\s*hidden/);
    expect(body!).toMatch(/text-overflow:\s*ellipsis/);
    expect(body!).toMatch(/white-space:\s*nowrap/);
  });

  it("uses lowercase + letter-spacing for a more monospace-pill feel", () => {
    const body = ruleBody(prose, ".md-code-lang");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/text-transform:\s*lowercase/);
    expect(body!).toMatch(/letter-spacing:\s*0\.02em/);
    expect(body!).toMatch(/font-weight:\s*600/);
  });
});

describe("R8.32 .md-code-lang dark theme override", () => {
  it("uses a stronger brand tint (18% bg, 36% border) for dark surfaces", () => {
    const body = ruleBody(prose, '[data-theme="dark"] .md-code-lang');
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+18%/);
    expect(body!).toMatch(/border-color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+36%/);
  });
});
