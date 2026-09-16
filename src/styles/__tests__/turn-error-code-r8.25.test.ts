/**
 * turn-error-code-r8.25.test.ts — guard spec for the R8.25
 * TurnErrorCard error-code chip polish.
 *
 * Coverage:
 *   - .turn-error__code migrates from --wb-text-error to the canonical
 *     --wb-status-error token (with the legacy --wb-text-error kept as
 *     a fallback so older themes keep rendering)
 *   - chip carries a 1px border via color-mix for definition against
 *     the .turn-error card surface (was previously borderless)
 *   - chip text is selectable so the user can copy the code by hand
 *   - hover state lifts the brand-tint background (12% → 20%) + border
 *     opacity (28% → 40%) using R8.9 motion tokens
 *   - dark-theme override swaps the chip surface to the soft palette
 *     for legibility against the dark .turn-error card
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const messages = readFileSync(join(__dirname, "..", "messages.css"), "utf8");

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

describe("R8.25 .turn-error__code token migration", () => {
  it("uses --wb-status-error as the primary token (with legacy --wb-text-error fallback)", () => {
    const body = ruleBody(messages, ".turn-error__code");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/var\(--wb-status-error,\s*var\(--wb-text-error/);
    // The legacy --wb-text-error is preserved as the fallback inside
    // --wb-status-error, so it never breaks older themes.
    expect(body!).toMatch(/#c43030/);
  });

  it("background uses color-mix at 14% (matches .chatview__error-retry family)", () => {
    const body = ruleBody(messages, ".turn-error__code");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-status-error[\s\S]*?\)\s+14%/);
  });
});

describe("R8.25 .turn-error__code chip definition", () => {
  it("adds a 1px brand-tinted border via color-mix (was borderless before)", () => {
    const body = ruleBody(messages, ".turn-error__code");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border:\s*1px solid color-mix\(in srgb,\s*var\(--wb-status-error[\s\S]*?\)\s+28%/);
  });

  it("marks the chip text as user-selectable so users can copy the code", () => {
    const body = ruleBody(messages, ".turn-error__code");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/user-select:\s*text/);
  });

  it("drives hover/background transitions through R8.9 motion tokens", () => {
    const body = ruleBody(messages, ".turn-error__code");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transition:[\s\S]*?var\(--wb-motion-duration-fast,\s*120ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });
});

describe("R8.25 .turn-error__code:hover state", () => {
  it("lifts background tint 14% → 20% for hover affordance", () => {
    const body = ruleBody(messages, ".turn-error__code:hover");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color-mix\(in srgb,\s*var\(--wb-status-error[\s\S]*?\)\s+20%/);
  });

  it("lifts border tint 28% → 40% in lockstep with the background lift", () => {
    const body = ruleBody(messages, ".turn-error__code:hover");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border-color:\s*color-mix\(in srgb,\s*var\(--wb-status-error[\s\S]*?\)\s+40%/);
  });
});

describe("R8.25 .turn-error__code dark theme override", () => {
  it("uses the soft palette token in dark mode for legibility", () => {
    const body = ruleBody(messages, '[data-theme="dark"] .turn-error__code');
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-status-error,\s*#ff6f6f\)\s+18%/);
  });

  it("dark text colour brightens to #ff8b8b so the chip stays readable", () => {
    const body = ruleBody(messages, '[data-theme="dark"] .turn-error__code');
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*#ff8b8b/);
  });
});
