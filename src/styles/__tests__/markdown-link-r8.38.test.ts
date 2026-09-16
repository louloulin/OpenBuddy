/**
 * markdown-link-r8.38.test.ts — guard spec for the R8.38 markdown
 * link polish.
 *
 * Before R8.38 links had no underline at rest and only got a
 * solid underline on hover. R8.38 adds a subtle dotted underline
 * at rest that becomes solid on hover, plus a focus-visible ring
 * for keyboard accessibility. Transitions route through R8.9
 * motion tokens.
 *
 * Coverage:
 *   - .markdown-body a now has a dotted underline at rest
 *     (1px thick, 3px offset, 60% brand opacity)
 *   - hover state switches the underline to solid + darkens text
 *   - focus-visible carries a brand-tinted 2px outline + 2px offset
 *   - transitions drive decoration-style, decoration-color, color
 *     through R8.9 motion tokens
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

describe("R8.38 .markdown-body a base link style", () => {
  it("carries a dotted underline at rest (1px thick, 3px offset)", () => {
    const body = ruleBody(prose, ".markdown-body a");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/text-decoration:\s*underline/);
    expect(body!).toMatch(/text-decoration-style:\s*dotted/);
    expect(body!).toMatch(/text-decoration-thickness:\s*1px/);
    expect(body!).toMatch(/text-underline-offset:\s*3px/);
  });

  it("underline colour uses color-mix at 60% brand opacity (subtle at rest)", () => {
    const body = ruleBody(prose, ".markdown-body a");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/text-decoration-color:\s*color-mix\(in srgb,\s*var\(--md-link[\s\S]*?\)\s+60%/);
  });

  it("drives decoration + colour transitions through R8.9 motion tokens", () => {
    const body = ruleBody(prose, ".markdown-body a");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transition:[\s\S]*?text-decoration-style/);
    expect(body!).toMatch(/transition:[\s\S]*?text-decoration-color/);
    expect(body!).toMatch(/transition:[\s\S]*?color/);
    expect(body!).toMatch(/var\(--wb-motion-duration-fast,\s*120ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });
});

describe("R8.38 .markdown-body a:hover", () => {
  it("switches underline to solid + brand colour", () => {
    const body = ruleBody(prose, ".markdown-body a:hover");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/text-decoration-style:\s*solid/);
    expect(body!).toMatch(/text-decoration-color:\s*var\(--md-link\)/);
  });

  it("darkens the text colour slightly on hover (85% brand + 10% strong)", () => {
    const body = ruleBody(prose, ".markdown-body a:hover");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*color-mix\(in srgb,\s*var\(--md-link[\s\S]*?\)\s+85%/);
  });
});

describe("R8.38 .markdown-body a:focus-visible keyboard accessibility", () => {
  it("carries a brand-tinted 2px outline with 2px offset + 2px border-radius", () => {
    const body = ruleBody(prose, ".markdown-body a:focus-visible");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/outline:\s*2px solid color-mix\(in srgb,\s*var\(--md-link[\s\S]*?\)\s+65%/);
    expect(body!).toMatch(/outline-offset:\s*2px/);
    expect(body!).toMatch(/border-radius:\s*2px/);
  });
});
