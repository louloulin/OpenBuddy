/**
 * streaming-fade-r8.54.test.ts — guard spec for the R8.54
 * streaming bubble bottom fade gradient.
 *
 * Before R8.54, an actively-streaming assistant message showed
 * its full text bubble with no visual hint that more content was
 * coming. R8.54 overlays a 24px linear-gradient at the bottom of
 * the streaming bubble that blends from transparent into the
 * bubble's own background colour, so the last 24px of text
 * visually "dissolves" — a ChatGPT / PI-Desktop pattern that
 * signals "more coming" without distracting from the text above.
 *
 * Coverage:
 *   - .msg--assistant.msg--streaming .msg__bubble is positioned
 *     relatively so the ::after overlay can sit at the bottom
 *   - ::after renders a 24px linear-gradient overlay
 *     from transparent to var(--wb-bg-secondary)
 *   - pointer-events: none so the overlay never blocks text
 *     selection or button clicks
 *   - border-bottom-* corners are inherited so the fade respects
 *     the bubble's rounded tail
 *   - entrance animation uses motion-duration-large + ease-out-expo
 *   - prefers-reduced-motion zeroes the entrance animation
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

describe("R8.54 streaming bubble bottom fade gradient", () => {
  it("sets position: relative on the streaming bubble so the ::after overlay can anchor to the bottom", () => {
    const body = ruleBody(prose, ".msg--assistant.msg--streaming .msg__bubble");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/position:\s*relative/);
  });

  it("::after overlay is 24px tall and spans the full bubble width", () => {
    const body = ruleBody(
      prose,
      ".msg--assistant.msg--streaming .msg__bubble::after",
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/height:\s*24px/);
    expect(body!).toMatch(/left:\s*0/);
    expect(body!).toMatch(/right:\s*0/);
    expect(body!).toMatch(/bottom:\s*0/);
  });

  it("::after uses a linear-gradient that blends transparent into the bubble background", () => {
    const body = ruleBody(
      prose,
      ".msg--assistant.msg--streaming .msg__bubble::after",
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(
      /background:\s*linear-gradient\(\s*to bottom,\s*color-mix\(in srgb,\s*var\(--wb-bg-secondary[\s\S]*?\)\s+0%/,
    );
    expect(body!).toMatch(/var\(--wb-bg-secondary[\s\S]*?\)\s+100%/);
  });

  it("::after is pointer-events: none so it never blocks text selection", () => {
    const body = ruleBody(
      prose,
      ".msg--assistant.msg--streaming .msg__bubble::after",
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/pointer-events:\s*none/);
  });

  it("::after inherits the bubble's bottom border-radius so the fade respects the rounded tail", () => {
    const body = ruleBody(
      prose,
      ".msg--assistant.msg--streaming .msg__bubble::after",
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border-bottom-left-radius:\s*inherit/);
    expect(body!).toMatch(/border-bottom-right-radius:\s*inherit/);
  });

  it("entrance animation uses motion-duration-large + ease-out-expo tokens", () => {
    const body = ruleBody(
      prose,
      ".msg--assistant.msg--streaming .msg__bubble::after",
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/animation:/);
    expect(body!).toMatch(/var\(--wb-motion-duration-large/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
    expect(body!).toMatch(/msg-streaming-fade-in/);
  });

  it("defines the @keyframes msg-streaming-fade-in entrance (opacity 0 → 1)", () => {
    expect(prose).toMatch(/@keyframes\s+msg-streaming-fade-in\s*\{/);
    expect(prose).toMatch(
      /@keyframes\s+msg-streaming-fade-in\s*\{[\s\S]*?from\s*\{[\s\S]*?opacity:\s*0[\s\S]*?to\s*\{[\s\S]*?opacity:\s*1/,
    );
  });

  it("prefers-reduced-motion zeroes the entrance animation", () => {
    const cleaned = stripComments(prose);
    expect(cleaned).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.msg--assistant\.msg--streaming\s+\.msg__bubble::after\s*\{[\s\S]*?animation:\s*none/,
    );
  });
});
