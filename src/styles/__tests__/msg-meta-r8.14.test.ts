/**
 * msg-meta-r8.14.test.ts — guard spec for the R8.14 per-message meta chip.
 *
 * Pins the CSS contract that backs the timestamp + duration label rendered
 * by MessageMeta so future refactors can't silently downgrade it back to
 * the bare assistant header.
 *
 * Coverage:
 *   - .msg__meta renders an inline-flex chip below the message body
 *   - chip uses the brand / text-weak tokens (no hardcoded rgba outside the fallback)
 *   - .msg__meta--streaming pulses via a keyframes animation tied to the
 *     R8.9 motion-duration token (so reduced-motion can dampen it)
 *   - .msg__meta--user is the smaller variant rendered under user bubbles
 *   - hover gate lifts opacity 0.55 → 0.95
 *   - @media (prefers-reduced-motion: reduce) disables the pulse
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

describe("R8.14 .msg__meta (assistant timestamp + duration chip)", () => {
  it("renders as an inline-flex row of small text below the message body", () => {
    const body = ruleBody(prose, ".msg__meta");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/display:\s*inline-flex/);
    expect(body!).toMatch(/align-items:\s*center/);
    expect(body!).toMatch(/gap:\s*4px/);
    expect(body!).toMatch(/margin-top:\s*4px/);
    expect(body!).toMatch(/font-size:\s*11px/);
  });

  it("uses the text-weak token (so dark/light themes stay consistent)", () => {
    const body = ruleBody(prose, ".msg__meta");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*var\(--wb-text-weak/);
    // Default opacity is low (0.55) so the chip is a glanceable affordance
    // and doesn't compete with the message body.
    expect(body!).toMatch(/opacity:\s*0\.55/);
  });

  it("brightens on .msg :hover / :focus-within (matches the .msg__footer gate)", () => {
    // We assert via regex on the whole prose block because the hover rule
    // targets `.msg:hover .msg__meta` rather than a single-class selector
    // that ruleBody() can extract directly.
    const hoverMatch = prose.match(/\.msg:hover\s+\.msg__meta[\s\S]*?\{[\s\S]*?\}/);
    expect(hoverMatch).toBeTruthy();
    expect(hoverMatch![0]).toMatch(/opacity:\s*0\.95/);
    const focusMatch = prose.match(/\.msg__meta:focus-within\s*\{[\s\S]*?\}/);
    expect(focusMatch).toBeTruthy();
    expect(focusMatch![0]).toMatch(/opacity:\s*0\.95/);
  });

  it("uses the R8.9 motion-duration tokens (so reduced-motion works uniformly)", () => {
    const body = ruleBody(prose, ".msg__meta");
    expect(body).toBeTruthy();
    // The opacity transition re-uses the standard duration token with a
    // standard easing fallback. Both var() + the literal fallback must
    // be present so JS-driven animation libraries (or older browsers)
    // still get a sensible value.
    expect(body!).toMatch(/var\(--wb-motion-duration-fast,\s*120ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-standard,\s*ease-out\)/);
  });
});

describe("R8.14 .msg__meta--streaming pulse", () => {
  it("brand-tints the streaming label and triggers a pulse animation", () => {
    const body = ruleBody(prose, ".msg__meta--streaming");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color-mix\(in srgb,\s*var\(--wb-brand/);
    expect(body!).toMatch(/animation:\s*msg-meta-pulse/);
    // Duration must come from the R8.9 motion token (with a fallback).
    expect(body!).toMatch(/var\(--wb-motion-duration-slow,\s*1200ms\)/);
  });

  it("declares a msg-meta-pulse keyframes that swings opacity 0.55 ↔ 1", () => {
    // keyframes lives outside any single selector — scan whole prose.
    // The non-greedy regex stops at the FIRST `}`, so we use a custom
    // brace-balancer to capture the whole @keyframes block.
    const start = prose.indexOf("@keyframes msg-meta-pulse");
    expect(start).toBeGreaterThanOrEqual(0);
    let depth = 0;
    let end = -1;
    for (let i = start; i < prose.length; i++) {
      const ch = prose[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    expect(end).toBeGreaterThan(start);
    const kf = prose.slice(start, end);
    expect(kf).toMatch(/opacity:\s*0\.55/);
    // The 50% keyframe pushes opacity to 1; the 0% / 100% keyframe at
    // 0.55. Both must be present so the animation actually swings.
    expect(kf).toMatch(/opacity:\s*1/);
  });

  it("is suppressed under prefers-reduced-motion (R8.9 accessibility safety net)", () => {
    const reducedMatch = prose.match(
      /@media\s+\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.msg__meta--streaming[\s\S]*?\}/,
    );
    expect(reducedMatch).toBeTruthy();
    expect(reducedMatch![0]).toMatch(/animation:\s*none/);
  });
});

describe("R8.14 .msg__meta--user variant", () => {
  it("renders a smaller chip under user bubbles (10px, lower opacity)", () => {
    const body = ruleBody(prose, ".msg__meta--user");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/margin-top:\s*3px/);
    expect(body!).toMatch(/font-size:\s*10px/);
    expect(body!).toMatch(/opacity:\s*0\.45/);
  });
});

describe("R8.14 .msg__meta-icon / .msg__meta-detail helpers", () => {
  it("renders the icon as a 12×12 inline-flex square", () => {
    const body = ruleBody(prose, ".msg__meta-icon");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/display:\s*inline-flex/);
    expect(body!).toMatch(/width:\s*12px/);
    expect(body!).toMatch(/height:\s*12px/);
  });

  it("renders the duration detail with tabular-nums + subtle color", () => {
    const body = ruleBody(prose, ".msg__meta-detail");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(body!).toMatch(/color:\s*var\(--wb-text-weak/);
  });
});
