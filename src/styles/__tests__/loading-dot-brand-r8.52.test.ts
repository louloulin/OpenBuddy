/**
 * loading-dot-brand-r8.52.test.ts — guard spec for the R8.52
 * loading-dot brand tint.
 *
 * Before R8.52 the three "in-flight" dots next to a streaming
 * assistant message used `--wb-text-strong` (a neutral grey) at
 * 55% alpha, which read as "muted placeholder". R8.52 swaps that
 * for `--wb-brand` at 70% alpha via `color-mix` so the dots feel
 * alive and on-brand, while still staying subtle enough not to
 * compete with the avatar's gradient halo.
 *
 * Coverage:
 *   - .msg__loading-dot background uses color-mix on --wb-brand
 *     (70% alpha) — no more hard-coded --wb-text-strong
 *   - 5x5 size + 9999px radius preserved
 *   - bounce animation preserved (1s ease-in-out infinite)
 *   - 3 staggered animation delays preserved
 *     (-0.3s / -0.15s / 0s)
 *   - the ob-loading-bounce keyframes still drive translateY + opacity
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

function stripComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("R8.52 .msg__loading-dot brand tint", () => {
  it("uses color-mix on --wb-brand (70% alpha) for the dot background", () => {
    const body = ruleBody(prose, ".msg__loading-dot");
    expect(body).toBeTruthy();
    expect(body!).toMatch(
      /background:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+70%/,
    );
  });

  it("no longer uses --wb-text-strong for the dot background", () => {
    const cleaned = stripComments(prose);
    const body = ruleBody(cleaned, ".msg__loading-dot");
    expect(body).toBeTruthy();
    expect(body!).not.toMatch(/--wb-text-strong/);
  });

  it("preserves the 5x5 dot size", () => {
    const body = ruleBody(prose, ".msg__loading-dot");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/width:\s*5px/);
    expect(body!).toMatch(/height:\s*5px/);
  });

  it("preserves the 9999px border-radius for a fully-rounded dot", () => {
    const body = ruleBody(prose, ".msg__loading-dot");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border-radius:\s*9999px/);
  });

  it("keeps the ob-loading-bounce animation at 1s ease-in-out infinite", () => {
    const body = ruleBody(prose, ".msg__loading-dot");
    expect(body).toBeTruthy();
    expect(body!).toMatch(
      /animation:\s*ob-loading-bounce\s+1s\s+ease-in-out\s+infinite/,
    );
  });

  it("preserves the three staggered animation delays", () => {
    expect(prose).toMatch(/\.msg__loading-dot--1\s*\{\s*animation-delay:\s*-0\.3s/);
    expect(prose).toMatch(/\.msg__loading-dot--2\s*\{\s*animation-delay:\s*-0\.15s/);
    expect(prose).toMatch(/\.msg__loading-dot--3\s*\{\s*animation-delay:\s*0s/);
  });

  it("keeps the ob-loading-bounce keyframes driving translateY + opacity", () => {
    expect(prose).toMatch(/@keyframes\s+ob-loading-bounce\s*\{/);
    expect(prose).toMatch(/40%\s*\{[\s\S]*?transform:\s*translateY\(-5px\)/);
    expect(prose).toMatch(/40%\s*\{[\s\S]*?opacity:\s*1/);
  });
});
