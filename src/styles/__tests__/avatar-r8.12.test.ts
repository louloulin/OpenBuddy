/**
 * avatar-r8.12.test.ts — guard spec for the R8.12 assistant avatar visual
 * upgrade. Pins the Sparkles-icon + brand-tinted gradient + AI role
 * badge selectors so future refactors can't silently downgrade the
 * avatar back to a generic letter avatar.
 *
 * Coverage:
 *   - .msg__avatar is 28×28 with rounded square shape + brand gradient
 *   - gradient uses color-mix(in srgb, var(--wb-brand) ... %) so it
 *     inherits dark/light theme tokens without per-theme overrides
 *   - .msg__role renders a tiny "AI" badge next to the Buddy name
 *   - badge uses color-mix on brand for consistent tinting
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const stylesDir = join(__dirname, "..");
const allCss = readdirSync(stylesDir)
  .filter((f) => f.endsWith(".css"))
  .map((f) => readFileSync(join(stylesDir, f), "utf8"))
  .join("\n");

const prose = readFileSync(join(stylesDir, "prose.css"), "utf8");

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

describe("R8.12 .msg__avatar visual upgrade", () => {
  it("is a 28×28 rounded square (not a circle)", () => {
    const a = ruleBody(prose, ".msg--assistant .msg__avatar");
    expect(a).toBeTruthy();
    expect(a!).toMatch(/width:\s*28px/);
    expect(a!).toMatch(/height:\s*28px/);
    expect(a!).toMatch(/border-radius:\s*8px/);
    // No `border-radius: 50%` — the avatar is a rounded square to read
    // as "AI app icon" rather than a user profile circle.
    expect(a!).not.toMatch(/border-radius:\s*50%/);
  });

  it("uses a neutral surface — the brand gradient was reverted (R5)", () => {
    const a = ruleBody(prose, ".msg--assistant .msg__avatar");
    expect(a).toBeTruthy();
    // R8.12 gave the avatar a brand-tinted 135deg gradient with white
    // glyphs. The R5 visual pass replaced it with a flat neutral chip:
    // a coloured gradient on every assistant message made the
    // transcript read as marketing. Guard the removal.
    expect(a!).not.toMatch(/linear-gradient/);
    expect(a!).not.toMatch(/var\(--wb-brand/);
    expect(a!).toMatch(/background:\s*var\(--wb-bg-secondary/);
    expect(a!).toMatch(/border:\s*1px solid var\(--wb-border-default\)/);
  });

  it("centres its content in the weak text token", () => {
    const a = ruleBody(prose, ".msg--assistant .msg__avatar");
    expect(a).toBeTruthy();
    expect(a!).toMatch(/display:\s*flex/);
    expect(a!).toMatch(/align-items:\s*center/);
    expect(a!).toMatch(/justify-content:\s*center/);
    expect(a!).toMatch(/color:\s*var\(--wb-text-medium\)/);
  });
});

describe('.msg__role "AI" badge', () => {
  it("renders a tiny uppercase pill next to the Buddy name", () => {
    const r = ruleBody(prose, ".msg--assistant .msg__role");
    expect(r).toBeTruthy();
    expect(r!).toMatch(/display:\s*inline-flex/);
    expect(r!).toMatch(/align-items:\s*center/);
    expect(r!).toMatch(/height:\s*18px/);
    expect(r!).toMatch(/padding:\s*0 6px/);
    expect(r!).toMatch(/border-radius:\s*4px/);
    expect(r!).toMatch(/font-size:\s*10px/);
    expect(r!).toMatch(/font-weight:\s*500/);
    expect(r!).toMatch(/letter-spacing:[^;]*0\.04em/);
  });

  it("carries no brand tint — the badge is monochrome (R5)", () => {
    const r = ruleBody(prose, ".msg--assistant .msg__role");
    expect(r).toBeTruthy();
    expect(r!).not.toMatch(/var\(--wb-brand/);
    expect(r!).not.toMatch(/border:\s*1px solid/);
    expect(r!).toMatch(/background:\s*var\(--wb-bg-secondary/);
    expect(r!).toMatch(/color:\s*var\(--wb-text-weak/);
  });
});
