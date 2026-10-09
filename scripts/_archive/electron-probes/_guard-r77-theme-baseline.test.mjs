/**
 * _guard-r77-theme-baseline.test.mjs — R77 视觉基线守卫
 *
 * 验证 tests/screenshots/r77-themes/{manual,manual-dark,match-system-light,match-system-dark}/
 * 下各 19 张截图存在,且每组 19 张 md5 两两不同(防止后续脚本错误让所有主题拍出
 * 同一张图)。
 *
 * 跑全量截图:node scripts/electron/_shot-r77-theme-baseline.mjs (~4 min)。
 * 守卫(本测试):pnpm exec vitest run scripts/electron/_guard-r77-theme-baseline.test.mjs
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseDir = join(__dirname, "..", "..", "tests", "screenshots", "r77-themes");
const VARIANTS = ["manual", "manual-dark", "match-system-light", "match-system-dark"];
const EXPECTED = 19;

const md5 = (path) => createHash("md5").update(readFileSync(path)).digest("hex");

describe("R77 — 19 主题 × 4 变体视觉基线守卫", () => {
  for (const v of VARIANTS) {
    it(`${v}/  下 ${EXPECTED} 张截图齐全`, () => {
      const dir = join(baseDir, v);
      const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
      expect(files.length).toBe(EXPECTED);
    });

    it(`${v}/  下 ${EXPECTED} 张 md5 两两不同(防止脚本 bug 拍成同一张)`, () => {
      const dir = join(baseDir, v);
      const files = readdirSync(dir).filter((f) => f.endsWith(".png"));
      const hashes = files.map((f) => md5(join(dir, f)));
      const unique = new Set(hashes);
      expect(unique.size, `${v}: duplicates detected`).toBe(EXPECTED);
    });
  }

  it("同主题在 4 个变体之间 md5 不全相同(说明变体真的生效)", () => {
    // 取 midnight-ocean (dark 主题) — 4 变体应产生 ≥3 个不同 md5
    const dir = (v) => join(baseDir, v, "midnight-ocean.png");
    const hashes = VARIANTS.map((v) => md5(dir(v)));
    const unique = new Set(hashes);
    expect(unique.size, `4 variants produced only ${unique.size} distinct images`).toBeGreaterThanOrEqual(3);
  });

  it("openbuddy (light) 在 manual/manual-dark 字节相同(系统色不影响 light 主题类型)", () => {
    const a = md5(join(baseDir, "manual", "openbuddy.png"));
    const b = md5(join(baseDir, "manual-dark", "openbuddy.png"));
    expect(a).toBe(b);
  });

  it("openbuddy-dark 在 match-system-dark 与 match-system-light 不同(system 色真的影响 dark 主题)", () => {
    const c = md5(join(baseDir, "match-system-light", "openbuddy-dark.png"));
    const d = md5(join(baseDir, "match-system-dark", "openbuddy-dark.png"));
    expect(c).not.toBe(d);
  });
});
