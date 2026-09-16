/**
 * tooltip-button-r8.11.test.ts — guard spec for the R8.11 TooltipButton
 * CSS abstraction (icon-only buttons with hover tooltip). Pins the new
 * selectors and motion-token usage so future refactors can't silently
 * drop the icon-first affordance that unifies message / session actions.
 *
 * Coverage:
 *   - .tt-btn is a 26×26 square with motion-token transitions
 *   - .tt-btn:hover paints a subtle background + darkens text
 *   - .tt-btn:focus-visible paints a brand ring (no default outline)
 *   - .tt-btn:active scales 0.94 for tactile feedback
 *   - .tt-btn--primary fills with brand color
 *   - .tt-btn--danger tints hover red for destructive ops
 *   - .tt-btn::after renders the CSS tooltip with data-tooltip attr
 *   - tooltipSide="top" puts tooltip above; "bottom" puts below
 *   - disabled state hides the tooltip + dims the button
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const stylesDir = join(__dirname, "..");
const allCss = readdirSync(stylesDir)
  .filter((f) => f.endsWith(".css"))
  .map((f) => readFileSync(join(stylesDir, f), "utf8"))
  .join("\n");

const prose = readFileSync(join(stylesDir, "prose.css"), "utf8");

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

describe("R8.11 TooltipButton base (.tt-btn)", () => {
  it("is a 26×26 icon-only button with motion-token transitions", () => {
    const b = ruleBody(prose, ".tt-btn");
    expect(b).toBeTruthy();
    expect(b!).toMatch(/display:\s*inline-flex/);
    expect(b!).toMatch(/min-width:\s*26px/);
    expect(b!).toMatch(/height:\s*26px/);
    expect(b!).toMatch(/border-radius:\s*6px/);
    expect(b!).toMatch(/transition:[^;]*var\(--wb-duration-fast/);
    expect(b!).toMatch(/transition:[^;]*var\(--wb-ease-out-expo/);
  });

  it("hover state paints a subtle background + darkens text", () => {
    const h = ruleBody(prose, ".tt-btn:hover");
    expect(h).toBeTruthy();
    expect(h!).toMatch(/background:[^;]*var\(--wb-bg-hover/);
    expect(h!).toMatch(/color:[^;]*wb-text-strong/);
  });

  it("focus-visible paints a brand ring (no default outline)", () => {
    const f = ruleBody(prose, ".tt-btn:focus-visible");
    expect(f).toBeTruthy();
    expect(f!).toMatch(/outline:\s*none/);
    expect(f!).toMatch(/box-shadow:[^;]*0 0 0 3px/);
  });

  it("active state scales 0.94 for tactile feedback", () => {
    const a = ruleBody(prose, ".tt-btn:active");
    expect(a).toBeTruthy();
    expect(a!).toMatch(/transform:\s*scale\(0\.94\)/);
  });
});

describe("R8.11 TooltipButton variants", () => {
  it("primary variant fills with neutral CTA + fg (R8.60: no brand green)", () => {
    const p = ruleBody(prose, ".tt-btn--primary");
    expect(p).toBeTruthy();
    expect(p!).toMatch(/background:[^;]*--wb-button-primary-bg/);
    expect(p!).toMatch(/color:\s*var\(--wb-button-primary-fg\)/);
    expect(p!.match(/--wb-brand/g)?.length ?? 0).toBe(0);
  });

  it("danger hover variant tints text red", () => {
    const d = ruleBody(prose, ".tt-btn--danger:hover");
    expect(d).toBeTruthy();
    expect(d!).toMatch(/color:[^;]*wb-status-error/);
  });
});

describe("R8.11 CSS tooltip via data-tooltip attribute", () => {
  it("::after pseudo-element reads data-tooltip attribute and is hidden by default", () => {
    const after = ruleBody(prose, ".tt-btn::after");
    expect(after).toBeTruthy();
    expect(after!).toMatch(/content:\s*attr\(data-tooltip\)/);
    expect(after!).toMatch(/opacity:\s*0/);
    expect(after!).toMatch(/pointer-events:\s*none/);
    expect(after!).toMatch(/transition:[^;]*var\(--wb-duration-fast/);
  });

  it("shows on hover and focus-visible (combined selector with comma)", () => {
    // The hover / focus-visible ::after rules share a body via a comma-
    // separated selector list, so we match against the whole CSS rather
    // than ruleBody's exact-prefix match.
    expect(prose).toMatch(/\.tt-btn:hover::after,\s*\n?\s*\.tt-btn:focus-visible::after\s*\{/);
    expect(prose).toMatch(/opacity:\s*1;/);
    expect(prose).toMatch(/transform:\s*translateX\(-50%\)\s*translateY\(0\)\s*scale\(1\)/);
  });

  it("positions above the button by default (top side)", () => {
    const top = ruleBody(prose, ".tt-btn--top::after");
    expect(top).toBeTruthy();
    expect(top!).toMatch(/bottom:\s*calc\(100% \+ 6px\)/);
  });

  it("positions below the button when tooltipSide=bottom", () => {
    const bottom = ruleBody(prose, ".tt-btn--bottom::after");
    expect(bottom).toBeTruthy();
    expect(bottom!).toMatch(/top:\s*calc\(100% \+ 6px\)/);
  });
});

describe("R8.11 disabled state", () => {
  it("dims the button + hides the tooltip so users don't see unavailable actions", () => {
    // .tt-btn:disabled and .tt-btn[aria-disabled="true"] share a body
    // via comma-separated selector list. Match against whole CSS.
    expect(prose).toMatch(/\.tt-btn:disabled,\s*\n?\s*\.tt-btn\[aria-disabled="true"\]\s*\{/);
    expect(prose).toMatch(/opacity:\s*0\.4/);
    expect(prose).toMatch(/cursor:\s*not-allowed/);
    expect(prose).toMatch(/pointer-events:\s*none/);

    // ::after hides when disabled (also comma-separated with aria-disabled).
    expect(prose).toMatch(/\.tt-btn:disabled::after,\s*\n?\s*\.tt-btn\[aria-disabled="true"\]::after\s*\{/);
    expect(prose).toMatch(/display:\s*none/);
  });
});

describe("R8.11 message action buttons upgraded to icon-first", () => {
  it(".msg__action-btn is now 26px square with motion-token transitions", () => {
    const b = ruleBody(prose, ".msg__action-btn");
    expect(b).toBeTruthy();
    expect(b!).toMatch(/display:\s*inline-flex/);
    expect(b!).toMatch(/min-width:\s*26px/);
    expect(b!).toMatch(/height:\s*26px/);
    expect(b!).toMatch(/border-radius:\s*6px/);
    expect(b!).toMatch(/transition:[^;]*var\(--wb-duration-fast/);
  });

  it(".msg__action-btn:hover paints a subtle bg, no longer brand-tinted border", () => {
    const h = ruleBody(prose, ".msg__action-btn:hover");
    expect(h).toBeTruthy();
    expect(h!).toMatch(/background:[^;]*wb-bg-hover/);
    expect(h!).toMatch(/color:[^;]*wb-text-strong/);
  });

  it(".msg__action-btn:active still scales 0.96 (preserved from R7)", () => {
    const a = ruleBody(prose, ".msg__action-btn:active");
    expect(a).toBeTruthy();
    expect(a!).toMatch(/transform:\s*scale\(0\.96\)/);
  });
});
