/**
 * motion-r8.9.test.ts — guard spec for the R8.9 animation polish.
 *
 * Pins the new motion token additions and the conversion of magic-number
 * animation durations to tokens, plus the prefers-reduced-motion safety
 * net. This makes it impossible for future refactors to silently re-introduce
 * hard-coded 120ms / 140ms / 160ms / 180ms / 240ms values, or to ship a UI
 * that ignores the OS-level "reduce motion" accessibility setting.
 *
 * Coverage:
 *   - tokens.css defines the new R8.9 motion durations (pop / md / large)
 *   - tokens.css overrides all motion durations to 0ms in reduced motion
 *   - base.css installs a global prefers-reduced-motion safety net
 *   - the 9 previously magic-numbered animation declarations now use tokens
 *   - the additional "140ms"/"120ms" + token-ease declarations also use
 *     motion-duration tokens (chrome/composer/messages/misc)
 *   - short-second entrance animations (0.12s/0.14s/0.15s/0.18s/0.2s/0.45s)
 *     are also tokenised; only infinite pulses keep their cadence literals
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const stylesDir = join(__dirname, "..");
const allCss = readdirSync(stylesDir)
  .filter((f) => f.endsWith(".css"))
  .map((f) => readFileSync(join(stylesDir, f), "utf8"))
  .join("\n");

const tokens = readFileSync(join(stylesDir, "tokens.css"), "utf8");
const base = readFileSync(join(stylesDir, "base.css"), "utf8");

describe("R8.9 motion tokens (tokens.css)", () => {
  it("defines the original scale (fast/sm/base/slow) plus new R8.9 additions (pop/md/large)", () => {
    expect(tokens).toMatch(/--wb-motion-duration-fast:\s*120ms/);
    expect(tokens).toMatch(/--wb-motion-duration-sm:\s*150ms/);
    expect(tokens).toMatch(/--wb-motion-duration-base:\s*200ms/);
    expect(tokens).toMatch(/--wb-motion-duration-slow:\s*320ms/);
    // R8.9 additions
    expect(tokens).toMatch(/--wb-motion-duration-pop:\s*160ms/);
    expect(tokens).toMatch(/--wb-motion-duration-md:\s*180ms/);
    expect(tokens).toMatch(/--wb-motion-duration-large:\s*240ms/);
  });

  it("overrides every motion-duration token to 0ms under prefers-reduced-motion", () => {
    // Locate the @media reduced-motion block in tokens.css. The block
    // contains a nested :root { ... } (so we can't match a single pair of
    // braces); instead slice from "@media (prefers-reduced-motion: reduce)"
    // to the next standalone closing brace at the top level.
    const idx = tokens.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(idx).toBeGreaterThanOrEqual(0);
    const slice = tokens.slice(idx);
    // Capture until the first "}" at indent 0 (top-level block close).
    const closeIdx = slice.search(/^\}/m);
    expect(closeIdx).toBeGreaterThan(0);
    const block = slice.slice(0, closeIdx + 1);
    expect(block).toMatch(/--wb-motion-duration-fast:\s*0ms/);
    expect(block).toMatch(/--wb-motion-duration-pop:\s*0ms/);
    expect(block).toMatch(/--wb-motion-duration-sm:\s*0ms/);
    expect(block).toMatch(/--wb-motion-duration-md:\s*0ms/);
    expect(block).toMatch(/--wb-motion-duration-base:\s*0ms/);
    expect(block).toMatch(/--wb-motion-duration-large:\s*0ms/);
    expect(block).toMatch(/--wb-motion-duration-slow:\s*0ms/);
  });

  it("exposes both material easings (standard + emphasized) so components stop inlining cubic-beziers", () => {
    expect(tokens).toMatch(/--wb-motion-easing-standard:\s*cubic-bezier/);
    expect(tokens).toMatch(/--wb-motion-easing-emphasized:\s*cubic-bezier/);
  });
});

describe("R8.9 base.css prefers-reduced-motion safety net", () => {
  it("installs a global @media (prefers-reduced-motion: reduce) rule that neutralises animation + transition", () => {
    expect(base).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    const block = base.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]+?)\n\}/,
    );
    expect(block).toBeTruthy();
    const body = block![1];
    // Must hit universal selector so infinite pulses get caught
    expect(body).toMatch(/\*\s*,\s*\*::before\s*,\s*\*::after/);
    // Three properties must be neutered
    expect(body).toMatch(/animation-duration:[^;]*!important/);
    expect(body).toMatch(/animation-iteration-count:[^;]*!important/);
    expect(body).toMatch(/transition-duration:[^;]*!important/);
  });
});

describe("R8.9 magic-number animation conversion (originally-listed 9 sites)", () => {
  // Each entry: [file, expected substr, forbidden substr]
  const cases: Array<[string, string, string]> = [
    ["messages.css",   "msg-edit-enter var(--wb-motion-duration-fast, 120ms)",          "msg-edit-enter 120ms "],
    ["modals.css",     "wb-request-overlay-in var(--wb-motion-duration-md, 180ms)",     "wb-request-overlay-in 180ms "],
    ["modals.css",     "wb-request-modal-in var(--wb-motion-duration-large, 240ms)",   "wb-request-modal-in 240ms "],
    ["settings.css",   "wb-modal-overlay-in var(--wb-motion-duration-pop, 160ms)",     "wb-modal-overlay-in 160ms "],
    ["settings.css",   "wb-modal-card-in var(--wb-motion-duration-md, 180ms)",         "wb-modal-card-in 180ms "],
    ["tool-call.css",  "toolcall-enter var(--wb-motion-duration-fast, 140ms)",         "toolcall-enter 140ms "],
    ["chrome.css",     "ob-scale-in var(--wb-motion-duration-fast, 140ms)",             "ob-scale-in 140ms "],
    ["composer.css",   "ob-slash-menu-in var(--wb-motion-duration-fast, 140ms)",       "ob-slash-menu-in 140ms "],
    ["messages.css",   "ob-findbar-in var(--wb-motion-duration-fast, 120ms)",          "ob-findbar-in 120ms "],
    ["messages.css",   "ob-rewind-dropdown-in var(--wb-motion-duration-fast, 140ms)", "ob-rewind-dropdown-in 140ms "],
    ["misc.css",       "ob-mention-picker-in var(--wb-motion-duration-fast, 140ms)",   "ob-mention-picker-in 140ms "],
  ];
  for (const [file, expected, forbidden] of cases) {
    it(`${file} uses motion token (e.g. "${expected.slice(0, 40)}…")`, () => {
      const css = readFileSync(join(stylesDir, file), "utf8");
      expect(css).toContain(expected);
      expect(css).not.toContain(forbidden);
    });
  }
});

describe("R8.9 short-second entrance animation conversion (~13 sites)", () => {
  const cases: Array<[string, string, string]> = [
    ["automation.css",     "sidebarMoreFadeIn var(--wb-motion-duration-fast, 140ms)",  "sidebarMoreFadeIn 0.14s "],
    ["chat-shell.css",     "topbar-actions__fade-in var(--wb-motion-duration-fast, 120ms)", "topbar-actions__fade-in 0.12s "],
    ["home.css",           "taskFilterFadeIn var(--wb-motion-duration-fast, 140ms)",  "taskFilterFadeIn 0.14s "],
    ["home.css",           "settings-fade-in var(--wb-motion-duration-fast, 120ms)",  "settings-fade-in 0.12s "],
    ["home.css",           "settings-slide-up var(--wb-motion-duration-md, 180ms)",   "settings-slide-up 0.18s "],
    ["settings.css",       "settings-fade-in var(--wb-motion-duration-sm, 150ms)",    "settings-fade-in 0.15s "],
    ["settings.css",       "settings-slide-up var(--wb-motion-duration-base, 200ms)", "settings-slide-up 0.2s "],
    ["sidebar-menus.css",  "iam-fadeIn var(--wb-motion-duration-sm, 150ms)",          "iam-fadeIn .15s "],
    ["sidebar-menus.css",  "iam-fadeIn var(--wb-motion-duration-fast, 120ms)",        "iam-fadeIn .12s "],
    ["sidebar-menus.css",  "permissionPickerFadeIn var(--wb-motion-duration-fast, 140ms)", "permissionPickerFadeIn 0.14s "],
    ["prose.css",          "ob-tip-fade-in var(--wb-motion-duration-slow, 450ms)",    "ob-tip-fade-in 0.45s "],
  ];
  for (const [file, expected, forbidden] of cases) {
    it(`${file} uses motion token (e.g. "${expected.slice(0, 40)}…")`, () => {
      const css = readFileSync(join(stylesDir, file), "utf8");
      expect(css).toContain(expected);
      expect(css).not.toContain(forbidden);
    });
  }
});

describe("R8.9 modals.css request-modal-in conversion covers all 4 occurrences", () => {
  it("each of the 4 .request-modal selectors references the new token", () => {
    const css = readFileSync(join(stylesDir, "modals.css"), "utf8");
    const matches = css.match(
      /animation:\s*wb-request-modal-in\s+var\(--wb-motion-duration-large/g,
    );
    expect(matches?.length ?? 0).toBe(4);
  });
});

describe("R8.9 zero remaining non-infinite magic-number animation durations in src/styles", () => {
  it("every non-infinite animation: declaration outside @keyframes uses a token", () => {
    const lines = allCss.split("\n");
    const offenders: string[] = [];
    for (const line of lines) {
      if (line.includes("@keyframes")) continue;
      if (!/\banimation:/.test(line)) continue;
      if (/var\(--wb-(motion-duration|duration)/.test(line)) continue;
      // OK: pure "animation: none".
      if (/animation:\s*none/i.test(line)) continue;
      // OK: infinite pulses keep their intended cadence (1s, 1.2s, 1.5s
      // etc.). The base.css prefers-reduced-motion safety net neuters
      // them via animation-duration: 0.001ms, so a11y is still respected.
      if (/\binfinite\b/.test(line)) continue;
      // Anything still here is a one-shot entrance / fade-in that should
      // have been tokenised but slipped through.
      if (/\b[0-9]+(\.[0-9]+)?(ms|s)\b/.test(line)) {
        offenders.push(line.trim());
      }
    }
    expect(offenders).toEqual([]);
  });
});
