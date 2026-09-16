/**
 * chatview-tool-btn-r8.35.test.ts — guard spec for the R8.35
 * chatview tool-button token migration.
 *
 * Before R8.35 the .chatview__tool-btn rules used dark-theme-only
 * rgba(255, 255, 255, *) fallbacks that leaked into light mode.
 * R8.35 migrates to the canonical --wb-text-medium / --wb-text-strong /
 * --wb-bg-hover tokens so the button is legible regardless of theme,
 * and adds the R8.18 active-scale micro-interaction parity.
 *
 * Coverage:
 *   - .chatview__tool-btn colour no longer has a hardcoded rgba fallback
 *   - hover state uses the canonical --wb-bg-hover token
 *   - active state applies scale(0.94) micro-interaction (R8.18 parity)
 *   - transition uses R8.9 motion tokens (fast + ease-out-expo)
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

describe("R8.35 .chatview__tool-btn base", () => {
  it("uses --wb-text-medium (no hardcoded rgba fallback)", () => {
    const body = ruleBody(messages, ".chatview__tool-btn");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*var\(--wb-text-medium\)/);
    // Make sure no hardcoded rgba is hanging around in the colour line.
    expect(body!).not.toMatch(/color:\s*var\(--wb-text-medium,\s*rgba/);
  });

  it("drives hover transitions through R8.9 motion tokens", () => {
    const body = ruleBody(messages, ".chatview__tool-btn");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transition:[\s\S]*?var\(--wb-motion-duration-fast,\s*120ms\)/);
    expect(body!).toMatch(/var\(--wb-ease-out-expo/);
  });
});

describe("R8.35 .chatview__tool-btn:hover", () => {
  it("uses the canonical --wb-bg-hover token (no dark-only rgba fallback)", () => {
    const body = ruleBody(messages, ".chatview__tool-btn:hover");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*var\(--wb-bg-hover\)/);
    expect(body!).not.toMatch(/background:\s*var\(--wb-bg-hover,\s*rgba/);
    expect(body!).toMatch(/color:\s*var\(--wb-text-strong\)/);
  });
});

describe("R8.35 .chatview__tool-btn:active micro-interaction (R8.18 parity)", () => {
  it("applies transform: scale(0.94) on :active:not(:disabled)", () => {
    const body = ruleBody(
      messages,
      ".chatview__tool-btn:active:not(:disabled)"
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/transform:\s*scale\(0\.94\)/);
  });
});
