/**
 * Composer-placeholder — P3-08 P0-AI-Chat-Audit 完善轮护栏。
 *
 * 守住的不变量:
 *   - 默认 placeholder 中文部分 ≤ 14 字(Codex 范式:一行)
 *   - placeholder 包含至少一个 hint 字符(@ / /、⏎)
 *   - 无 apiReady 时 fallback 文案 ≤ 14 字
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const composerSrc = readFileSync(
  join(__dirname, "..", "Composer.tsx"),
  "utf8",
);

function extractPlaceholders(): { defaultText: string; fallbackText: string } {
  const defaultMatch = composerSrc.match(
    /placeholder\s*\?\?\s*"([^"]+)"/,
  );
  const fallbackMatch = composerSrc.match(
    /apiReady\s*\?\s*[\s\S]*?:\s*"([^"]+)"/,
  );
  return {
    defaultText: defaultMatch?.[1] ?? "",
    fallbackText: fallbackMatch?.[1] ?? "",
  };
}

describe("P3-08 Composer placeholder (Codex 范式)", () => {
  it("默认 placeholder 中文部分 ≤ 14 字", () => {
    const { defaultText } = extractPlaceholders();
    // 提取中文字符数
    const chineseChars = (defaultText.match(/[一-鿿]/g) ?? []).length;
    expect(chineseChars).toBeLessThanOrEqual(14);
  });

  it("placeholder 包含至少一个 hint 字符(@ 引用 / 指令 / 附件)", () => {
    const { defaultText } = extractPlaceholders();
    // 必须提到至少一个 hint 入口
    const hasHint = /[@/⏎]/.test(defaultText) || /引用|指令|附件|技能/.test(defaultText);
    expect(hasHint).toBe(true);
  });

  it("无 apiReady 时 fallback 文案 ≤ 14 字", () => {
    const { fallbackText } = extractPlaceholders();
    const chineseChars = (fallbackText.match(/[一-鿿]/g) ?? []).length;
    expect(chineseChars).toBeLessThanOrEqual(14);
  });
});
