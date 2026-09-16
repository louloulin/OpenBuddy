/**
 * md-inline-code-r8.39.test.ts — guard spec for the R8.39 markdown
 * inline code polish.
 *
 * Before R8.39 the inline code chip was a neutral grey bg with no
 * border. R8.39 adds a brand-tinted subtle background (5% alpha)
 * + a 1px brand-tinted border (14% alpha) so the chip has
 * definition against the surrounding text. Dark theme uses a
 * stronger brand tint for visibility.
 *
 * Coverage:
 *   - .markdown-body .md-inline-code background is brand-tinted
 *     (5% alpha light, 10% alpha dark)
 *   - 1px border uses color-mix at 14% alpha light / 24% alpha dark
 *   - typography settings (font-family, font-size, padding,
 *     border-radius) are preserved
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prose = readFileSync(join(__dirname, "..", "prose.css"), "utf8");

function findBody(input: string, selector: string): string | null {
  // Comma-separated selectors (e.g. ".a,\n.b {") — find the
  // first occurrence of the selector, then brace-balance from the
  // next `\n` to find the opening `{`.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped + "[\\s\\S]*?\\{");
  const idx = input.search(re);
  if (idx < 0) return null;
  const openBrace = input.indexOf("{", idx);
  if (openBrace < 0) return null;
  let depth = 0;
  let start = openBrace + 1;
  for (let i = openBrace; i < input.length; i++) {
    const ch = input[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return input.slice(start, i);
    }
  }
  return null;
}

// (legacy single-selector ruleBody kept for compatibility with other tests in this file)
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

describe("R8.39 .markdown-body .md-inline-code (light)", () => {
  it("uses a brand-tinted background (5% alpha) via color-mix", () => {
    const body = findBody(
      prose,
      ".markdown-body code.md-inline-code,\n.markdown-body .md-inline-code"
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+5%/);
  });

  it("carries a 1px brand-tinted border (14% alpha)", () => {
    const body = findBody(
      prose,
      ".markdown-body code.md-inline-code,\n.markdown-body .md-inline-code"
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border:\s*1px solid color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+14%/);
  });

  it("preserves the previous typography (font-family, font-size, padding, radius)", () => {
    const body = findBody(
      prose,
      ".markdown-body code.md-inline-code,\n.markdown-body .md-inline-code"
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/font-family:\s*var\(--wb-font-code-family\)/);
    expect(body!).toMatch(/font-size:\s*0\.92em/);
    expect(body!).toMatch(/padding:\s*1px 6px/);
    expect(body!).toMatch(/border-radius:\s*4px/);
  });
});

describe("R8.39 .markdown-body .md-inline-code (dark)", () => {
  it("uses a stronger brand tint (10% bg, 24% border) on dark surfaces", () => {
    const body = findBody(
      prose,
      '[data-theme="dark"] .markdown-body code.md-inline-code,\n[data-theme="dark"] .markdown-body .md-inline-code'
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+10%/);
    expect(body!).toMatch(/border-color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+24%/);
  });
});
