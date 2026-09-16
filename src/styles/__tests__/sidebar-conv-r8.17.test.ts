/**
 * sidebar-conv-r8.17.test.ts — guard spec for the R8.17 sidebar session
 * row visual polish.
 *
 * Coverage:
 *   - .sidebar__conv--active uses brand-tinted bg + 3px left bar
 *   - active title gets brand-tinted color + 500 weight
 *   - .sidebar__conv:focus-visible shows a 2px brand outline
 *   - .sidebar__conv-status-dot is a 6px pulsing brand circle
 *   - @keyframes sidebar-conv-pulse animates the box-shadow halo
 *   - prefers-reduced-motion disables the pulse
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const home = readFileSync(join(__dirname, "..", "home.css"), "utf8");

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

function captureKeyframes(css: string, name: string): string | null {
  const start = css.indexOf(`@keyframes ${name}`);
  if (start < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return end > start ? css.slice(start, end) : null;
}

describe("R8.17 .sidebar__conv--active brand-tinted highlight", () => {
  it("paints a brand-tinted background + 3px left bar accent", () => {
    const body = ruleBody(home, ".sidebar__conv--active");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand/);
    expect(body!).toMatch(/var\(--wb-brand[\s\S]*?\)\s+8%/);
    expect(body!).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--wb-brand/);
  });

  it("brand-tints the title and bumps font-weight to 500", () => {
    const body = ruleBody(home, ".sidebar__conv--active .sidebar__conv-title");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*color-mix\(in srgb,\s*var\(--wb-brand/);
    expect(body!).toMatch(/font-weight:\s*500/);
  });
});

describe("R8.17 .sidebar__conv:focus-visible keyboard outline", () => {
  it("renders a 2px brand-coloured outline for keyboard nav", () => {
    const body = ruleBody(home, ".sidebar__conv:focus-visible");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/outline:\s*2px solid var\(--wb-brand/);
    expect(body!).toMatch(/outline-offset:\s*-2px/);
  });
});

describe("R8.17 .sidebar__conv-status-dot streaming indicator", () => {
  it("is a 6px brand-tinted circle", () => {
    const body = ruleBody(home, ".sidebar__conv-status-dot");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/display:\s*inline-block/);
    expect(body!).toMatch(/width:\s*6px/);
    expect(body!).toMatch(/height:\s*6px/);
    expect(body!).toMatch(/border-radius:\s*50%/);
    expect(body!).toMatch(/background:\s*var\(--wb-brand/);
  });

  it("animates via sidebar-conv-pulse keyframes", () => {
    const body = ruleBody(home, ".sidebar__conv-status-dot");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/animation:\s*sidebar-conv-pulse/);
  });

  it("declares a sidebar-conv-pulse keyframe that grows a box-shadow halo", () => {
    const kf = captureKeyframes(home, "sidebar-conv-pulse");
    expect(kf).toBeTruthy();
    // 50% should grow the box-shadow halo (0 → 4px) to give the impression
    // of a "ping" emanating outward.
    expect(kf!).toMatch(/50%\s*\{[\s\S]*?box-shadow:\s*0 0 0 4px/);
  });

  it("is suppressed under prefers-reduced-motion (R8.9 safety net)", () => {
    const reduced = home.match(
      /@media\s+\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.sidebar__conv-status-dot[\s\S]*?\}/,
    );
    expect(reduced).toBeTruthy();
    expect(reduced![0]).toMatch(/animation:\s*none/);
  });
});
