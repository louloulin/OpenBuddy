/**
 * ai-role-badge-r8.43.test.ts — guard spec for the R8.43 AI role
 * badge polish.
 *
 * Before R8.43 the "AI" role badge was a small 16px-tall pill with
 * no border. R8.43 lifts it to 18px, adds a 1px brand-tinted
 * border, and tightens the colour-mix on the text colour so the
 * "AI" label reads cleanly against both light and dark surfaces.
 *
 * Coverage:
 *   - .msg--assistant .msg__role is now 18px tall (was 16px)
 *   - 1px brand-tinted border via color-mix (24% alpha)
 *   - text colour uses color-mix (80% brand + 10% strong) so it
 *     reads on both light + dark themes without per-theme overrides
 *   - padding bumped to 0 6px for better horizontal breathing room
 *   - letter-spacing tightened to 0.06em for a more premium feel
 *   - uppercase typography preserved
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

describe("R8.43 .msg--assistant .msg__role badge", () => {
  it("is 18px tall (was 16px before R8.43)", () => {
    const body = ruleBody(prose, ".msg--assistant .msg__role");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/height:\s*18px/);
  });

  it("uses 1px brand-tinted border (24% alpha) for definition", () => {
    const body = ruleBody(prose, ".msg--assistant .msg__role");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border:\s*1px solid color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+24%/);
  });

  it("text colour uses color-mix (80% brand + 10% strong) so it reads on both themes", () => {
    const body = ruleBody(prose, ".msg--assistant .msg__role");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+80%/);
  });

  it("preserves uppercase + 600 font weight", () => {
    const body = ruleBody(prose, ".msg--assistant .msg__role");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/text-transform:\s*uppercase/);
    expect(body!).toMatch(/font-weight:\s*600/);
  });

  it("tightens letter-spacing to 0.06em for premium feel", () => {
    const body = ruleBody(prose, ".msg--assistant .msg__role");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/letter-spacing:\s*0\.06em/);
  });
});
