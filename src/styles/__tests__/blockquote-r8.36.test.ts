/**
 * blockquote-r8.36.test.ts — guard spec for the R8.36 markdown
 * blockquote polish.
 *
 * Before R8.36 the blockquote was a neutral grey bar with no
 * background — easy to miss in long transcripts. R8.36 adds a
 * brand-tinted left border + a subtle brand-tinted background so
 * quoted text reads as a distinct surface. The brand tint is at
 * 50% (border) / 4% (bg) so it stays subtle.
 *
 * Coverage:
 *   - .markdown-body blockquote now has a brand-tinted border via
 *     color-mix (50% alpha + fallback to --md-blockquote-border)
 *   - subtle brand-tinted background (4% alpha)
 *   - rounded right corners (0 6px 6px 0)
 *   - first/last child margins are reset so nested content sits
 *     flush against the new padding
 *   - dark theme uses a stronger brand tint (8% bg)
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

describe("R8.36 .markdown-body blockquote base", () => {
  it("uses a brand-tinted left border (50% alpha) with the legacy fallback", () => {
    const body = ruleBody(prose, ".markdown-body blockquote");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border-left:\s*3px solid color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+50%/);
  });

  it("carries a subtle brand-tinted background (4% alpha)", () => {
    const body = ruleBody(prose, ".markdown-body blockquote");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+4%/);
  });

  it("rounds the right corners so the background looks intentional", () => {
    const body = ruleBody(prose, ".markdown-body blockquote");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border-radius:\s*0 6px 6px 0/);
  });
});

describe("R8.36 blockquote nested content spacing", () => {
  it("first child has margin-top reset so the heading sits flush with the padding", () => {
    const body = ruleBody(prose, ".markdown-body blockquote > :first-child");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/margin-top:\s*0/);
  });

  it("last child has margin-bottom reset so the citation doesn't drift past the border", () => {
    const body = ruleBody(prose, ".markdown-body blockquote > :last-child");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/margin-bottom:\s*0/);
  });
});

describe("R8.36 dark theme override", () => {
  it("uses a stronger brand tint (8% bg) so the blockquote stays visible on dark surfaces", () => {
    const body = ruleBody(prose, '[data-theme="dark"] .markdown-body blockquote');
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+8%/);
  });
});
