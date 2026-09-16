/**
 * msg-user-enter-r8.30.test.ts — guard spec for the R8.30 user
 * message bubble entrance animation.
 *
 * Before R8.30 user messages popped into the transcript with no
 * animation. The new rule applies a subtle fade + slight slide-in
 * (8px → 0) + tiny scale (0.98 → 1) so each user message arrives
 * gracefully, parity with Claude Cowork / ChatGPT.
 *
 * Coverage:
 *   - .msg--user carries a one-shot entrance animation
 *   - keyframes drive opacity, translateX, and scale
 *   - duration / easing route through R8.9 motion tokens
 *   - reduced-motion guard pins the animation to none
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

describe("R8.30 .msg--user entrance animation", () => {
  it("carries a one-shot entrance animation that fires on mount", () => {
    const body = ruleBody(messages, ".msg--user");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/animation:\s*msg-user-enter/);
    // `both` keyword keeps the final state after the animation ends
    expect(body!).toMatch(/animation:[^;]*both/);
  });

  it("uses R8.9 motion duration + easing tokens", () => {
    const body = ruleBody(messages, ".msg--user");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/var\(--wb-motion-duration-base,\s*200ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });
});

describe("R8.30 @keyframes msg-user-enter", () => {
  it("starts at opacity 0 with a slight right-side offset + scale 0.98", () => {
    expect(messages).toMatch(/@keyframes msg-user-enter[\s\S]*?opacity:\s*0/);
    expect(messages).toMatch(/@keyframes msg-user-enter[\s\S]*?translateX\(8px\)/);
    expect(messages).toMatch(/@keyframes msg-user-enter[\s\S]*?scale\(0\.98\)/);
  });

  it("lands at opacity 1 / translateX(0) / scale(1)", () => {
    expect(messages).toMatch(/@keyframes msg-user-enter[\s\S]*?opacity:\s*1/);
    expect(messages).toMatch(/@keyframes msg-user-enter[\s\S]*?translateX\(0\)/);
    expect(messages).toMatch(/@keyframes msg-user-enter[\s\S]*?scale\(1\)/);
  });
});

describe("R8.30 reduced-motion guard", () => {
  it("disables the entrance animation when prefers-reduced-motion is requested", () => {
    // Find the .msg--user rule inside the reduced-motion block.
    const m = messages.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.msg--user\s*\{[\s\S]*?animation:\s*none[\s\S]*?\}[\s\S]*?\}/
    );
    expect(m).toBeTruthy();
  });
});
