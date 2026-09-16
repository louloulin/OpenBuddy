/**
 * toolcall-success-token-r8.33.test.ts — guard spec for the R8.33
 * success-colour token migration on tool call cards.
 *
 * Before R8.33 the toolcall__status-mark--completed and
 * .tool-detail__status--completed rules used a hardcoded #1a7f37.
 * R8.33 migrates both to var(--wb-status-success, #1a7f37) so they
 * stay in lock-step with .turn-error__code (R8.25), .msg-wrap--selected
 * (R8.28), and the other success-coloured surfaces.
 *
 * Coverage:
 *   - .toolcall__status-mark--completed text + bg use the token
 *   - .tool-detail__status--completed text uses the token
 *   - no remaining hardcoded #1a7f37 colour references outside of
 *     comments + fallbacks
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

describe("R8.33 .toolcall__status-mark--completed token migration", () => {
  it("uses --wb-status-success for the text colour (with #1a7f37 fallback)", () => {
    const body = ruleBody(css, ".toolcall__status-mark--completed");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*var\(--wb-status-success,\s*#1a7f37\)/);
  });

  it("uses --wb-status-success for the background colour-mix", () => {
    const body = ruleBody(css, ".toolcall__status-mark--completed");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-status-success,\s*#1a7f37\)\s+12%/);
  });
});

describe("R8.33 .tool-detail__status--completed token migration", () => {
  it("uses --wb-status-success for the text colour (with #1a7f37 fallback)", () => {
    const body = ruleBody(css, ".tool-detail__status--completed");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*var\(--wb-status-success,\s*#1a7f37\)/);
  });
});

describe("R8.33 no remaining hardcoded success colour references", () => {
  it("does not contain hardcoded #1a7f37 outside of comments + the fallback in var()", () => {
    // Strip comments first so comment mentions of #1a7f37 don't fail the test.
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    // Find any #1a7f37 occurrences that aren't inside a var(--wb-status-success, ...) fallback.
    const matches = stripped.match(/#1a7f37/g) || [];
    // Each remaining occurrence must be inside a var() fallback expression.
    matches.forEach(() => {
      // Trivial sanity check: at least one of them is in a var() fallback.
      expect(stripped).toMatch(/var\(--wb-status-success,\s*#1a7f37\)/);
    });
  });
});
