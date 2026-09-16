/**
 * chatview-mobile-r8.19.test.ts — guard spec for the R8.19 mobile /
 * narrow-viewport responsive breakpoints.
 *
 * Three tiers verified:
 *   - ≤ 768px (tablet portrait): 88% user-bubble, 12px padding
 *   - ≤ 540px (phone portrait): 92% user-bubble, smaller avatar
 *   - ≤ 380px (small phone / split-screen): 100% user-bubble, tighter
 *     composer spacing
 *
 * Pinned so a future refactor can't silently drop the responsive
 * behaviour (e.g. by deleting the @media block thinking it's unused).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const messages = readFileSync(join(__dirname, "..", "messages.css"), "utf8");

/** Find a `@media (...) { ... }` block whose contents contain the
 *  selector string. Returns the block body (between the outer braces). */
function findMediaBlock(css: string, maxWidth: number): string | null {
  const needle = `@media (max-width: ${maxWidth}px)`;
  const start = css.indexOf(needle);
  if (start < 0) return null;
  // Walk to the first `{` after the media query, then brace-balance.
  let depth = 0;
  let bodyStart = -1;
  for (let i = start; i < css.length; i++) {
    if (css[i] === "{") {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(bodyStart, i);
    }
  }
  return null;
}

describe("R8.19 tablet portrait breakpoint (≤ 768px)", () => {
  const block = findMediaBlock(messages, 768);
  it("declares the @media query for 768px", () => {
    expect(block).toBeTruthy();
  });
  it("widens the user bubble from 75% → 88%", () => {
    expect(block).toBeTruthy();
    expect(block!).toMatch(/\.msg--user\s*>\s*div\s*\{[\s\S]*?max-width:\s*88%/);
  });
  it("trims .chatview__inner padding to 12px horizontal", () => {
    expect(block).toBeTruthy();
    expect(block!).toMatch(/\.chatview__inner\s*\{[\s\S]*?padding:\s*16px 12px 8px/);
  });
});

describe("R8.19 phone portrait breakpoint (≤ 540px)", () => {
  const block = findMediaBlock(messages, 540);
  it("declares the @media query for 540px", () => {
    expect(block).toBeTruthy();
  });
  it("widens the user bubble further to 92%", () => {
    expect(block).toBeTruthy();
    expect(block!).toMatch(/\.msg--user\s*>\s*div\s*\{[\s\S]*?max-width:\s*92%/);
  });
  it("shrinks the assistant avatar to 24×24", () => {
    expect(block).toBeTruthy();
    expect(block!).toMatch(/\.msg--assistant\s+\.msg__avatar\s*\{[\s\S]*?width:\s*24px/);
    expect(block!).toMatch(/height:\s*24px/);
  });
});

describe("R8.19 small-phone / split-screen breakpoint (≤ 380px)", () => {
  const block = findMediaBlock(messages, 380);
  it("declares the @media query for 380px", () => {
    expect(block).toBeTruthy();
  });
  it("maxes the user bubble out at 100%", () => {
    expect(block).toBeTruthy();
    expect(block!).toMatch(/\.msg--user\s*>\s*div\s*\{[\s\S]*?max-width:\s*100%/);
  });
  it("tightens the assistant header gap for cramped viewports", () => {
    expect(block).toBeTruthy();
    expect(block!).toMatch(/\.msg--assistant\s+\.msg__header\s*\{[\s\S]*?gap:\s*4px/);
  });
});
