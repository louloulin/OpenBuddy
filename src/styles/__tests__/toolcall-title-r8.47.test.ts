/**
 * toolcall-title-r8.47.test.ts — guard spec for the R8.47 tool
 * call title polish.
 *
 * Before R8.47 the .toolcall__title used the default sans-serif
 * font. R8.47 switches it to the codebase code family so the
 * title reads as "code-ish" (matches the .toolcall__kind chip +
 * .toolcall__output below it), and adds a brand-tinted hover
 * state for interactive feedback.
 *
 * Coverage:
 *   - .toolcall__title uses --wb-font-code-family
 *   - colour transition uses R8.9 motion tokens
 *   - hover state lifts the title colour to 35% brand mix
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "..", "tool-call.css"), "utf8");

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

describe("R8.47 .toolcall__title base", () => {
  it("uses --wb-font-code-family so the title reads as code-ish", () => {
    const body = ruleBody(css, ".toolcall__title");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/font-family:\s*var\(--wb-font-code-family/);
  });

  it("drives colour transition through R8.9 motion tokens", () => {
    const body = ruleBody(css, ".toolcall__title");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transition:\s*color var\(--wb-motion-duration-fast,\s*120ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });
});

describe("R8.47 .toolcall:hover .toolcall__title", () => {
  it("lifts title colour to 35% brand mix on row hover", () => {
    const body = ruleBody(css, ".toolcall:hover .toolcall__title");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+35%/);
  });
});
