/**
 * composer-focus-r8.29.test.ts — guard spec for the R8.29 composer
 * focus-state polish.
 *
 * Before R8.29 the composer's focus-within halo was a neutral grey
 * (text-strong mix). R8.29 swaps that for a soft brand-tinted glow
 * so the input area feels "alive" when focused — parity with
 * ChatGPT / Claude Cowork. The brand tint stays low (10% alpha) so
 * it still reads as a halo, not as a validation error.
 *
 * Coverage:
 *   - .wb-composer:focus-within border uses brand-tinted color-mix
 *     (was previously var(--wb-border-default))
 *   - box-shadow now includes a brand-tinted 4px halo (10% alpha)
 *     + a brand-tinted soft glow (6% alpha)
 *   - border + box-shadow transitions through R8.9 motion tokens
 *   - dark theme uses stronger brand tint (18% halo, 10% glow)
 *     to compensate for the darker surface
 *   - reduced-motion guard pins the transition to none
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "..", "workbuddy-parity.css"), "utf8");

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

describe("R8.29 .wb-composer:focus-within brand halo (light theme)", () => {
  it("border uses brand-tinted color-mix (30% brand + default fallback)", () => {
    const body = ruleBody(css, ".wb-composer:focus-within");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border-color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+30%/);
  });

  it("box-shadow stacks a 4px brand halo (10%) + soft 8px brand glow (6%)", () => {
    const body = ruleBody(css, ".wb-composer:focus-within");
    expect(body).toBeTruthy();
    // 4px primary halo
    expect(body!).toMatch(/0 0 0 4px color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+10%/);
    // Soft 8px secondary glow
    expect(body!).toMatch(/0 2px 8px color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+6%/);
  });

  it("transitions both border-color and box-shadow through R8.9 motion tokens", () => {
    const body = ruleBody(css, ".wb-composer:focus-within");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transition:[\s\S]*?box-shadow/);
    expect(body!).toMatch(/transition:[\s\S]*?border-color/);
    expect(body!).toMatch(/var\(--wb-motion-duration-fast,\s*120ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });
});

describe("R8.29 .wb-composer:focus-within brand halo (dark theme)", () => {
  it("uses a stronger brand tint to compensate for the darker surface", () => {
    const body = ruleBody(css, '[data-theme="dark"] .wb-composer:focus-within');
    expect(body).toBeTruthy();
    expect(body!).toMatch(/0 0 0 4px color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+18%/);
    expect(body!).toMatch(/0 2px 12px color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+10%/);
  });

  it("dark-theme border is 45% brand tint (more visible against the dark composer surface)", () => {
    const body = ruleBody(css, '[data-theme="dark"] .wb-composer:focus-within');
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border-color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+45%/);
  });
});

describe("R8.29 reduced-motion guard", () => {
  it("disables the focus transition when prefers-reduced-motion is set", () => {
    // Match the second reduced-motion block (the one after the
    // :focus-within rule). The file has multiple @media blocks.
    const focusMatch = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.wb-composer:focus-within\s*\{[\s\S]*?transition:\s*none[\s\S]*?\}[\s\S]*?\}/
    );
    expect(focusMatch).toBeTruthy();
  });
});
