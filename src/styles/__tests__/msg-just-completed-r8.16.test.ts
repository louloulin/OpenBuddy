/**
 * msg-just-completed-r8.16.test.ts — guard spec for the R8.16
 * streaming→complete transition. Pins the keyframes so future
 * refactors can't downgrade the bubble pop-in to an abrupt state swap.
 *
 * Coverage:
 *   - .msg--just-completed triggers the enter keyframe
 *   - keyframe fades opacity 0 → 1 + slides translateY 6px → 0
 *   - duration / easing come from R8.9 motion tokens (so reduced-motion
 *     and the global timing ladder stay coherent)
 *   - prefers-reduced-motion disables the animation
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prose = readFileSync(join(__dirname, "..", "prose.css"), "utf8");

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

function captureKeyframes(css: string, name: string): string | null {
  const start = css.indexOf(`@keyframes ${name}`);
  if (start < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return end > start ? css.slice(start, end) : null;
}

describe("R8.16 .msg--just-completed streaming→complete transition", () => {
  it("wires up the msg-just-completed-enter keyframe animation", () => {
    const body = ruleBody(prose, ".msg--just-completed");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/animation:\s*msg-just-completed-enter/);
    // Duration + easing must come from R8.9 motion tokens so the global
    // timing ladder + reduced-motion suppression stay coherent.
    expect(body!).toMatch(/var\(--wb-motion-duration-base,\s*240ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });

  it("declares a msg-just-completed-enter keyframe that fades + slides", () => {
    const kf = captureKeyframes(prose, "msg-just-completed-enter");
    expect(kf).toBeTruthy();
    // 0% — bubble is invisible + nudged 6px down
    expect(kf!).toMatch(/0%\s*\{[\s\S]*?opacity:\s*0/);
    expect(kf!).toMatch(/0%\s*\{[\s\S]*?translateY\(6px\)/);
    // 100% — fully visible + back to baseline
    expect(kf!).toMatch(/100%\s*\{[\s\S]*?opacity:\s*1/);
    expect(kf!).toMatch(/100%\s*\{[\s\S]*?translateY\(0\)/);
  });

  it("is suppressed under prefers-reduced-motion (R8.9 safety net)", () => {
    // Find the @media (prefers-reduced-motion: reduce) block that
    // contains BOTH `.msg--just-completed` and `animation: none`.
    // This avoids picking up unrelated reduced-motion blocks (e.g.
    // .msg__footer from R8.56) whose regex match would otherwise
    // swallow the .msg--just-completed rule that follows.
    const matches = [
      ...prose.matchAll(
        /@media\s+\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\}/g,
      ),
    ];
    const reduced = matches.find((m) =>
      /\.msg--just-completed/.test(m[0]) && /animation:\s*none/.test(m[0]),
    );
    expect(reduced).toBeTruthy();
    expect(reduced![0]).toMatch(/animation:\s*none/);
  });
});
