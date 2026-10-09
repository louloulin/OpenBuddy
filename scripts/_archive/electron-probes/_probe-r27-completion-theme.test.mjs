/**
 * _probe-r27-completion-theme.test.mjs — 把「补全菜单在亮暗两套主题下都看得见」
 * 变成 CI 断言。
 *
 * 用户反馈"黑色主题下 chatinput 框展示补全和白色主题存在差距"。真机量下来发现
 * 真正不可读的是**亮色**主题:`.slash-commands__item--active` 用了实心 CTA 胶囊色
 * `--wb-bg-pill-active`(亮色 = rgba(0,0,0,0.75))配 `--wb-text-strong`,于是被
 * 选中的第一行是黑底黑字(对比度 ≈ 1.0)。
 *
 * 断言方式不靠肉眼:探针在页面里按 WCAG 公式算对比度(半透明色先合成到菜单背景),
 * 两套主题的"命令名 / 描述"都必须 ≥ 4.5(AA 正文阈值)。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r27-completion-theme.mjs");
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

const AA = 4.5;

describe.skipIf(!canLaunch)("live electron probe: `/` 补全菜单在亮暗主题下的对比度", () => {
  it("两套主题都能打开补全菜单", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
    expect(probe.light.menuFound).toBe(true);
    expect(probe.dark.menuFound).toBe(true);
    expect(probe.light.itemCount).toBeGreaterThan(0);
  });

  it("亮色主题:选中行文字对比度 ≥ 4.5(此前是黑底黑字 ≈ 1.0)", () => {
    const probe = runProbe();
    expect(probe.light.contrast.activeName).not.toBeNull();
    expect(probe.light.contrast.activeName).toBeGreaterThanOrEqual(AA);
    expect(probe.light.contrast.activeDesc).toBeGreaterThanOrEqual(AA);
  });

  it("暗色主题:选中行文字对比度 ≥ 4.5", () => {
    const probe = runProbe();
    expect(probe.dark.contrast.activeName).toBeGreaterThanOrEqual(AA);
    expect(probe.dark.contrast.activeDesc).toBeGreaterThanOrEqual(AA);
  });

  it("选中态确实随主题变化(不是两套都是同一个颜色)", () => {
    const probe = runProbe();
    expect(probe.light.item.background).not.toBe(probe.dark.item.background);
    expect(probe.light.item.color).not.toBe(probe.dark.item.color);
    expect(probe.light.theme).toBe("light");
    expect(probe.dark.theme).toBe("dark");
  });
});
