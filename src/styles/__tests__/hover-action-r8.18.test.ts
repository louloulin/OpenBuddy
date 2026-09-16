/**
 * hover-action-r8.18.test.ts — guard spec for the R8.18 hover-action
 * polish: PI-Desktop `.icon-btn:active scale(0.96)` parity + motion
 * token coherence.
 *
 * Coverage:
 *   - .msg__revision-btn :active applies transform: scale(0.96)
 *   - .msg__actions opacity transition uses R8.9 motion + ease tokens
 *   - the fade-out / fade-in timings line up so the row feels like a
 *     single composed element
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prose = readFileSync(join(__dirname, "..", "prose.css"), "utf8");
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

describe("R8.18 .msg__revision-btn active scale parity", () => {
  it("applies transform: scale(0.96) on :active (PI-Desktop parity)", () => {
    const body = ruleBody(messages, ".msg__revision-btn:active:not(:disabled)");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transform:\s*scale\(0\.96\)/);
  });

  it("does not apply the active scale when disabled (preserves the cursor:not-allowed)", () => {
    // Sanity: the active rule must guard on :not(:disabled) so a
    // disabled pager button doesn't visually depress.
    expect(messages).toMatch(/\.msg__revision-btn:active:not\(:disabled\)/);
  });
});

describe("R8.18 .msg__actions motion-token coherence", () => {
  it("drives the opacity transition through the R8.9 motion tokens", () => {
    const body = ruleBody(prose, ".msg__actions");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/var\(--wb-motion-duration-fast,\s*120ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });

  it("keeps the original magic-number-free opacity values (0 → 1)", () => {
    // The opacity range itself is unchanged — only the timing/easing
    // shifted to motion tokens. Pin both endpoints so a future
    // refactor can't accidentally make the row always-visible.
    expect(prose).toMatch(/\.msg__actions\s*\{[^}]*opacity:\s*0/);
    expect(prose).toMatch(/\.msg:hover\s+\.msg__actions\s*\{[^}]*opacity:\s*1/);
  });
});
