/**
 * css-modularisation-r8.4.test.ts — guard spec for R8.4 (CSS modular split).
 *
 * Why this exists:
 *   - Before R8.4, `src/styles/app.css` was a 15,633-line / 477 KB monolith
 *     that was *never imported*. Every CSS file in `src/styles/` lives
 *     behind `globals.css`, which is what `main.tsx` actually loads.
 *     `app.css` showed up in `git grep "import.*app.css"` only in comments.
 *   - That meant: any selector that lived only in `app.css` (notably the
 *     R8.2 toolcall polish I added in the previous turn — `.toolcall--ok`,
 *     `.toolcall--compact`, `.toolcall:focus-visible`, `.toolcall__duration`,
 *     plus the enter animation + nth-child stagger) was completely inert.
 *     The CSS existed, the components emitted the right classes, and
 *     nothing rendered.
 *
 * This spec pins the migration so future refactors can't quietly drop the
 * selectors back into a dead file (or worse, recreate the monolith).
 *
 * Coverage:
 *   - shell.css exists and contains the app-shell selectors that used to
 *     live in app.css (.app, .app__body, .main-topbar, .main-topbar__title)
 *   - tool-call.css contains all four R8.2 selectors + the @keyframes
 *     toolcall-enter block (without it, the .toolcall animation: line
 *     references an undefined keyframe and the row silently fails to
 *     animate)
 *   - app.css no longer exists (we deleted it as part of R8.4)
 *   - globals.css imports shell.css before sidebar.css
 *   - globals.css imports tool-call.css (already true pre-R8.4)
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const stylesDir = join(__dirname, "..");

describe("R8.4 CSS modularisation", () => {
  it("removes the dead app.css monolith", () => {
    expect(existsSync(join(stylesDir, "app.css"))).toBe(false);
  });

  it("shell.css contains the app-shell selectors", () => {
    const css = readFileSync(join(stylesDir, "shell.css"), "utf8");
    for (const sel of [
      ".app",
      ".app__body",
      ".main-topbar",
      ".main-topbar__title",
      ".main-topbar__btn",
      ".main-topbar__title-input",
      ".expert-badge",
    ]) {
      expect(css, `${sel} should be in shell.css`).toContain(sel);
    }
  });

  it("tool-call.css contains the R8.2 polish selectors", () => {
    const css = readFileSync(join(stylesDir, "tool-call.css"), "utf8");
    for (const sel of [
      ".toolcall--ok",
      ".toolcall--compact",
      ".toolcall:focus-visible",
      ".toolcall__duration",
      ".toolcall--err .toolcall__duration",
      ".toolcall--ok .toolcall__duration",
    ]) {
      expect(css, `${sel} should be in tool-call.css`).toContain(sel);
    }
  });

  it("tool-call.css defines the toolcall-enter keyframe referenced by the animation line", () => {
    const css = readFileSync(join(stylesDir, "tool-call.css"), "utf8");
    expect(css).toMatch(/@keyframes\s+toolcall-enter\b/);
  });

  it("tool-call.css includes the staggered nth-child enter delays", () => {
    const css = readFileSync(join(stylesDir, "tool-call.css"), "utf8");
    expect(css).toMatch(/\.msg\s+\.toolcall:nth-child\(1\)/);
    expect(css).toMatch(/\.msg\s+\.toolcall:nth-child\(2\)/);
    expect(css).toMatch(/\.msg\s+\.toolcall:nth-child\(3\)/);
  });

  it("globals.css imports shell.css before sidebar.css (shell is foundational)", () => {
    const css = readFileSync(join(stylesDir, "globals.css"), "utf8");
    const shellIdx = css.indexOf('@import "./shell.css"');
    const sidebarIdx = css.indexOf('@import "./sidebar.css"');
    expect(shellIdx, "shell.css should be imported").toBeGreaterThan(-1);
    expect(sidebarIdx, "sidebar.css should be imported").toBeGreaterThan(-1);
    expect(shellIdx, "shell.css must come before sidebar.css").toBeLessThan(sidebarIdx);
  });

  it("globals.css imports tool-call.css", () => {
    const css = readFileSync(join(stylesDir, "globals.css"), "utf8");
    expect(css).toMatch(/@import\s+"\.\/tool-call\.css"/);
  });
});
