/**
 * markdown-image-r8.45.test.ts — guard spec for the R8.45 markdown
 * image polish.
 *
 * Before R8.45 images in chat responses had a plain border-radius
 * but no border definition and no interactive feedback. R8.45 adds
 * a 1px brand-tinted border + a hover lift that scales the image
 * up by 2px (1.01x) + brightens the border. The cursor changes
 * to zoom-in to hint at click-to-zoom behaviour.
 *
 * Coverage:
 *   - .markdown-body img has a 1px brand-tinted border (14% alpha)
 *   - border-radius bumped from 8px to 10px for a softer feel
 *   - cursor is zoom-in to hint at click-to-zoom
 *   - hover state scales the image (1.01x) + brightens border
 *   - transitions drive through R8.9 motion tokens
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

describe("R8.45 .markdown-body img base", () => {
  it("carries a 1px brand-tinted border (14% alpha)", () => {
    const body = ruleBody(prose, ".markdown-body img");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border:\s*1px solid color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+14%/);
  });

  it("border-radius bumped from 8px to 10px for softer feel", () => {
    const body = ruleBody(prose, ".markdown-body img");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border-radius:\s*10px/);
  });

  it("uses cursor: zoom-in to hint at click-to-zoom behaviour", () => {
    const body = ruleBody(prose, ".markdown-body img");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/cursor:\s*zoom-in/);
  });

  it("drives transitions through R8.9 motion tokens", () => {
    const body = ruleBody(prose, ".markdown-body img");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transition:[\s\S]*?var\(--wb-motion-duration-fast,\s*120ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });
});

describe("R8.45 .markdown-body img:hover", () => {
  it("brightens border to 32% brand alpha", () => {
    const body = ruleBody(prose, ".markdown-body img:hover");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border-color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+32%/);
  });

  it("adds a brand-tinted box-shadow (12% alpha) for premium feel", () => {
    const body = ruleBody(prose, ".markdown-body img:hover");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/box-shadow:\s*0 4px 12px color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+12%/);
  });

  it("scales the image 1.01x for a subtle lift", () => {
    const body = ruleBody(prose, ".markdown-body img:hover");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transform:\s*scale\(1\.01\)/);
  });
});
