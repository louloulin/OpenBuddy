/**
 * composer-overflow-r8.13.test.ts — guard spec for the R8.13 composer
 * textarea overflow handling. Pins the JS-set height cap so future
 * refactors can't silently clip user input.
 *
 * Coverage:
 *   - .wb-composer__input has max-height: 160px (matches the JS cap)
 *   - overflow-y: auto lets the user scroll past the cap
 *   - scroll-behavior: smooth gives a polished feel when typing a long prompt
 *   - .wb-composer__send--stop uses font-size: 0 so the lucide Square
 *     icon doesn't inherit a 10px font-size cascade
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const stylesDir = join(__dirname, "..");
const allCss = readdirSync(stylesDir)
  .filter((f) => f.endsWith(".css"))
  .map((f) => readFileSync(join(stylesDir, f), "utf8"))
  .join("\n");

const sidebarMenus = readFileSync(join(stylesDir, "sidebar-menus.css"), "utf8");

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

describe("R8.13 composer textarea overflow polish", () => {
  it("caps the textarea at 160px to match the JS-set height cap", () => {
    const b = ruleBody(sidebarMenus, ".wb-composer__input");
    expect(b).toBeTruthy();
    expect(b!).toMatch(/max-height:\s*160px/);
  });

  it("scrolls past the cap instead of clipping the user's text", () => {
    const b = ruleBody(sidebarMenus, ".wb-composer__input");
    expect(b).toBeTruthy();
    expect(b!).toMatch(/overflow-y:\s*auto/);
    expect(b!).toMatch(/scroll-behavior:\s*smooth/);
  });
});

describe("R8.13 composer stop button icon", () => {
  it("resets font-size on the stop pill so the SVG icon doesn't get cascade-styled", () => {
    const s = ruleBody(sidebarMenus, ".wb-composer__send--stop");
    expect(s).toBeTruthy();
    expect(s!).toMatch(/font-size:\s*0/);
  });
});
