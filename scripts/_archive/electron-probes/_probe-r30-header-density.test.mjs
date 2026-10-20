/**
 * _probe-r30-header-density.test.mjs — 顶栏不压邻居、输入卡提示不重复,进 CI。
 *
 * 两条都是真机量出来的用户可见缺陷(详见 _probe-r30-header-density.mjs 头部):
 *   - `.main-topbar__search` 的 `min-width: 280px` 在 760px 窗口下让搜索框
 *     溢出中间区,与左右邻居各重叠 24px;
 *   - `.wb-composer__setup-hint` 把「请先配置 API Key 开始使用」画了两遍,
 *     其中一遍垂直居中压在输入区/底栏接缝上。
 *
 * 断言方式不靠肉眼:探针在 5 档窗口宽度下量搜索框与左右组的**重叠量**
 * (必须 ≤ 0),并检查点击热区里除 sr-only 外没有可见文字落进底栏带。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r30-header-density.mjs");
const electronBin = join(
  __dirname,
  "..",
  "..",
  "node_modules",
  "electron",
  "dist",
  "Electron.app",
  "Contents",
  "MacOS",
  "Electron",
);

const canLaunch = existsSync(electronBin);

const runProbe = () => {
  if (runProbe._cache) return runProbe._cache;
  const result = spawnSync("node", [probePath], {
    cwd: join(__dirname, "..", ".."),
    encoding: "utf8",
    timeout: 240_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const startIdx = result.stdout.indexOf("{");
  if (startIdx < 0) {
    throw new Error(`no JSON in probe stdout; tail: ${(result.stdout + result.stderr).slice(-800)}`);
  }
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

describe.skipIf(!canLaunch)("live electron probe: 顶栏信息密度 / 输入卡提示", () => {
  for (const width of [1280, 1100, 980, 860, 760]) {
    it(`${width}px:搜索框不与左右邻居重叠(修复前 760px 各重叠 24px)`, () => {
      const probe = runProbe();
      const m = probe.widths[String(width)];
      expect(m).toBeTruthy();
      expect(m.overlapLeft).toBeLessThanOrEqual(0);
      expect(m.overlapRight).toBeLessThanOrEqual(0);
    });
  }

  it("宽窗口保留文字标签,窄窗口退化成纯图标按钮", () => {
    const probe = runProbe();
    expect(probe.widths["1280"].labelVisible).toBe(true);
    expect(probe.widths["1280"].searchWidth).toBeGreaterThan(200);
    expect(probe.widths["760"].labelVisible).toBe(false);
    expect(probe.widths["760"].searchWidth).toBeLessThanOrEqual(40);
  });

  it("首页输入卡的「请先配置 API Key」只画一遍(sr-only 之外没有文字压底栏)", () => {
    const probe = runProbe();
    expect(probe.composer?.found).toBe(true);
    expect(probe.composer?.overlayCoversCard).toBe(true);
    expect(probe.composer?.footerIntruders).toEqual([]);
  });

  it("点击热区仍然有无障碍名字(视觉隐藏 ≠ 读屏也消失)", () => {
    const probe = runProbe();
    expect(probe.composer?.srOnlyLabel).toContain("请先配置 API Key");
  });

  it("全程没有 renderer 报错", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
  });
});
