/**
 * msg-avatar-pulse-r8.44.test.ts — guard spec for the R8.44
 * streaming avatar pulse animation.
 *
 * Before R8.44 the assistant avatar was a static gradient. R8.44
 * adds a subtle pulse glow when the assistant message is
 * actively streaming so the user sees the model is alive without
 * having to look at the caret or status pill. The 1.2s cycle
 * mirrors .chatview__status-dot so the visual language stays
 * consistent.
 *
 * Coverage:
 *   - .msg--assistant.msg--streaming .msg__avatar carries a 1.2s
 *     ease-in-out infinite pulse animation
 *   - the pulse keyframes animate box-shadow between 0px and 4px
 *     brand-tinted halo
 *   - the resting avatar gets a transition on box-shadow so the
 *     stream start/stop feels smooth
 *   - reduced-motion guard disables the pulse
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

describe("R8.44 .msg--assistant .msg__avatar resting transition", () => {
  it("box-shadow transition uses R8.9 motion duration", () => {
    const body = ruleBody(prose, ".msg--assistant .msg__avatar");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transition:\s*box-shadow var\(--wb-motion-duration-base,\s*200ms\)/);
  });
});

describe("R8.44 .msg--assistant.msg--streaming .msg__avatar pulse", () => {
  it("uses the msg-avatar-pulse animation on a 1.2s ease-in-out infinite cycle", () => {
    const body = ruleBody(
      prose,
      ".msg--assistant.msg--streaming .msg__avatar"
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/animation:\s*msg-avatar-pulse\s+1\.2s\s+ease-in-out\s+infinite/);
  });
});

describe("R8.44 @keyframes msg-avatar-pulse", () => {
  it("animates box-shadow from 0px halo to 4px brand-tinted halo", () => {
    // The keyframes use 0 0 0 0 at 0%/100% and 0 0 0 4px at 50%.
    expect(prose).toMatch(/@keyframes msg-avatar-pulse[\s\S]*?0 0 0 0/);
    expect(prose).toMatch(/@keyframes msg-avatar-pulse[\s\S]*?0 0 0 4px/);
  });

  it("brand-tinted halo uses color-mix (18% alpha) at peak", () => {
    expect(prose).toMatch(/@keyframes msg-avatar-pulse[\s\S]*?color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+18%/);
  });
});

describe("R8.44 reduced-motion guard", () => {
  it("disables the pulse when prefers-reduced-motion is set", () => {
    // The reduced-motion block disables the animation. Search for
    // the .msg--assistant.msg--streaming .msg__avatar line.
    const m = prose.match(
      /\.msg--assistant\.msg--streaming \.msg__avatar\s*\{[^}]*animation:\s*none/
    );
    expect(m).toBeTruthy();
  });
});
