/**
 * chatview-status-streaming-r8.34.test.ts — guard spec for the R8.34
 * chatview status pill streaming visual treatment.
 *
 * Before R8.34 the .chatview__status--streaming state was visually
 * identical to the completed state except for a pulsing dot. R8.34
 * adds a subtle brand-tinted background so the user immediately
 * knows the session is actively streaming.
 *
 * Coverage:
 *   - .chatview__status--streaming gets a brand-tinted background
 *     (8% alpha) so the pill reads as "active"
 *   - the dot itself bumps to solid brand colour
 *   - the border picks up a brand tint so the pill feels like a
 *     coherent "live" state
 *   - text colour shifts to brand-tinted for the streaming label
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

describe("R8.34 .chatview__status--streaming pill background", () => {
  it("uses a brand-tinted background (8% alpha) so the pill reads as active", () => {
    const body = ruleBody(messages, ".chatview__status--streaming");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+8%/);
  });

  it("border picks up a brand tint (20% alpha)", () => {
    const body = ruleBody(messages, ".chatview__status--streaming");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/border-color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+20%/);
  });

  it("text colour shifts to brand-tinted (80% brand + 15% strong) so the label reads as live", () => {
    const body = ruleBody(messages, ".chatview__status--streaming");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+80%/);
  });
});

describe("R8.34 .chatview__status--streaming .chatview__status-dot", () => {
  it("bumps to solid brand colour (was a 70% mix before)", () => {
    const body = ruleBody(
      messages,
      ".chatview__status--streaming .chatview__status-dot"
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*var\(--wb-brand,\s*#00c29a\)/);
    expect(body!).not.toMatch(/#5b5fc7|#5b67f1|#6366f1/);
  });

  it("keeps the existing pulse animation (1.2s ease-in-out infinite)", () => {
    const body = ruleBody(
      messages,
      ".chatview__status--streaming .chatview__status-dot"
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/animation:\s*chatview__status-pulse\s+1\.2s\s+ease-in-out\s+infinite/);
  });
});
