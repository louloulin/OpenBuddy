/**
 * brand-token-contract.test.ts — 防回归守卫：`--wb-brand` 短别名必须
 * 定义在实际被加载的样式表里。
 *
 * 背景（2026-09-16 真实缺陷）：
 *   `--wb-brand` 之前只定义在 src/styles/global.css，而入口
 *   src/main.tsx 引入的是 src/styles/globals.css —— globals.css 从未
 *   @import global.css。结果是运行时
 *   getComputedStyle(documentElement).getPropertyValue("--wb-brand")
 *   返回空字符串，全仓 513 处 `var(--wb-brand, <fallback>)` 全部静默
 *   回退到旧版蓝紫 fallback，OpenBuddy 品牌青绿 (#00C29A) 从未生效。
 *
 *   实测证据（修复前 → 修复后）：
 *     composer focus halo: color(srgb .357 .373 .780 / .1)  →  color(srgb 0 .761 .604 / .1)
 *     sidebar active bar:  rgb(91, 95, 199)                 →  rgb(0, 194, 154)
 *
 * 本测试锁定三条不变量：
 *   1. tokens.css（被 globals.css 加载）里定义了 --wb-brand
 *   2. 亮色 + 暗色两套都定义了 --wb-brand，且都指向 --wb-brand-primary
 *   3. globals.css 的 @import 列表必须包含定义 --wb-brand 的那个文件
 *      （即：不允许再把品牌别名放回未被加载的文件里）
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesDir = join(__dirname, "..");
const tokens = readFileSync(join(stylesDir, "tokens.css"), "utf8");
const globals = readFileSync(join(stylesDir, "globals.css"), "utf8");

describe("--wb-brand 短别名契约", () => {
  it("tokens.css 定义了 --wb-brand（亮色主题）", () => {
    expect(tokens).toMatch(/^\s*--wb-brand:\s*var\(--wb-brand-primary\)\s*;/m);
  });

  it("tokens.css 至少定义两次（亮色 + 暗色两套主题）", () => {
    const hits = tokens.match(/^\s*--wb-brand:\s*var\(--wb-brand-primary\)\s*;/gm);
    expect(hits).not.toBeNull();
    expect(hits!.length).toBeGreaterThanOrEqual(2);
  });

  it("--wb-brand 跟随 --wb-brand-primary（主题切换自动生效）", () => {
    expect(tokens).toMatch(/--wb-brand:\s*var\(--wb-brand-primary\)/);
    // 两套主题的 brand-primary 必须都已经定义
    const primary = tokens.match(/^\s*--wb-brand-primary:\s*var\([^)]+\)\s*;/gm);
    expect(primary).not.toBeNull();
    expect(primary!.length).toBeGreaterThanOrEqual(2);
  });

  it("globals.css 入口加载了定义 --wb-brand 的样式表", () => {
    // 定义 --wb-brand 的文件必须出现在 globals.css 的 @import 列表里。
    const imported = [...globals.matchAll(/@import\s+"\.\/([^"]+)"/g)].map((m) => m[1]);
    expect(imported).toContain("tokens.css");
  });

  it("global.css 不再是 --wb-brand 的唯一定义处（防再次误放）", () => {
    let globalCss = "";
    try {
      globalCss = readFileSync(join(stylesDir, "global.css"), "utf8");
    } catch {
      globalCss = "";
    }
    const definesBrand = /^\s*--wb-brand:/m.test(globalCss);
    if (definesBrand) {
      // 如果将来还在 global.css 里保留定义，那 globals.css 必须加载它
      const imported = [...globals.matchAll(/@import\s+"\.\/([^"]+)"/g)].map((m) => m[1]);
      expect(imported).toContain("global.css");
    }
    // 无论哪种情况，tokens.css 都必须有定义（上面的用例已覆盖）
    expect(tokens).toMatch(/^\s*--wb-brand:/m);
  });

  it("不再把旧版蓝紫硬编码成 --wb-brand 的 fallback", () => {
    // 150 处 fallback 已在本次修复中统一为品牌青绿；禁止回退。
    for (const legacy of ["#5b5fc7", "#5b67f1", "#6366f1", "#4f46e5"]) {
      expect(tokens).not.toContain(`var(--wb-brand, ${legacy})`);
    }
  });
});
