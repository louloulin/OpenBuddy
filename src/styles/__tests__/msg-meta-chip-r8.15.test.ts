/**
 * msg-meta-chip-r8.15.test.ts — guard spec for the R8.15 model id +
 * token throughput chips rendered inside the per-message meta row.
 *
 * Coverage:
 *   - .msg__meta-chip is an inline-flex rounded pill
 *   - --model variant uses brand-tinted bg + text
 *   - --throughput variant uses a neutral surface (no brand tint)
 *   - chip text gets ellipsis-truncated above 180px
 *   - lucide icon shrinks correctly inside the pill
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prose = readFileSync(join(__dirname, "..", "prose.css"), "utf8");

function ruleBody(css: string, selector: string): string | null {
  const idx = css.indexOf(selector + " {");
  if (idx < 0) return null;
  let depth = 0;
  let start = -1;
  for (let i = idx; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      depth++;
      if (start < 0) start = i + 1;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return css.slice(start, i);
    }
  }
  return null;
}

describe("R8.15 .msg__meta-chip base", () => {
  it("renders as an inline-flex rounded pill", () => {
    const body = ruleBody(prose, ".msg__meta-chip");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/display:\s*inline-flex/);
    expect(body!).toMatch(/align-items:\s*center/);
    expect(body!).toMatch(/gap:\s*3px/);
    expect(body!).toMatch(/padding:\s*1px 6px/);
    expect(body!).toMatch(/border-radius:\s*8px/);
    expect(body!).toMatch(/font-size:\s*10px/);
  });

  it("clamps width with ellipsis for long model ids", () => {
    const body = ruleBody(prose, ".msg__meta-chip");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/max-width:\s*180px/);
  });

  it("uses tabular-nums for the numeric throughput text", () => {
    const body = ruleBody(prose, ".msg__meta-chip");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(body!).toMatch(/white-space:\s*nowrap/);
  });
});

describe("R8.15 .msg__meta-chip--model variant", () => {
  it("stays on the neutral surface — brand tinting was removed (R8.41 → R8.60)", () => {
    const body = ruleBody(prose, ".msg__meta-chip--model");
    expect(body).toBeTruthy();
    // The model chip used to be brand-tinted at ~10% so it read as a tag.
    // It is now a neutral `--wb-text-strong` wash like its throughput
    // sibling: brand is reserved for primary CTAs, and tinting every
    // transcript chip drained the accent. Guard the removal so it does
    // not creep back one declaration at a time.
    expect(body!).not.toMatch(/var\(--wb-brand/);
    expect(body!).toMatch(/color-mix\(in srgb,\s*var\(--wb-text-strong[^)]*\)\s+6%/);
  });
});

describe("R8.15 .msg__meta-chip--throughput variant", () => {
  it("uses a neutral surface so the numeric chip doesn't fight the model pill", () => {
    const body = ruleBody(prose, ".msg__meta-chip--throughput");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/var\(--wb-text-strong[\s\S]*?\)\s+7%/);
    // Throughput chip should NOT use brand tint — neutralised so the
    // model chip remains the only brand-coloured element on the row.
    expect(body!).not.toMatch(/var\(--wb-brand/);
  });
});

describe("R8.15 .msg__meta-chip svg (lucide icon inside the pill)", () => {
  it("shrinks the icon and dims it slightly", () => {
    const body = ruleBody(prose, ".msg__meta-chip svg");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/flex-shrink:\s*0/);
    expect(body!).toMatch(/opacity:\s*0\.85/);
  });
});
