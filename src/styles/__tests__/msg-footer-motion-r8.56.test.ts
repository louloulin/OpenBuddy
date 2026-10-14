/**
 * msg-footer-motion-r8.56.test.ts — guard spec for the .msg__footer
 * motion tokens + reveal semantics.
 *
 * 契约演进:
 *   - R8.56: 常驻 0.55 + hover 提升到 1(motion token 迁移)。
 *   - 2026-10-13 Claude Desktop 对齐(REA 实测 2.31226.1 的
 *     --cds-message-actions-opacity 0 → 1):操作栏**默认完全隐藏**,
 *     hover / focus-within 浮现;触摸设备(无 hover)常驻,否则操作永远点不到。
 *
 * Coverage:
 *   - 默认 opacity 0 + motion token 过渡(不回退到 legacy 0.15s ease)
 *   - hover / focus-within 浮现到 1
 *   - touch(hover: none)常驻
 *   - prefers-reduced-motion 关过渡
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

describe(".msg__footer motion + reveal semantics(Claude 对齐)", () => {
  it("默认隐藏(opacity 0),过渡仍走 motion token", () => {
    const body = ruleBody(prose, ".msg__footer");
    expect(body).toBeTruthy();
    expect(body!).toMatch(/opacity:\s*0/);
    expect(body!).toMatch(/transition:\s*opacity\s+var\(--wb-motion-duration-fast/);
  });

  it("不再使用 legacy 0.15s ease 简写(注释剥离后检查)", () => {
    const cleaned = stripComments(prose);
    const body = ruleBody(cleaned, ".msg__footer");
    expect(body).toBeTruthy();
    expect(body!).not.toMatch(/transition:\s*opacity\s+0\.15s/);
  });

  it("hover / focus-within 浮现到 opacity 1", () => {
    const cleaned = stripComments(prose);
    const hover = cleaned.match(/\.msg:hover \.msg__footer[\s\S]*?\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(hover).toMatch(/opacity:\s*1/);
    // focus-within 是独立可达路径(键盘用户不丢操作栏)
    expect(cleaned).toMatch(/\.msg__footer:focus-within/);
    expect(cleaned).toMatch(/\.msg:focus-within \.msg__footer/);
  });

  it("触摸设备(hover: none)常驻显示", () => {
    const cleaned = stripComments(prose);
    const touch = cleaned.match(/@media \(hover: none\)\s*\{[\s\S]*?\.msg__footer\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(touch).toMatch(/opacity:\s*1/);
  });

  it("prefers-reduced-motion 关闭过渡", () => {
    const cleaned = stripComments(prose);
    expect(cleaned).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.msg__footer\s*\{[\s\S]*?transition:\s*none/,
    );
  });
});
