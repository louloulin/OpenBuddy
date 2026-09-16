/**
 * msg-footer-motion-r8.56.test.ts — guard spec for the R8.56
 * .msg__footer motion-token migration.
 *
 * Before R8.56 the .msg__footer used the legacy `transition: opacity
 * 0.15s ease` shorthand, which doesn't share its timing with the
 * R8.9 motion tokens used everywhere else in the chat UI. R8.56
 * swaps it for the canonical motion-duration-fast + ease-out-expo
 * tokens so the footer reveal stays coherent with the rest of the
 * surface family.
 *
 * Coverage:
 *   - transition uses --wb-motion-duration-fast + --wb-ease-out-expo
 *   - the legacy 0.15s ease shorthand is gone (comment-stripped check)
 *   - opacity baseline at 0.55 + 1 on hover preserved
 *   - prefers-reduced-motion zeroes the transition
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prose = readFileSync(join(__dirname, "..", "prose.css"), "utf8");

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

function stripComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, "");
}

function findBody(input: string, selector: string): string | null {
  // Comma-separated selectors (e.g. ".a,\n.b {") — find the
  // first occurrence of the selector, then brace-balance from the
  // next `\n` to find the opening `{`.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped + "[\\s\\S]*?\\{");
  const idx = input.search(re);
  if (idx < 0) return null;
  const openBrace = input.indexOf("{", idx);
  if (openBrace < 0) return null;
  let depth = 0;
  let start = openBrace + 1;
  for (let i = openBrace; i < input.length; i++) {
    const ch = input[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return input.slice(start, i);
    }
  }
  return null;
}

describe("R8.56 .msg__footer motion-token migration", () => {
  it("transition uses --wb-motion-duration-fast + --wb-ease-out-expo", () => {
    const body = ruleBody(prose, ".msg__footer");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transition:\s*opacity\s+var\(--wb-motion-duration-fast/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });

  it("no longer uses the legacy 0.15s ease shorthand", () => {
    const cleaned = stripComments(prose);
    const body = ruleBody(cleaned, ".msg__footer");
    expect(body).toBeTruthy();
    expect(body!).not.toMatch(/transition:\s*opacity\s+0\.15s/);
    expect(body!).not.toMatch(/transition:\s*opacity\s+0\.15s\s+ease/);
  });

  it("preserves the opacity baseline at 0.55 + reveal at 1 on hover", () => {
    const body = ruleBody(prose, ".msg__footer");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/opacity:\s*0\.55/);
    // hover and focus-within are combined into one block.
    const hoverBody = findBody(
      prose,
      ".msg:hover .msg__footer,\n.msg__footer:focus-within",
    );
    expect(hoverBody).toBeTruthy();
    expect(hoverBody!).toMatch(/opacity:\s*1/);
  });

  it("preserves the focus-within reveal at opacity 1", () => {
    const body = ruleBody(prose, ".msg__footer:focus-within");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/opacity:\s*1/);
  });

  it("prefers-reduced-motion zeroes the transition", () => {
    const cleaned = stripComments(prose);
    expect(cleaned).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.msg__footer\s*\{[\s\S]*?transition:\s*none/,
    );
  });
});
