/**
 * jump-bottom-r8.41.test.ts — R8.60 updated guard spec for the jump-to-bottom
 * floating pill. The R8.41 brand-tint polish has been retired in R8.60 per
 * user feedback ("颜色不要改成绿色,还是参考这个正常的黑色"): the pill border,
 * halo, hover and counter badge are now neutral, matching the WorkBuddy
 * floating "jump-to-bottom" pill language. Brand accent is reserved for the
 * streaming dot / focus ring / left-bar.
 *
 * Coverage:
 *   - .chatview__jump-bottom border + halo use neutral tokens
 *   - .chatview__jump-bottom:hover uses neutral border + text-strong colour
 *   - active micro-interaction still applies scale(0.94) (R8.18 parity)
 *   - .chatview__jump-bottom-badge counter pill uses --wb-button-primary-bg
 *     (not --wb-brand / --wb-accent)
 *   - motion tokens drive transitions
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prose = readFileSync(join(__dirname, "..", "prose.css"), "utf8");

function ruleBody(input: string, selector: string): string | null {
  const idx = input.indexOf(selector + " {");
  if (idx < 0) return null;
  let depth = 0;
  let start = -1;
  for (let i = idx; i < input.length; i++) {
    const ch = input[i];
    if (ch === "{") { depth++; if (start < 0) start = i + 1; }
    else if (ch === "}") { depth--; if (depth === 0) return input.slice(start, i); }
  }
  return null;
}

describe("R8.60 .chatview__jump-bottom base", () => {
  it("uses a neutral border (no brand tint, R8.60)", () => {
    const body = ruleBody(prose, ".chatview__jump-bottom");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border:\s*1px solid var\(--wb-border-default/);
    expect(body!.match(/--wb-brand/g)?.length ?? 0).toBe(0);
  });

  it("halo uses neutral mix (no brand tint, R8.60)", () => {
    const body = ruleBody(prose, ".chatview__jump-bottom");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/box-shadow:\s*0 2px 8px color-mix\(in srgb,\s*var\(--wb-text-strong/);
  });

  it("drives transitions through R8.9 motion tokens", () => {
    const body = ruleBody(prose, ".chatview__jump-bottom");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/var\(--wb-motion-duration-fast,\s*120ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });
});

describe("R8.60 .chatview__jump-bottom:hover", () => {
  it("uses neutral border + text-strong colour + 1px lift", () => {
    const body = ruleBody(prose, ".chatview__jump-bottom:hover");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border-color:\s*var\(--wb-text-strong/);
    expect(body!).toMatch(/color:\s*var\(--wb-text-strong/);
    expect(body!).toMatch(/transform:\s*translateY\(-1px\)/);
    expect(body!.match(/--wb-brand/g)?.length ?? 0).toBe(0);
  });
});

describe("R8.60 .chatview__jump-bottom:active micro-interaction (R8.18 parity)", () => {
  it("applies scale(0.94) on :active:not(:disabled)", () => {
    const body = ruleBody(prose, ".chatview__jump-bottom:active:not(:disabled)");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transform:\s*scale\(0\.94\)/);
  });
});

describe("R8.60 .chatview__jump-bottom-badge counter pill", () => {
  it("counter pill uses --wb-button-primary-bg (neutral, R8.60)", () => {
    const body = ruleBody(prose, ".chatview__jump-bottom-badge");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*var\(--wb-button-primary-bg\)/);
    expect(body!).toMatch(/color:\s*var\(--wb-button-primary-fg\)/);
    expect(body!.match(/--wb-brand/g)?.length ?? 0).toBe(0);
  });
});
