/**
 * chatview-status-model-r8.20.test.ts — guard spec for the R8.20
 * status-pill model id chip.
 *
 * The chip mirrors PI-Desktop's status pill model badge: a brand-
 * tinted pill that lets the user see which model is producing the
 * answer without opening the model picker.
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

describe("R8.20 .chatview__status-model chip", () => {
  it("renders as an inline-flex pill beside the status text", () => {
    const body = ruleBody(messages, ".chatview__status-model");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/display:\s*inline-flex/);
    expect(body!).toMatch(/align-items:\s*center/);
    expect(body!).toMatch(/margin-left:\s*6px/);
    expect(body!).toMatch(/padding:\s*1px 6px/);
    expect(body!).toMatch(/border-radius:\s*8px/);
  });

  it("brand-tints the chip so the model name reads as a tag", () => {
    const body = ruleBody(messages, ".chatview__status-model");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/color-mix\(in srgb,\s*var\(--wb-brand/);
    expect(body!).toMatch(/background/);
    expect(body!).toMatch(/color/);
  });

  it("truncates long model ids with ellipsis (max-width cap)", () => {
    const body = ruleBody(messages, ".chatview__status-model");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/max-width:\s*220px/);
    expect(body!).toMatch(/overflow:\s*hidden/);
    expect(body!).toMatch(/text-overflow:\s*ellipsis/);
    expect(body!).toMatch(/white-space:\s*nowrap/);
  });

  it("disables text selection so the chip doesn't fight the status pill", () => {
    const body = ruleBody(messages, ".chatview__status-model");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/user-select:\s*none/);
  });
});
