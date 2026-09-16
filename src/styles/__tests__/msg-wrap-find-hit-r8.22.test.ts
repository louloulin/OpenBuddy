/**
 * msg-wrap-find-hit-r8.22.test.ts — guard spec for the R8.22 find
 * highlight token migration.
 *
 * Coverage:
 *   - .msg-wrap--find-hit background uses color-mix on text-strong
 *   - .msg-wrap--find-current background uses color-mix on brand
 *   - both keep the inset 3px brand left bar
 *   - both use R8.9 motion tokens for the background transition
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

describe("R8.22 .msg-wrap--find-hit neutral highlight", () => {
  it("uses color-mix on text-strong (5% alpha)", () => {
    const body = ruleBody(messages, ".msg-wrap--find-hit");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-text-strong/);
    expect(body!).toMatch(/var\(--wb-text-strong[\s\S]*?\)\s+5%/);
  });

  it("keeps the inset 3px brand left bar", () => {
    const body = ruleBody(messages, ".msg-wrap--find-hit");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--wb-brand/);
  });

  it("transitions via R8.9 motion tokens", () => {
    const body = ruleBody(messages, ".msg-wrap--find-hit");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transition:\s*background/);
    expect(body!).toMatch(/var\(--wb-motion-duration-fast/);
  });
});

describe("R8.22 .msg-wrap--find-current active highlight", () => {
  it("uses color-mix on brand (12% alpha — stronger than hits)", () => {
    const body = ruleBody(messages, ".msg-wrap--find-current");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand/);
    expect(body!).toMatch(/var\(--wb-brand[\s\S]*?\)\s+12%/);
  });

  it("uses a stronger brand tint than .msg-wrap--find-hit so the user can locate the current hit at a glance", () => {
    const hit = ruleBody(messages, ".msg-wrap--find-hit");
    const current = ruleBody(messages, ".msg-wrap--find-current");
    expect(hit).toBeTruthy();
    expect(current).toBeTruthy();
    const hitPct = hit!.match(/var\(--wb-text-strong[\s\S]*?\)\s+(\d+)%/);
    const curPct = current!.match(/var\(--wb-brand[\s\S]*?\)\s+(\d+)%/);
    expect(hitPct).toBeTruthy();
    expect(curPct).toBeTruthy();
    // The current hit's brand tint must exceed the neutral hit's text
    // tint so the two states read distinctly.
    expect(Number(curPct![1])).toBeGreaterThan(Number(hitPct![1]));
  });
});
