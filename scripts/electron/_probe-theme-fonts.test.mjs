/**
 * _probe-theme-fonts.test.mjs — 把主题字体探针变成 CI 可跑的断言。
 *
 * 断言落在**真实渲染出的字体**上(computed style),而不是"槽位里有几条":
 * 主题字体是否真的生效,只有 computed fontFamily 说了算。
 * 没有 Electron 可执行文件时整体跳过(CI 无 display server)。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-theme-fonts.mjs");
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
    timeout: 180_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const startIdx = result.stdout.indexOf("{");
  if (startIdx < 0) {
    throw new Error(`no JSON in probe stdout; tail: ${(result.stdout + result.stderr).slice(-800)}`);
  }
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

describe.skipIf(!canLaunch)("live electron probe: 主题字体真的作用到 UI", () => {
  it("ThemePicker 选中 claude/win95 后 computed 字体跟着换,且没有 var() 自引用", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
    expect(probe.picked).toEqual({ claude: true, win95: true });
    expect(probe.fonts.claude.themeName).toBe("claude");
    expect(probe.fonts.claude.bodyFont).toContain("Space Grotesk");
    expect(probe.fonts.claude.headingToken).toContain("Playfair Display");
    expect(probe.fonts.claude.fontToken).not.toContain("var(--wb-font");
    expect(probe.fonts.win95.bodyFont).toContain("Pixelated MS Sans Serif");
  });
});
