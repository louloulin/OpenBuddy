/**
 * msg-wrap-selected-r8.28.test.ts — guard spec for the R8.28
 * multi-select message highlight.
 *
 * Coverage:
 *   - .msg-wrap--selected uses --wb-status-success (distinct from
 *     --wb-brand used by find-current) so users don't confuse the
 *     two states when searching + selecting simultaneously
 *   - the 3px inset left border + green-tinted background follow
 *     the same pattern as .msg-wrap--find-current for consistency
 *   - the ::before pseudo-element renders a green checkmark badge
 *     so the row reads as "checked" without an external checkbox
 *   - selecting a message that is also a find hit prefers the
 *     green accent (more recent user intent)
 *   - transition uses R8.9 motion tokens
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const messages = readFileSync(join(__dirname, "..", "messages.css"), "utf8");

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

describe("R8.28 .msg-wrap--selected base highlight", () => {
  it("uses --wb-status-success for the 3px inset border (green, distinct from find-current's blue)", () => {
    const body = ruleBody(messages, ".msg-wrap--selected");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--wb-status-success/);
  });

  it("background uses color-mix at 8% alpha (subtler than find-current's 12%)", () => {
    const body = ruleBody(messages, ".msg-wrap--selected");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-status-success[\s\S]*?\)\s+8%/);
  });

  it("drives the background transition through R8.9 motion tokens", () => {
    const body = ruleBody(messages, ".msg-wrap--selected");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/var\(--wb-motion-duration-fast,\s*120ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-standard/);
  });
});

describe("R8.28 .msg-wrap--selected::before checkmark badge", () => {
  it("renders a CSS-only checkmark glyph (no React checkbox UI needed)", () => {
    const body = ruleBody(messages, ".msg-wrap--selected::before");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/content:\s*"\u2713"/);
  });

  it("positions the badge top-left so it doesn't overlap with the message avatar", () => {
    const body = ruleBody(messages, ".msg-wrap--selected::before");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/position:\s*absolute/);
    expect(body!).toMatch(/top:\s*6px/);
    expect(body!).toMatch(/left:\s*-22px/);
  });

  it("uses a green circle background with white text for high contrast", () => {
    const body = ruleBody(messages, ".msg-wrap--selected::before");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*var\(--wb-status-success/);
    expect(body!).toMatch(/color:\s*#fff/);
    expect(body!).toMatch(/border-radius:\s*50%/);
  });
});

describe("R8.28 selected + find overlap resolution", () => {
  it("selected message that's also a find hit prefers the green selected accent", () => {
    // Combined selector with a comma — ruleBody's exact-match lookup
    // can't index it, so we use a regex search instead.
    const idx = messages.search(/\.msg-wrap--selected\.msg-wrap--find-hit[^{]*\{/);
    expect(idx).toBeGreaterThan(-1);
    const body = (() => {
      let depth = 0;
      let start = -1;
      for (let i = idx; i < messages.length; i++) {
        const ch = messages[i];
        if (ch === "{") {
          depth++;
          if (start < 0) start = i + 1;
        } else if (ch === "}") {
          depth--;
          if (depth === 0) return messages.slice(start, i);
        }
      }
      return null;
    })();
    expect(body).toBeTruthy();
    // Border stays green (more recent user intent)
    expect(body!).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--wb-status-success/);
    // Background gets a slight bump to 12% so both intents are visible
    expect(body!).toMatch(/color-mix\(in srgb,\s*var\(--wb-status-success[\s\S]*?\)\s+12%/);
  });
});
