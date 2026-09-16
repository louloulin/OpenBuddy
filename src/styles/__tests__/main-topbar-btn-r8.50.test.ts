/**
 * main-topbar-btn-r8.50.test.ts — guard spec for the R8.50
 * main-topbar button motion-token polish.
 *
 * Before R8.50 the .main-topbar__btn hover transition used a
 * magic 120ms number with no motion tokens. R8.50 routes the
 * transition through the R8.9 motion tokens and adds the
 * R8.18 active-scale micro-interaction. Focus-visible ring also
 * gets a brand-tinted outline.
 *
 * Coverage:
 *   - transitions route through R8.9 motion tokens
 *     (background + color + transform)
 *   - :active:not(:disabled) applies scale(0.94) (R8.18 parity)
 *   - :focus-visible uses brand-tinted 2px outline + 2px offset
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "..", "shell.css"), "utf8");

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

describe("R8.50 .main-topbar__btn motion-token transition", () => {
  it("drives background + color + transform through R8.9 motion tokens", () => {
    const body = ruleBody(css, ".main-topbar__btn");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transition:[\s\S]*?background/);
    expect(body!).toMatch(/transition:[\s\S]*?color/);
    expect(body!).toMatch(/transition:[\s\S]*?transform/);
    expect(body!).toMatch(/var\(--wb-motion-duration-fast,\s*120ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });
});

describe("R8.50 .main-topbar__btn:active micro-interaction (R8.18 parity)", () => {
  it("applies scale(0.94) on :active:not(:disabled)", () => {
    const body = ruleBody(css, ".main-topbar__btn:active:not(:disabled)");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transform:\s*scale\(0\.94\)/);
  });
});

describe("R8.50 .main-topbar__btn:focus-visible keyboard accessibility", () => {
  it("carries a brand-tinted 2px outline + 2px offset", () => {
    const body = ruleBody(css, ".main-topbar__btn:focus-visible");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/outline:\s*2px solid var\(--wb-brand/);
    expect(body!).toMatch(/outline-offset:\s*2px/);
  });
});
