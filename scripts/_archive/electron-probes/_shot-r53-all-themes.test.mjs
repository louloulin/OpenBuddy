/**
 * _shot-r53-all-themes.test.mjs — R53 全 19 主题视觉探针的 vitest 包装。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_shot-r53-all-themes.mjs");
const electronBin = join(
  __dirname, "..", "..", "node_modules", "electron", "dist",
  "Electron.app", "Contents", "MacOS", "Electron",
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
  if (result.status !== 0) {
    throw new Error(
      `probe failed (status=${result.status}): ${(result.stderr || result.stdout || "").slice(-800)}`,
    );
  }
  const startIdx = result.stdout.indexOf("{");
  if (startIdx < 0) {
    throw new Error(`no JSON in probe stdout; tail: ${result.stdout.slice(-500)}`);
  }
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

describe.skipIf(!canLaunch)("R53 — 19 套主题全量截图视觉探针", () => {
  it("Google Fonts 预热 + ThemePicker 全套主题逐一切换 + 每套各拍一张 chrome 全图", () => {
    const report = runProbe();
    expect(report.steps?.length).toBeGreaterThan(0);
    const failed = (report.steps ?? []).filter((s) => !s.ok);
    expect(failed).toEqual([]);
  });
});
