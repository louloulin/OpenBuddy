/**
 * _probe-r64-replay-tour.test.mjs — 「重新观看引导」入口 CI 断言。
 *
 * 没有 Electron 可执行文件时整体跳过(CI 无 display server)。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r64-replay-tour.mjs");
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
  if (result.status !== 0) {
    throw new Error(
      `probe failed (status=${result.status}): ${(result.stderr || result.stdout || "").slice(-800)}`,
    );
  }
  const startIdx = result.stdout.indexOf("{");
  if (startIdx < 0) {
    throw new Error(`no JSON in probe stdout; tail: ${(result.stdout + result.stderr).slice(-800)}`);
  }
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

const stepOk = (probe, step) => probe.steps.find((s) => s.step === step)?.ok === true;

describe.skipIf(!canLaunch)("live electron probe: R64 「重新观看引导」入口", () => {
  it("设置 → 关于 → 「重新观看引导」按钮存在", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
    expect(stepOk(probe, "设置对话框可打开")).toBe(true);
    expect(stepOk(probe, "「关于」section 入口可点开")).toBe(true);
    expect(stepOk(probe, "「重新观看引导」按钮存在")).toBe(true);
  });

  it("点击按钮 → 设置关掉 + TourModal 出现 + 持久化清掉", () => {
    const probe = runProbe();
    expect(stepOk(probe, "点击后设置对话框被关掉(replayTour 路径)")).toBe(true);
    expect(stepOk(probe, "点击后 TourModal 在 DOM 里出现")).toBe(true);
    expect(stepOk(probe, "点击后首启向导持久化被清掉")).toBe(true);
    expect(stepOk(probe, "点击后漫游 seen 标记被清掉")).toBe(true);
  });
});
