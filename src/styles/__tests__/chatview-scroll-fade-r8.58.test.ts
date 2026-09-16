/**
 * chatview-scroll-fade-r8.58.test.ts — guard spec for the R8.58
 * chatview scroll edge fade.
 *
 * Before R8.58 the chatview__scroll viewport had no visual cue
 * for "there's more content above/below". R8.58 overlays two
 * sticky pseudo-elements at the top + bottom edges of the
 * scroll viewport with linear-gradient fades that match the
 * background colour, so the transcript visually dissolves at
 * the edges while scrolling. Mirrors the PI-Desktop scroll
 * affordance. The dark-theme override swaps in the dark bg
 * colour so the fade stays seamless in both themes.
 *
 * Coverage:
 *   - .chatview__scroll::before is sticky + 24px tall + gradient
 *     from bg-primary to transparent
 *   - .chatview__scroll::after mirrors the ::before on the
 *     bottom edge with a reversed gradient
 *   - both pseudo-elements are pointer-events: none so the
 *     fade never blocks text selection or button clicks
 *   - dark-theme overrides swap the bg-primary colour to the
 *     dark theme value
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "..", "messages.css"), "utf8");

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
  // appears multiple times (e.g. once as part of a combined
  // selector, once as a standalone block).
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

describe("R8.58 chatview scroll edge fade", () => {
  it("::before + ::after share the common layout (sticky + 24px tall + pointer-events none)", () => {
    // Combined selector block carries the shared properties
    // (position, height, pointer-events, z-index).
    const combined = findBody(
      css,
      ".chatview__scroll::before,\n.chatview__scroll::after",
    );
    expect(combined).toBeTruthy();
    expect(combined!).toMatch(/position:\s*sticky/);
    expect(combined!).toMatch(/height:\s*24px/);
    expect(combined!).toMatch(/pointer-events:\s*none/);
    expect(combined!).toMatch(/z-index:\s*1/);
    // The ::before block carries top:0 + the to-bottom gradient.
    // Use the SECOND occurrence to skip the combined selector block.
    const before = findNthBody(css, ".chatview__scroll::before", 2);
    expect(before).toBeTruthy();
    expect(before!).toMatch(/top:\s*0/);
    expect(before!).toMatch(
      /background:\s*linear-gradient\(\s*to bottom,\s*var\(--wb-bg-primary[\s\S]*?,\s*transparent/,
    );
    // The ::after block carries bottom:0 + the to-top gradient.
    // Use the SECOND occurrence to skip the combined selector block.
    const after = findNthBody(css, ".chatview__scroll::after", 2);
    expect(after).toBeTruthy();
    expect(after!).toMatch(/bottom:\s*0/);
    expect(after!).toMatch(
      /background:\s*linear-gradient\(\s*to top,\s*var\(--wb-bg-primary[\s\S]*?,\s*transparent/,
    );
  });

  it("dark-theme overrides swap the bg-primary colour to the dark theme value", () => {
    const beforeDark = ruleBody(
      css,
      '[data-theme="dark"] .chatview__scroll::before',
    );
    const afterDark = ruleBody(
      css,
      '[data-theme="dark"] .chatview__scroll::after',
    );
    expect(beforeDark).toBeTruthy();
    expect(beforeDark!).toMatch(
      /background:\s*linear-gradient\(\s*to bottom,\s*var\(--wb-bg-primary[\s\S]*?,\s*transparent/,
    );
    expect(afterDark).toBeTruthy();
    expect(afterDark!).toMatch(
      /background:\s*linear-gradient\(\s*to top,\s*var\(--wb-bg-primary[\s\S]*?,\s*transparent/,
    );
  });

  it("uses z-index: 1 so the overlay sits above scrolling content", () => {
    const combined = findBody(
      css,
      ".chatview__scroll::before,\n.chatview__scroll::after",
    );
    expect(combined).toBeTruthy();
    expect(combined!).toMatch(/z-index:\s*1/);
  });
});
