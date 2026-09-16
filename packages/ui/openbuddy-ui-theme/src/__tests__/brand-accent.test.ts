/**
 * 品牌 accent 契约测试。
 *
 * 回归背景:`--wb-accent` 曾被写成 `oklch(0.72 0.135 165)`(= rgb(55,191,143)),
 * 一个被去饱和的薄荷绿。由于主题 store 把 token 以**内联**样式写在
 * documentElement 上,它会盖掉 `src/styles/tokens.css` 里的
 * `--wb-accent: var(--wb-brand-primary)`(= `#00C29A`),于是全站强调色/激活
 * 指示条(例如 branch navigator 的激活描边)从品牌青绿漂成灰绿,而
 * ThemePicker 的色板仍然显示 `#00C29A` —— 色板和实际渲染不符。
 *
 * 这里锁死三件事:
 *   1. `BRAND_ACCENT_OKLCH` 必须精确往返到 `#00C29A`(不是"接近")。
 *   2. 品牌锚定的主题(openbuddy / openbuddy-dark)的 `accent` 预览色就是
 *      `#00C29A`,并且它们的 `--wb-accent` 用的就是这个常量。
 *   3. LIGHT_BASE / DARK_BASE 的 accent 也是品牌色,保证任何"只在 base 里
 *      有 accent"的兜底场景不会又漂回薄荷绿。
 */
import { describe, expect, it } from "vitest";
import {
  BRAND_ACCENT_OKLCH,
  LIGHT_BASE,
  DARK_BASE,
  getThemeByName,
} from "../themes";

/** OKLCh → sRGB,和浏览器一致(裁剪到 [0,1] 后四舍五入)。 */
function oklchToRgb(oklch: string): [number, number, number] {
  const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(oklch);
  if (!m) throw new Error(`not a plain oklch color: ${oklch}`);
  const [L, C, hDeg] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  return lin.map((u) => {
    const v = u <= 0.0031308 ? 12.92 * u : 1.055 * u ** (1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, v)) * 255);
  }) as [number, number, number];
}

describe("品牌 accent = #00C29A", () => {
  it("BRAND_ACCENT_OKLCH 精确往返到 rgb(0, 194, 154)", () => {
    expect(oklchToRgb(BRAND_ACCENT_OKLCH)).toEqual([0, 194, 154]);
  });

  it("两个品牌主题的色板预览色就是 #00C29A", () => {
    expect(getThemeByName("openbuddy")!.accent).toBe("#00C29A");
    expect(getThemeByName("openbuddy-dark")!.accent).toBe("#00C29A");
  });

  it("品牌主题的 --wb-accent 引用同一个常量", () => {
    for (const name of ["openbuddy", "openbuddy-dark"]) {
      expect(getThemeByName(name)!.vars["--wb-accent"], name).toBe(
        BRAND_ACCENT_OKLCH,
      );
      expect(getThemeByName(name)!.vars["--wb-accent-soft"], name).toContain(
        BRAND_ACCENT_OKLCH.replace(")", ""),
      );
    }
  });

  it("base 兜底的 accent 也是品牌色", () => {
    expect(LIGHT_BASE["--wb-accent"]).toBe(BRAND_ACCENT_OKLCH);
    expect(DARK_BASE["--wb-accent"]).toBe(BRAND_ACCENT_OKLCH);
    // accent-soft 必须是同一个颜色的 alpha 变体,不能是别的色相。
    expect(LIGHT_BASE["--wb-accent-soft"]).toContain(
      BRAND_ACCENT_OKLCH.replace(")", ""),
    );
    expect(DARK_BASE["--wb-accent-soft"]).toContain(
      BRAND_ACCENT_OKLCH.replace(")", ""),
    );
  });
});
