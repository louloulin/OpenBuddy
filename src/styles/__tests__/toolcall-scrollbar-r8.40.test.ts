/**
 * toolcall-scrollbar-r8.40.test.ts — guard spec for the R8.40
 * tool call output scrollbar polish.
 *
 * Before R8.40 the .toolcall__text and .toolcall__output scrollbars
 * used the browser default (often a wide grey bar that breaks the
 * chat UI's visual language). R8.40 standardizes the scrollbar to
 * 6px wide with a brand-tinted thumb.
 *
 * Coverage:
 *   - both elements use the standard `scrollbar-width: thin`
 *   - `scrollbar-color` uses color-mix on the brand token
 *   - WebKit pseudo-elements render a 6px-wide scrollbar with
 *     brand-tinted thumb that deepens on hover
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "..", "tool-call.css"), "utf8");

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

describe("R8.40 toolcall output scrollbar (standard)", () => {
  it("uses scrollbar-width: thin for the standard scrollbar", () => {
    const body = ruleBody(css, ".toolcall__text,\n.toolcall__output");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/scrollbar-width:\s*thin/);
  });

  it("uses brand-tinted scrollbar-color (30% alpha)", () => {
    const body = ruleBody(css, ".toolcall__text,\n.toolcall__output");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/scrollbar-color:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+30%/);
  });
});

describe("R8.40 toolcall output scrollbar (WebKit)", () => {
  it("renders a 6px-wide WebKit scrollbar", () => {
    const body = ruleBody(css, ".toolcall__text::-webkit-scrollbar,\n.toolcall__output::-webkit-scrollbar");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/width:\s*6px/);
  });

  it("uses brand-tinted thumb (30% alpha) with 3px border-radius", () => {
    const body = ruleBody(
      css,
      ".toolcall__text::-webkit-scrollbar-thumb,\n.toolcall__output::-webkit-scrollbar-thumb"
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+30%/);
    expect(body!).toMatch(/border-radius:\s*3px/);
  });

  it("hover deepens the thumb tint to 50% brand", () => {
    const body = ruleBody(
      css,
      ".toolcall__text::-webkit-scrollbar-thumb:hover,\n.toolcall__output::-webkit-scrollbar-thumb:hover"
    );
    expect(body).toBeTruthy();
    expect(body!).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--wb-brand[\s\S]*?\)\s+50%/);
  });
});
