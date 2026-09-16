/**
 * composer-dropzone-neutral-r8.61.test.ts — guard for the chat-input
 * file drop zone overlay. After R8.61 it must NOT use brand colour
 * (per user "颜色不要改成绿色,还是参考这个正常的黑色").
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "..", "sidebar-menus.css"), "utf8");

function ruleBody(input: string, selector: string): string | null {
  const idx = input.indexOf(selector + " {");
  if (idx < 0) return null;
  let depth = 0;
  let start = -1;
  for (let i = idx; i < input.length; i++) {
    const ch = input[i];
    if (ch === "{") { depth++; if (start < 0) start = i + 1; }
    else if (ch === "}") { depth--; if (depth === 0) return input.slice(start, i); }
  }
  return null;
}

describe("R8.61 .wb-composer__dropzone neutral", () => {
  it("background uses neutral text-strong mix, NO brand", () => {
    const body = ruleBody(css, ".wb-composer__dropzone");
    expect(body).toBeTruthy();
    expect(body).toMatch(/var\(--wb-text-strong/);
    expect(body).not.toMatch(/var\(--wb-brand/);
    expect(body).not.toMatch(/#00c29a/i);
  });
  it("border uses --wb-border-default (neutral), NO brand dashed border", () => {
    const body = ruleBody(css, ".wb-composer__dropzone");
    expect(body).toBeTruthy();
    expect(body).toMatch(/border: 2px dashed var\(--wb-border-default\)/);
    expect(body).not.toMatch(/dashed var\(--wb-brand/);
  });
  it("dropzone-text uses --wb-text-strong, NO brand colour", () => {
    const body = ruleBody(css, ".wb-composer__dropzone-text");
    expect(body).toBeTruthy();
    expect(body).toMatch(/color: var\(--wb-text-strong\)/);
    expect(body).not.toMatch(/color: var\(--wb-brand/);
  });
});
