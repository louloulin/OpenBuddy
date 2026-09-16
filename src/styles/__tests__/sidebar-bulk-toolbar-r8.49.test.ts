/**
 * sidebar-bulk-toolbar-r8.49.test.ts — guard spec for the R8.49
 * sidebar bulk toolbar token migration.
 *
 * Before R8.49 the .sidebar__bulk-toolbar used the legacy
 * --wb-accent token (cool blue). R8.49 migrates to the canonical
 * --wb-brand token for token consistency with the rest of the
 * chat UI.
 *
 * Coverage:
 *   - .sidebar__bulk-toolbar background uses color-mix on
 *     --wb-brand (8% alpha) instead of --wb-accent
 *   - .sidebar__bulk-toolbar border uses color-mix on
 *     --wb-brand (24% alpha)
 *   - .sidebar__bulk-btn:focus-visible outline uses --wb-brand
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "..", "sidebar-menus.css"), "utf8");

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

describe("R8.49 .sidebar__bulk-toolbar brand token migration", () => {
  it("background uses color-mix on --wb-brand (8% alpha)", () => {
    const body = ruleBody(css, ".sidebar__bulk-toolbar");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+8%/);
  });

  it("border uses color-mix on --wb-brand (24% alpha)", () => {
    const body = ruleBody(css, ".sidebar__bulk-toolbar");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border:\s*1px solid color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+24%/);
  });
});

describe("R8.49 .sidebar__bulk-btn:focus-visible outline", () => {
  it("uses --wb-brand for the focus outline (was --wb-accent)", () => {
    const body = ruleBody(css, ".sidebar__bulk-btn:focus-visible");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/outline:\s*2px solid var\(--wb-brand,\s*#00c29a\)/);
    expect(body!).not.toMatch(/#5b5fc7|#5b67f1|#6366f1/);
  });
});
