/**
 * markdown-table-r8.37.test.ts — guard spec for the R8.37 markdown
 * table polish.
 *
 * Before R8.37 the table header was a neutral grey bg with a
 * neutral border. R8.37 swaps both for brand-tinted variants so
 * the header row reads as the "title" of the table.
 *
 * Coverage:
 *   - .markdown-body th background uses brand-tinted color-mix
 *     (6% alpha light, 10% alpha dark)
 *   - .markdown-body th border uses brand-tinted color-mix
 *     (18% alpha light, 28% alpha dark)
 *   - .markdown-body td border picks up a faint brand tint (8%)
 *     so cells feel cohesive with the header
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

describe("R8.37 .markdown-body th header polish (light)", () => {
  it("uses a brand-tinted background (6% alpha)", () => {
    const body = ruleBody(prose, ".markdown-body th");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+6%/);
  });

  it("uses a brand-tinted border (18% alpha)", () => {
    const body = ruleBody(prose, ".markdown-body th");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border-color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+18%/);
  });
});

describe("R8.37 .markdown-body th header polish (dark)", () => {
  it("uses a stronger brand tint (10% bg + 28% border) on dark surfaces", () => {
    const body = ruleBody(prose, '[data-theme="dark"] .markdown-body th');
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+10%/);
    expect(body!).toMatch(/border-color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+28%/);
  });
});

describe("R8.37 .markdown-body td cell border tint", () => {
  it("cells pick up a faint brand tint (8% alpha) so the table feels cohesive", () => {
    // The .markdown-body td rule appears twice: once combined with th,
    // and once standalone (R8.37). Use a regex that requires the
    // selector to be the entire line content (no preceding
    // `.markdown-body th,` on the previous line).
    const re = /\n\.markdown-body td \{\n/g;
    const matches = [];
    let m;
    while ((m = re.exec(prose)) !== null) {
      matches.push(m.index);
    }
    expect(matches.length).toBeGreaterThanOrEqual(2);
    // Use the second match (the standalone R8.37 rule).
    const idx = matches[1];
    let depth = 0;
    let start = -1;
    for (let i = idx; i < prose.length; i++) {
      const ch = prose[i];
      if (ch === "{") {
        depth++;
        if (start < 0) start = i + 1;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          expect(prose.slice(start, i)).toMatch(/border-color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+8%/);
          break;
        }
      }
    }
  });
});
