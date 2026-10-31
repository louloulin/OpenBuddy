/**
 * selectionColor — 文本选区契约（plan1030 批 5a / §0.6）。
 *
 * 背景：2026-10-30 审计发现全仓 CSS 零 `::selection` 定义，浏览器默认
 * 蓝色选区与品牌体系脱节。修复后必须锁定：
 *   1. tokens.css 亮色块定义 --wb-selection-bg/--wb-selection-fg
 *   2. tokens.css 暗色块（[data-theme=dark] 等）重新定义（暗底需更高品牌占比）
 *   3. base.css 存在 ::selection 规则且使用 token
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesDir = join(import.meta.dirname, "..");
const tokens = readFileSync(join(stylesDir, "tokens.css"), "utf8");
const base = readFileSync(join(stylesDir, "base.css"), "utf8");

/** 取某选择器块内的文本（简单花括号配平）。 */
function block(input: string, anchor: RegExp): string | null {
  const m = input.match(anchor);
  if (!m || m.index === undefined) return null;
  const start = m.index + m[0].length;
  let depth = 1;
  for (let i = start; i < input.length; i++) {
    if (input[i] === "{") depth++;
    else if (input[i] === "}") {
      depth--;
      if (depth === 0) return input.slice(start, i);
    }
  }
  return null;
}

describe("视觉契约 — ::selection 选区色", () => {
  it("亮色主题定义了 --wb-selection-bg/--wb-selection-fg", () => {
    const light = block(tokens, /:root[^\{]*\{/);
    expect(light).toContain("--wb-selection-bg:");
    expect(light).toContain("--wb-selection-fg:");
  });

  it("暗色主题重新定义了选区色（暗底需更高品牌占比）", () => {
    const dark = block(tokens, /\[data-theme=dark\][^\{]*\{/);
    expect(dark).toContain("--wb-selection-bg:");
    expect(dark).toMatch(/--wb-selection-bg:[^;]*2[0-9]%|--wb-selection-bg:[^;]*3[0-9]%|--wb-selection-bg:[^;]*4[0-9]%|--wb-selection-bg:[^;]*5[0-9]%/);
  });

  it("base.css 的 ::selection 走 token（禁止裸色值回归）", () => {
    const sel = block(base, /::selection\s*\{/);
    expect(sel).toBeTruthy();
    expect(sel).toMatch(/background:\s*var\(--wb-selection-bg/);
    expect(sel).toMatch(/color:\s*var\(--wb-selection-fg/);
  });
});
