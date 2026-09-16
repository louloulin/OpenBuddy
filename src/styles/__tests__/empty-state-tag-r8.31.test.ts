/**
 * empty-state-tag-r8.31.test.ts — guard spec for the R8.31 empty
 * state capability tag chip polish.
 *
 * Before R8.31 the tags were neutral grey pills. The new design
 * adds a brand-tinted dot, a 1px brand-tinted border, and a
 * brand-tinted background — so the chips read as "available
 * capabilities" rather than generic labels. Hover state lifts the
 * tint and shifts the dot to solid brand colour.
 *
 * Coverage:
 *   - .chatview__empty-state-tag now uses brand-tinted background +
 *     1px border (was neutral grey)
 *   - ::before renders a 5×5 brand-tinted dot
 *   - hover state deepens all three (bg, border, text) and bumps
 *     the dot to solid brand
 *   - all transitions use R8.9 motion tokens
 *   - reduced-motion guard pins the hover lift to none
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "..", "chat-shell.css"), "utf8");

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

describe("R8.31 .chatview__empty-state-tag base chip", () => {
  it("uses a brand-tinted background (4% alpha) via color-mix", () => {
    const body = ruleBody(css, ".chatview__empty-state-tag");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+4%/);
  });

  it("carries a 1px brand-tinted border (14% alpha)", () => {
    const body = ruleBody(css, ".chatview__empty-state-tag");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border:\s*1px solid color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+14%/);
  });

  it("drives background, border, color, and transform through R8.9 motion tokens", () => {
    const body = ruleBody(css, ".chatview__empty-state-tag");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transition:[\s\S]*?background-color/);
    expect(body!).toMatch(/transition:[\s\S]*?border-color/);
    expect(body!).toMatch(/transition:[\s\S]*?transform/);
    expect(body!).toMatch(/var\(--wb-motion-duration-fast,\s*120ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });
});

describe("R8.31 .chatview__empty-state-tag::before dot", () => {
  it("renders a 5×5 brand-tinted circle (70% alpha for the resting state)", () => {
    const body = ruleBody(css, ".chatview__empty-state-tag::before");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/content:\s*""/);
    expect(body!).toMatch(/width:\s*5px/);
    expect(body!).toMatch(/height:\s*5px/);
    expect(body!).toMatch(/border-radius:\s*50%/);
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+70%/);
  });

  it("hover state bumps the dot to solid brand colour", () => {
    const body = ruleBody(css, ".chatview__empty-state-tag:hover::before");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*var\(--wb-brand/);
  });
});

describe("R8.31 .chatview__empty-state-tag:hover", () => {
  it("deepens background (4% → 10%) and border (14% → 28%)", () => {
    const body = ruleBody(css, ".chatview__empty-state-tag:hover");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+10%/);
    expect(body!).toMatch(/border-color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+28%/);
  });

  it("lifts the chip 1px on hover for affordance", () => {
    const body = ruleBody(css, ".chatview__empty-state-tag:hover");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transform:\s*translateY\(-1px\)/);
  });
});

describe("R8.31 reduced-motion guard", () => {
  it("disables the hover lift when prefers-reduced-motion is set", () => {
    // Match the second reduced-motion block (the one after the tag chip).
    // The file has multiple @media blocks.
    const m = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.chatview__empty-state-tag[\s\S]*?transform:\s*none[\s\S]*?\}/
    );
    expect(m).toBeTruthy();
  });
});
