/**
 * composer-tool-r8.46.test.ts — guard spec for the R8.46 composer
 * voice/tool button polish.
 *
 * Before R8.46 the .wb-composer__tool--active state used a hardcoded
 * Apple system blue rgba() fallback that leaked into OpenBuddy's
 * theme system. R8.46 migrates to color-mix on the canonical
 * --wb-brand token, adds motion-token transitions for hover/active,
 * and applies the R8.18 active-scale micro-interaction.
 *
 * Coverage:
 *   - .wb-composer__tool transitions through R8.9 motion tokens
 *   - :active:not(:disabled) applies scale(0.94) (R8.18 parity)
 *   - .wb-composer__tool--active uses color-mix on --wb-brand
 *     (12% alpha) instead of the legacy rgba fallback
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "..", "sidebar-menus.css"), "utf8");

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

describe("R8.46 .wb-composer__tool base transition", () => {
  it("drives transitions through R8.9 motion tokens (background + color + transform)", () => {
    const body = ruleBody(css, ".wb-composer__tool");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transition:[\s\S]*?background/);
    expect(body!).toMatch(/transition:[\s\S]*?color/);
    expect(body!).toMatch(/transition:[\s\S]*?transform/);
    expect(body!).toMatch(/var\(--wb-motion-duration-fast,\s*120ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });
});

describe("R8.46 .wb-composer__tool:active micro-interaction", () => {
  it("applies scale(0.94) on :active:not(:disabled) (R8.18 parity)", () => {
    const body = ruleBody(css, ".wb-composer__tool:active:not(:disabled)");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transform:\s*scale\(0\.94\)/);
  });
});

describe("R8.46 .wb-composer__tool--active token migration", () => {
  it("background uses color-mix on --wb-brand (12% alpha)", () => {
    const body = ruleBody(css, ".wb-composer__tool--active");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+12%/);
  });

  it("no longer uses the legacy rgba() fallback", () => {
    const body = ruleBody(css, ".wb-composer__tool--active");
    expect(body).toBeTruthy();
    // Strip comments first so the historical reference inside the
    // R8.46 comment block doesn't trip the test.
    const stripped = body!.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).not.toMatch(/rgba\(var\(--wb-brand-rgb/);
  });

  it("keeps the pulse animation (1.4s ease-in-out infinite)", () => {
    const body = ruleBody(css, ".wb-composer__tool--active");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/animation:\s*wb-composer__pulse\s+1\.4s\s+ease-in-out\s+infinite/);
  });
});
