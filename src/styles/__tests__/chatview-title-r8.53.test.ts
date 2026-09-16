/**
 * chatview-title-r8.53.test.ts — guard spec for the R8.53
 * chatview header title polish.
 *
 * Before R8.53 the .chatview__title was a plain h1 (18px / 1.4 line)
 * with no accent below it, no hover state, and no focus-visible
 * outline. R8.53 adds:
 *   - tight letter-spacing (-0.01em) for refined display type
 *   - 1px brand-tinted hairline border-bottom (18% brand alpha)
 *   - hover state that lifts the border to 36% brand alpha
 *   - focus-visible 2px brand outline + 4px radius + 3px offset
 *   - motion-token colour/border transition + reduced-motion override
 *
 * Coverage:
 *   - letter-spacing: -0.01em lands
 *   - border-bottom 1px + color-mix on --wb-brand at 18%
 *   - hover bumps to 36% brand alpha
 *   - focus-visible 2px outline + offset 3px + radius 4px
 *   - transition references motion tokens
 *   - prefers-reduced-motion zeroes the transition
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

function stripComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("R8.53 .chatview__title polish", () => {
  it("tightens letter-spacing to -0.01em for refined display type", () => {
    const body = ruleBody(css, ".chatview__title");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/letter-spacing:\s*-0\.01em/);
  });

  it("keeps the 18px / 600 weight / 1.4 line-height baseline", () => {
    const body = ruleBody(css, ".chatview__title");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/font-size:\s*18px/);
    expect(body!).toMatch(/font-weight:\s*600/);
    expect(body!).toMatch(/line-height:\s*1\.4/);
  });

  it("adds an 8px bottom padding so the hairline has breathing room", () => {
    const body = ruleBody(css, ".chatview__title");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/padding-bottom:\s*8px/);
  });

  it("uses color-mix on --wb-brand (18% alpha) for the hairline border", () => {
    const body = ruleBody(css, ".chatview__title");
    expect(body).toBeTruthy();
    expect(body!).toMatch(
      /border-bottom:\s*1px solid color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+18%/,
    );
  });

  it("hover state lifts the hairline to 36% brand alpha", () => {
    const body = ruleBody(css, ".chatview__title:hover");
    expect(body).toBeTruthy();
    expect(body!).toMatch(
      /border-bottom-color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+36%/,
    );
  });

  it("focus-visible outline is 2px brand-tinted + offset 3px + radius 4px", () => {
    const body = ruleBody(css, ".chatview__title:focus-visible");
    expect(body).toBeTruthy();
    expect(body!).toMatch(
      /outline:\s*2px solid color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+60%/,
    );
    expect(body!).toMatch(/outline-offset:\s*3px/);
    expect(body!).toMatch(/border-radius:\s*4px/);
  });

  it("transition uses motion tokens (duration-fast + ease-out-expo)", () => {
    const body = ruleBody(css, ".chatview__title");
    expect(body).toBeTruthy();
    expect(body!).toMatch(
      /transition:[\s\S]*?var\(--wb-motion-duration-fast/,
    );
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });

  it("prefers-reduced-motion zeroes the transition", () => {
    const cleaned = stripComments(css);
    // The reduced-motion override should set transition: none
    expect(cleaned).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.chatview__title\s*\{[\s\S]*?transition:\s*none/,
    );
  });
});
