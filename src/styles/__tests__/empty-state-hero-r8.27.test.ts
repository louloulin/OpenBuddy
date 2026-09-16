/**
 * empty-state-hero-r8.27.test.ts — guard spec for the R8.27 empty
 * state hero illustration upgrade.
 *
 * Before R8.27 the empty state shipped a `✨` emoji in a flat 64×64
 * circle. The new hero is a 64×64 brand-tinted halo + a 56×56
 * brand-tinted lucide WandSparkles icon stacked on top, with an
 * entrance animation and a subtle 4-second pulse glow.
 *
 * Coverage:
 *   - .chatview__empty-state-hero wraps the halo + icon
 *   - .chatview__empty-state-halo uses radial-gradient brand tint
 *     (24% core, 6% edge, fading to transparent)
 *   - .chatview__empty-state-icon is brand-coloured (var(--wb-brand))
 *     and uses a color-mix border so the chip reads against both
 *     light and dark themes
 *   - .chatview__empty-state-halo pulses on a 4-second ease-in-out
 *     cycle to feel alive without being noisy
 *   - entrance animation chatview__empty-hero-in uses R8.9 motion tokens
 *   - prefers-reduced-motion disables both animations
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

describe("R8.27 .chatview__empty-state-hero wrapper", () => {
  it("renders as a 64×64 inline-flex stack with brand-tinted entrance animation", () => {
    const body = ruleBody(css, ".chatview__empty-state-hero");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/width:\s*64px/);
    expect(body!).toMatch(/height:\s*64px/);
    expect(body!).toMatch(/display:\s*inline-flex/);
    expect(body!).toMatch(/align-items:\s*center/);
    expect(body!).toMatch(/justify-content:\s*center/);
    expect(body!).toMatch(/animation:\s*chatview__empty-hero-in/);
    // R8.9 motion tokens for entrance timing
    expect(body!).toMatch(/var\(--wb-motion-duration-slow,\s*320ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });

  it("uses isolation: isolate so the halo can layer behind the icon cleanly", () => {
    const body = ruleBody(css, ".chatview__empty-state-hero");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/isolation:\s*isolate/);
  });
});

describe("R8.27 .chatview__empty-state-halo glow", () => {
  it("is a 64×64 absolute-positioned circle behind the icon", () => {
    const body = ruleBody(css, ".chatview__empty-state-halo");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/position:\s*absolute/);
    expect(body!).toMatch(/inset:\s*0/);
    expect(body!).toMatch(/border-radius:\s*50%/);
    expect(body!).toMatch(/z-index:\s*-1/);
  });

  it("uses radial-gradient brand tint (24% core, 6% mid, transparent edge)", () => {
    const body = ruleBody(css, ".chatview__empty-state-halo");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/radial-gradient/);
    expect(body!).toMatch(/color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+24%/);
    expect(body!).toMatch(/color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+6%/);
  });

  it("pulses on a 4-second ease-in-out cycle for a subtle 'alive' feel", () => {
    const body = ruleBody(css, ".chatview__empty-state-halo");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/animation:\s*chatview__empty-hero-pulse\s+4s\s+ease-in-out\s+infinite/);
  });
});

describe("R8.27 .chatview__empty-state-icon lucide chip", () => {
  it("is a 56×56 circle with brand-coloured icon", () => {
    const body = ruleBody(css, ".chatview__empty-state-icon");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/width:\s*56px/);
    expect(body!).toMatch(/height:\s*56px/);
    expect(body!).toMatch(/border-radius:\s*50%/);
    expect(body!).toMatch(/color:\s*var\(--wb-brand/);
  });

  it("border uses color-mix to blend brand tint with the default border (theme-safe)", () => {
    const body = ruleBody(css, ".chatview__empty-state-icon");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border:\s*1px solid color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+20%/);
  });

  it("box-shadow carries a brand-tinted glow (14% alpha)", () => {
    const body = ruleBody(css, ".chatview__empty-state-icon");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/box-shadow:\s*0 4px 16px color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+14%/);
  });
});

describe("R8.27 hero keyframes", () => {
  it("entrance keyframes scale + fade from 0.7/transparent to 1/opaque", () => {
    expect(css).toMatch(/@keyframes chatview__empty-hero-in[\s\S]*?opacity:\s*0/);
    expect(css).toMatch(/@keyframes chatview__empty-hero-in[\s\S]*?transform:\s*scale\(0\.7\)/);
    expect(css).toMatch(/@keyframes chatview__empty-hero-in[\s\S]*?opacity:\s*1/);
  });

  it("pulse keyframes oscillate opacity 1↔0.7 and scale 1↔1.06", () => {
    expect(css).toMatch(/@keyframes chatview__empty-hero-pulse[\s\S]*?opacity:\s*0\.7/);
    expect(css).toMatch(/@keyframes chatview__empty-hero-pulse[\s\S]*?scale\(1\.06\)/);
  });
});

describe("R8.27 reduced-motion guard", () => {
  it("disables the entrance + pulse animations when prefers-reduced-motion is set", () => {
    const body = ruleBody(css, "@media (prefers-reduced-motion: reduce)");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/\.chatview__empty-state-hero[\s\S]*?animation:\s*none/);
    expect(body!).toMatch(/\.chatview__empty-state-halo[\s\S]*?animation:\s*none/);
  });
});
