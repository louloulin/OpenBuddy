/**
 * sidebar-search-r8.48.test.ts — guard spec for the R8.48 sidebar
 * search input token migration.
 *
 * Before R8.48 the .sidebar__search-input:focus-visible state used
 * the legacy --wb-accent token (cool blue) which clashed with the
 * canonical --wb-brand palette. R8.48 migrates to --wb-brand for
 * visual consistency with the rest of the chat UI.
 *
 * Coverage:
 *   - .sidebar__search-input:focus-visible uses --wb-brand border
 *   - focus shadow uses color-mix on --wb-brand (28% alpha)
 *   - transition routes through R8.9 motion tokens (border-color
 *     + box-shadow)
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

describe("R8.48 .sidebar__search-input base transition", () => {
  it("drives border + box-shadow transitions through R8.9 motion tokens", () => {
    const body = ruleBody(css, ".sidebar__search-input");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transition:[\s\S]*?border-color/);
    expect(body!).toMatch(/transition:[\s\S]*?box-shadow/);
    expect(body!).toMatch(/var\(--wb-motion-duration-fast,\s*120ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });
});

describe("R8.48 .sidebar__search-input:focus-visible brand token migration", () => {
  it("uses --wb-brand for the focus border (was --wb-accent)", () => {
    const body = ruleBody(css, ".sidebar__search-input:focus-visible");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border-color:\s*var\(--wb-brand,\s*#00c29a\)/);
    expect(body!).not.toMatch(/#5b5fc7|#5b67f1|#6366f1/);
    // Ensure the legacy --wb-accent is no longer the focus border.
    expect(body!).not.toMatch(/border-color:\s*var\(--wb-accent/);
  });

  it("focus shadow uses color-mix on --wb-brand (28% alpha)", () => {
    const body = ruleBody(css, ".sidebar__search-input:focus-visible");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/box-shadow:\s*0 0 0 2px color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+28%/);
  });
});
