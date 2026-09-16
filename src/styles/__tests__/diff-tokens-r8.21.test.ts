/**
 * diff-tokens-r8.21.test.ts — guard spec for the R8.21 diff view colour
 * token migration. Pins the contract that the diff add/del tints come
 * from the brand-aware status tokens (not hardcoded GitHub hex) so dark
 * theme can override them without per-theme overrides.
 *
 * Coverage:
 *   - .diff__add / .diff__del exist as new selectors (R8.21 introduced)
 *   - colour + background route through --wb-status-success / --wb-status-error
 *   - .diff__line--add / .diff__line--del use color-mix at 10% alpha
 *   - prefix colours also use the same tokens
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const messages = readFileSync(join(__dirname, "..", "messages.css"), "utf8");

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

describe("R8.21 .diff__add / .diff__del token migration", () => {
  it("defines a .diff__add selector with --wb-status-success colour", () => {
    const body = ruleBody(messages, ".diff__add");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*var\(--wb-status-success/);
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-status-success[\s\S]*?\)\s+10%/);
  });

  it("defines a .diff__del selector with --wb-status-error colour", () => {
    const body = ruleBody(messages, ".diff__del");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*var\(--wb-status-error/);
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-status-error[\s\S]*?\)\s+10%/);
  });

  it("preserves the GitHub hex defaults as fallback so theme-less builds still work", () => {
    const add = ruleBody(messages, ".diff__add");
    expect(add).toBeTruthy();
    expect(add!).toMatch(/#1a7f37/);
    const del = ruleBody(messages, ".diff__del");
    expect(del).toBeTruthy();
    expect(del!).toMatch(/#cf222e/);
  });
});

describe("R8.21 .diff__line--add / --del background token migration", () => {
  it("line backgrounds use color-mix on --wb-status-success", () => {
    const body = ruleBody(messages, ".diff__line--add");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-status-success[\s\S]*?\)\s+10%/);
  });

  it("line backgrounds use color-mix on --wb-status-error", () => {
    const body = ruleBody(messages, ".diff__line--del");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-status-error[\s\S]*?\)\s+10%/);
  });
});

describe("R8.21 .diff__stats-add / --del token migration", () => {
  it("stats add counter uses --wb-status-success", () => {
    const body = ruleBody(messages, ".diff__stats-add");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*var\(--wb-status-success/);
    expect(body!).toMatch(/font-weight:\s*600/);
  });

  it("stats del counter uses --wb-status-error", () => {
    const body = ruleBody(messages, ".diff__stats-del");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*var\(--wb-status-error/);
    expect(body!).toMatch(/font-weight:\s*600/);
  });
});

describe("R8.21 .diff__line--add/--del prefix colour migration", () => {
  it("add prefix uses --wb-status-success", () => {
    const body = ruleBody(messages, ".diff__line--add .diff__line-prefix");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*var\(--wb-status-success/);
  });

  it("del prefix uses --wb-status-error", () => {
    const body = ruleBody(messages, ".diff__line--del .diff__line-prefix");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*var\(--wb-status-error/);
  });
});
