/**
 * ai-role-badge-r8.43.test.ts — guard spec for the "AI" role badge.
 *
 * R8.43 originally lifted the badge to 18px with a brand-tinted
 * border and brand-mixed text colour. The R5 visual pass reverted
 * that: the brand-tinted chip was judged visually heavy, and the
 * badge is now a monochrome low-contrast chip (closer to ChatGPT's
 * neutral "AI" label). These guards describe the badge as it exists
 * now, and pin the removal of the brand tint so it cannot creep back
 * one declaration at a time.
 *
 * Coverage:
 *   - .msg--assistant .msg__role is 18px tall
 *   - padding is 0 6px for horizontal breathing room
 *   - surface + text come from neutral tokens, never --wb-brand
 *   - uppercase preserved at weight 500, letter-spacing 0.04em
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

describe(".msg--assistant .msg__role badge", () => {
  it("is 18px tall", () => {
    const body = ruleBody(prose, ".msg--assistant .msg__role");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/height:\s*18px/);
  });

  it("uses 0 6px padding for horizontal breathing room", () => {
    const body = ruleBody(prose, ".msg--assistant .msg__role");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/padding:\s*0 6px/);
  });

  it("stays monochrome — no brand tint on surface, border or text (R5)", () => {
    const body = ruleBody(prose, ".msg--assistant .msg__role");
    expect(body).toBeTruthy();
    expect(body!).not.toMatch(/var\(--wb-brand/);
    expect(body!).toMatch(/background:\s*var\(--wb-bg-secondary/);
    expect(body!).toMatch(/color:\s*var\(--wb-text-weak/);
  });

  it("preserves uppercase at weight 500", () => {
    const body = ruleBody(prose, ".msg--assistant .msg__role");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/text-transform:\s*uppercase/);
    expect(body!).toMatch(/font-weight:\s*500/);
  });

  it("keeps 0.04em letter-spacing", () => {
    const body = ruleBody(prose, ".msg--assistant .msg__role");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/letter-spacing:\s*0\.04em/);
  });
});