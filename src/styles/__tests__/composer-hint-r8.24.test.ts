/**
 * composer-hint-r8.24.test.ts — guard spec for the R8.24 Composer
 * keyboard hint chip.
 *
 * The chip is a small PI-Desktop-style `<kbd>+label` pair rendered
 * inside `.wb-composer__footer` that reminds the user of the two
 * most-used keys (Enter to send, Shift+Enter to insert a newline).
 *
 * Coverage:
 *   - .wb-composer__hint exists with brand-tinted background
 *   - .wb-composer__hint-key styles <kbd> with the 2px-bottom-border
 *     keycap convention + brand-tinted border
 *   - mobile breakpoint (max-width: 540px) hides the chip
 *   - reduced-motion guard prevents the hover micro-animation
 *   - dark theme override swaps the kbd background for a brand
 *     tint so the chip stays readable
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

describe("R8.24 .wb-composer__hint base styles", () => {
  it("exists and uses inline-flex layout", () => {
    const body = ruleBody(css, ".wb-composer__hint");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/display:\s*inline-flex/);
    expect(body!).toMatch(/align-items:\s*center/);
  });

  it("uses neutral tertiary background + weak text (WorkBuddy parity, R8.60)", () => {
    const body = ruleBody(css, ".wb-composer__hint");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*var\(--wb-bg-tertiary/);
    expect(body!).toMatch(/color:\s*var\(--wb-text-weak/);
  });

  it("animates background + color on hover with R8.9 motion tokens", () => {
    const body = ruleBody(css, ".wb-composer__hint");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/var\(--wb-motion-duration-fast,\s*120ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });

  it("hover state lifts neutral tint for feedback (R8.60: no brand color)", () => {
    const body = ruleBody(css, ".wb-composer__hint:hover");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*var\(--wb-text-strong/);
    expect(body!.match(/--wb-brand/g)?.length ?? 0).toBe(0);
  });
});

describe("R8.24 .wb-composer__hint-key (kbd) styles", () => {
  it("renders as a keycap with 2px-bottom border (PI-Desktop MessageMeta parity)", () => {
    const body = ruleBody(css, ".wb-composer__hint-key");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/display:\s*inline-flex/);
    expect(body!).toMatch(/align-items:\s*center/);
    expect(body!).toMatch(/justify-content:\s*center/);
    expect(body!).toMatch(/border-bottom-width:\s*2px/);
    expect(body!).toMatch(/border-radius:\s*4px/);
  });

  it("uses monospace font + 10px size for the keycap text", () => {
    const body = ruleBody(css, ".wb-composer__hint-key");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/font-family:\s*ui-monospace/);
    expect(body!).toMatch(/font-size:\s*10px/);
  });

  it("uses neutral border color (R8.60: no brand tint on keycap)", () => {
    const body = ruleBody(css, ".wb-composer__hint-key");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border:\s*1px solid var\(--wb-border-default/);
    expect(body!.match(/--wb-brand/g)?.length ?? 0).toBe(0);
  });

  it("hover lifts the keycap by 1px (micro-interaction feedback)", () => {
    const body = ruleBody(css, ".wb-composer__hint:hover .wb-composer__hint-key");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transform:\s*translateY\(-1px\)/);
  });
});

describe("R8.24 mobile responsiveness", () => {
  it("hides the chip on phone-width screens (max-width: 540px)", () => {
    // Find the mobile media block; the rule body must be `display: none`.
    const mobileIdx = css.indexOf("@media (max-width: 540px)");
    expect(mobileIdx).toBeGreaterThan(-1);
    const slice = css.slice(mobileIdx, mobileIdx + 600);
    expect(slice).toMatch(/\.wb-composer__hint\s*\{[^}]*display:\s*none/);
  });
});

describe("R8.24 reduced-motion guard", () => {
  it("disables the chip's transition + hover lift when reduced-motion is requested", () => {
    const body = ruleBody(
      css,
      "@media (prefers-reduced-motion: reduce)"
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/\.wb-composer__hint[\s\S]*?transition:\s*none/);
    expect(body!).toMatch(/\.wb-composer__hint:hover \.wb-composer__hint-key[\s\S]*?transform:\s*none/);
  });
});

describe("R8.24 dark theme overrides", () => {
  it("dark theme: elevated neutral kbd background (R8.60: no brand tint)", () => {
    const body = ruleBody(
      css,
      '[data-theme="dark"] .wb-composer__hint-key'
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*var\(--wb-bg-elevated/);
    expect(body!.match(/--wb-brand/g)?.length ?? 0).toBe(0);
  });
});
