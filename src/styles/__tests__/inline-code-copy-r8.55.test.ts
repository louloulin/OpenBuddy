/**
 * inline-code-copy-r8.55.test.ts — guard spec for the R8.55
 * markdown inline code copy button CSS.
 *
 * R8.55 makes the markdown `<code>` chip a positioned inline-flex
 * container so a hidden copy button can sit beside the text. The
 * button is opacity:0 by default and reveals itself on hover /
 * focus-within / focus-visible, with motion-token transitions and
 * a brand-tinted focus ring. On successful copy the `--ok`
 * modifier turns the button solid green via the canonical
 * `--wb-status-success` token.
 *
 * Coverage:
 *   - .md-inline-code becomes inline-flex + position: relative
 *   - .md-inline-code__text wraps children so the button can sit beside
 *   - .md-inline-code__copy is 16×16, opacity 0 by default
 *   - hover / focus-within / focus-visible bump opacity to 1
 *   - hover state uses brand-tinted bg + brand colour
 *   - focus-visible 2px brand outline + 1px offset
 *   - .md-inline-code__copy--ok uses --wb-status-success
 *   - reduced-motion zeroes the transition
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

function stripComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, "");
}

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

function findNthBody(input: string, selector: string, n: number): string | null {
  // Find the n-th (1-based) occurrence of the selector and return
  // the body of the matching block. Used when the same selector
  // appears multiple times (e.g. once as part of a comma-separated
  // group with opacity:1, and once as a standalone outline rule).
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

describe("R8.55 inline-code copy button CSS", () => {
  it(".md-inline-code is now an inline-flex container with position: relative", () => {
    // Comma-separated selector — use findBody to handle the
    // ".markdown-body code.md-inline-code,\n.markdown-body .md-inline-code" pair.
    const body = findBody(
      prose,
      ".markdown-body code.md-inline-code,\n.markdown-body .md-inline-code",
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/display:\s*inline-flex/);
    expect(body!).toMatch(/position:\s*relative/);
  });

  it(".md-inline-code__text wraps children without breaking inline flow", () => {
    const body = ruleBody(prose, ".markdown-body .md-inline-code__text");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/display:\s*inline-block/);
    expect(body!).toMatch(/vertical-align:\s*baseline/);
  });

  it(".md-inline-code__copy is 16x16, hidden by default (opacity 0)", () => {
    const body = ruleBody(prose, ".markdown-body .md-inline-code__copy");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/width:\s*16px/);
    expect(body!).toMatch(/height:\s*16px/);
    expect(body!).toMatch(/opacity:\s*0/);
  });

  it("hover / focus-within / focus-visible bump opacity to 1", () => {
    // Combined comma-separated selector block — use findBody with
    // the first selector + the trailing comma.
    const body = findBody(
      prose,
      ".markdown-body code.md-inline-code:hover .md-inline-code__copy,",
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/opacity:\s*1/);
  });

  it("hover state uses brand-tinted bg + brand colour for the icon", () => {
    const body = ruleBody(prose, ".markdown-body .md-inline-code__copy:hover");
    expect(body).toBeTruthy();
    expect(body!).toMatch(
      /background:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+12%/,
    );
    expect(body!).toMatch(/color:\s*var\(--wb-brand/);
  });

  it("focus-visible outline is 2px brand-tinted + 1px offset", () => {
    // The same selector appears twice: once as part of the combined
    // hover/focus-within/focus-visible opacity:1 block, and once as
    // the standalone outline rule. We want the SECOND occurrence.
    const body = findNthBody(
      prose,
      ".markdown-body .md-inline-code__copy:focus-visible",
      2,
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(
      /outline:\s*2px solid color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+60%/,
    );
    expect(body!).toMatch(/outline-offset:\s*1px/);
  });

  it("--ok modifier uses --wb-status-success for icon colour + bg", () => {
    const body = ruleBody(
      prose,
      ".markdown-body .md-inline-code__copy--ok",
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/opacity:\s*1/);
    expect(body!).toMatch(/var\(--wb-status-success/);
  });

  it("reduced-motion zeroes the transition", () => {
    const cleaned = stripComments(prose);
    expect(cleaned).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.markdown-body\s+\.md-inline-code__copy\s*\{[\s\S]*?transition:\s*none/,
    );
  });
});
