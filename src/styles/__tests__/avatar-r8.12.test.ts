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

  it("uses a brand-tinted linear gradient (inherits dark/light via tokens)", () => {
    const a = ruleBody(prose, ".msg--assistant .msg__avatar");
    expect(a).toBeTruthy();
    expect(a!).toMatch(/background:\s*linear-gradient\(135deg,/);
    expect(a!).toMatch(/color-mix\(in srgb,\s*var\(--wb-brand/);
    // The dark stop should mix brand with a small amount of black for
    // depth (otherwise the gradient looks flat). Match both gradient
    // stops; each starts with `color-mix(in srgb, var(--wb-brand`.
    expect(a!).toMatch(/color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+\d+%,\s*white/);
    expect(a!).toMatch(/color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+\d+%,\s*#000/);
  });

  it("centres its content + paints white text + drops a subtle brand shadow", () => {
    const a = ruleBody(prose, ".msg--assistant .msg__avatar");
    expect(a).toBeTruthy();
    expect(a!).toMatch(/display:\s*flex/);
    expect(a!).toMatch(/align-items:\s*center/);
    expect(a!).toMatch(/justify-content:\s*center/);
    expect(a!).toMatch(/color:\s#fff/);
    expect(a!).toMatch(/box-shadow:[^;]*wb-brand/);
  });
});

describe('R8.12 .msg__role "AI" badge', () => {
  it("renders a tiny uppercase pill next to the Buddy name", () => {
    const r = ruleBody(prose, ".msg--assistant .msg__role");
    expect(r).toBeTruthy();
    expect(r!).toMatch(/display:\s*inline-flex/);
    expect(r!).toMatch(/align-items:\s*center/);
    // R8.43 — AI role badge grew to 18px + picked up a 1px brand-tinted
    // border + tightened letter-spacing (0.04em → 0.06em) for a
    // more premium feel. The badge padding bumped from "0 5px" to
    // "0 6px" so the wider letter-spacing has breathing room.
    expect(r!).toMatch(/height:\s*18px/);
    expect(r!).toMatch(/padding:\s*0 6px/);
    expect(r!).toMatch(/border-radius:\s*4px/);
    expect(r!).toMatch(/border:\s*1px solid color-mix/);
    expect(r!).toMatch(/font-size:\s*10px/);
    expect(r!).toMatch(/font-weight:\s*600/);
    expect(r!).toMatch(/letter-spacing:[^;]*0\.06em/);
  });

  it("uses color-mix on the brand token for consistent tinting across themes", () => {
    const r = ruleBody(prose, ".msg--assistant .msg__role");
    expect(r).toBeTruthy();
    // bg mixes brand at 12% (subtle pill), color is the brand directly.
    expect(r!).toMatch(/background:[^;]*color-mix\(in srgb,\s*var\(--wb-brand\)\s*12%/);
    expect(r!).toMatch(/color:[^;]*wb-brand/);
  });
});
