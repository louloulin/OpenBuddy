/**
 * msg-avatar-pulse-r8.44.test.ts — guard spec for the assistant
 * avatar's streaming state.
 *
 * R8.44 added a 1.2s box-shadow pulse on the avatar while the
 * assistant message streamed. The R5 visual pass removed it again:
 * the avatar had reverted to a flat border-only chip, so there was no
 * glow left to pulse, and the streaming caret already signals "live".
 *
 * These guards describe the current state: the resting avatar keeps a
 * box-shadow transition, and no `msg-avatar-pulse` keyframes or
 * streaming animation exist anywhere in prose.css.
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

describe("R8.44 pulse removal (R5)", () => {
  it("the streaming avatar carries no pulse animation", () => {
    // R5 removed the pulse outright: with the border-only avatar there is
    // no glow to animate, and the streaming caret plus status indicators
    // already convey "live". Guard the absence so the keyframes do not
    // come back half-wired.
    expect(prose).not.toMatch(/msg-avatar-pulse/);
  });

  it("the reduced-motion guard needs no avatar-pulse entry", () => {
    expect(
      prose.match(/\.msg--assistant\.msg--streaming \.msg__avatar\s*\{[^}]*animation:\s*none/),
    ).toBeNull();
  });
});
