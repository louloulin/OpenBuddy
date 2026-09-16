/**
 * markdown-heading-r8.57.test.ts — guard spec for the R8.57
 * markdown heading polish.
 *
 * Before R8.57 markdown h1-h4 shared the same `color: inherit`
 * as body text, so section breaks read like "slightly larger
 * paragraphs". R8.57:
 *   - tightens letter-spacing to -0.01em for refined display type
 *   - h1 picks up a brand-tinted colour (10% brand mix) +
 *     1px brand-tinted hairline (18% brand mix) for visual anchor
 *   - h2 picks up a subtler brand-tinted colour (8% brand mix)
 *     without a divider
 *   - h3 + h4 stay at the default text colour to preserve
 *     content hierarchy
 *
 * Coverage:
 *   - h1-h4 share letter-spacing: -0.01em
 *   - h1 colour uses color-mix on --wb-brand (10% alpha)
 *   - h1 padding-bottom + border-bottom (18% brand alpha)
 *   - h2 colour uses color-mix on --wb-brand (8% alpha)
 *   - h3 + h4 don't pick up a brand-tinted colour
 *   - font-size scale preserved (1.35 / 1.2 / 1.08 / 1em)
 *   - margin + font-weight + line-height preserved
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

function findBody(input: string, selector: string): string | null {
  // Comma-separated selectors (e.g. ".a,\n.b {").
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

function findNthBody(input: string, selector: string, n: number): string | null {
  // Find the n-th (1-based) occurrence of the selector and return
  // the body of the matching block. Used when the same selector
  // appears multiple times (e.g. once as a legacy single-line
  // font-size shorthand, and once as the new multi-line block).
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "g");
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(input)) !== null) {
    count++;
    if (count === n) {
      const idx = m.index;
      const openBrace = input.indexOf("{", idx);
      if (openBrace < 0) return null;
      let depth = 0;
      const start = openBrace + 1;
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
  }
  return null;
}

function stripComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("R8.57 markdown heading polish", () => {
  it("h1-h4 share letter-spacing: -0.01em for refined display type", () => {
    const body = findBody(
      prose,
      ".markdown-body h1,\n.markdown-body h2,\n.markdown-body h3,\n.markdown-body h4",
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/letter-spacing:\s*-0\.01em/);
  });

  it("preserves the font-size scale (1.35 / 1.2 / 1.08 / 1em)", () => {
    // Each heading selector appears TWICE: once as part of the
    // combined h1-h4 rule (margin/weight/line-height), and once as
    // the legacy font-size single-liner. Use the second occurrence
    // to grab the font-size.
    expect(findNthBody(prose, ".markdown-body h1", 2)).toMatch(/font-size:\s*1\.35em/);
    expect(findNthBody(prose, ".markdown-body h2", 2)).toMatch(/font-size:\s*1\.2em/);
    expect(findNthBody(prose, ".markdown-body h3", 2)).toMatch(/font-size:\s*1\.08em/);
    expect(findNthBody(prose, ".markdown-body h4", 2)).toMatch(/font-size:\s*1em/);
  });

  it("preserves margin + font-weight + line-height baseline", () => {
    const body = findBody(
      prose,
      ".markdown-body h1,\n.markdown-body h2,\n.markdown-body h3,\n.markdown-body h4",
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/margin:\s*16px\s+0\s+8px/);
    expect(body!).toMatch(/font-weight:\s*600/);
    expect(body!).toMatch(/line-height:\s*1\.35/);
  });

  it("h1 colour uses color-mix on --wb-brand (10% alpha)", () => {
    // .markdown-body h1 appears 3 times: once as part of the
    // combined h1-h4 selector block, once as the legacy font-size
    // single-liner, and once as the new R8.57 multi-line colour
    // block. Use the third occurrence.
    const body = findNthBody(prose, ".markdown-body h1", 3);
    expect(body).toBeTruthy();
    expect(body!).toMatch(
      /color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+10%/,
    );
  });

  it("h1 has padding-bottom + brand-tinted border-bottom (18% alpha)", () => {
    // Same as the colour test — h1 has THREE blocks (combined
    // selector, legacy font-size, R8.57 multi-line), use the third.
    const body = findNthBody(prose, ".markdown-body h1", 3);
    expect(body).toBeTruthy();
    expect(body!).toMatch(/padding-bottom:\s*6px/);
    expect(body!).toMatch(
      /border-bottom:\s*1px solid color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+18%/,
    );
  });

  it("h2 colour uses color-mix on --wb-brand (8% alpha) but no divider", () => {
    // .markdown-body h2 appears 3 times (combined selector,
    // legacy font-size, R8.57 multi-line). Use the third.
    const body = findNthBody(prose, ".markdown-body h2", 3);
    expect(body).toBeTruthy();
    expect(body!).toMatch(
      /color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+8%/,
    );
    expect(body!).not.toMatch(/border-bottom/);
  });

  it("h3 + h4 don't pick up a brand-tinted colour", () => {
    const h3Body = ruleBody(prose, ".markdown-body h3");
    const h4Body = ruleBody(prose, ".markdown-body h4");
    expect(h3Body).toBeTruthy();
    expect(h3Body!).not.toMatch(/color:\s*color-mix/);
    expect(h4Body).toBeTruthy();
    expect(h4Body!).not.toMatch(/color:\s*color-mix/);
  });
});
