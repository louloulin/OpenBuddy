/**
 * markdown-ol-marker-r8.51.test.ts — guard spec for the R8.51
 * markdown ordered-list marker polish.
 *
 * Before R8.51 the numbered list bullets used the browser default
 * black numerals. R8.51 uses the ::marker pseudo-element to apply
 * a brand-tinted colour + 600 weight + tabular-nums so the
 * numbered list reads as "structured content" (Claude Cowork style).
 *
 * Coverage:
 *   - .markdown-body ol > li::marker uses color-mix on --wb-brand
 *     (75% alpha) for the number colour
 *   - 600 font-weight makes the numbers stand out
 *   - tabular-nums keeps the number column aligned across rows
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

describe("R8.51 .markdown-body ol > li::marker", () => {
  it("uses color-mix on --wb-brand (75% alpha) for the number colour", () => {
    const body = ruleBody(prose, ".markdown-body ol > li::marker");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+75%/);
  });

  it("applies 600 font-weight for emphasis on the numerals", () => {
    const body = ruleBody(prose, ".markdown-body ol > li::marker");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/font-weight:\s*600/);
  });

  it("uses tabular-nums so the number column stays aligned across rows", () => {
    const body = ruleBody(prose, ".markdown-body ol > li::marker");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });
});
