/**
 * _shot-r50-chrome.test.mjs — R50 全 chrome 视觉探针的 vitest 包装。
 *
 * 探针本身是 top-level 脚本,这里 spawn 它并断言 stdout 里 JSON 的 steps[] 全绿。
 * 跑法:`npx vitest run scripts/electron/_shot-r50-chrome.test.mjs`
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_shot-r50-chrome.mjs");
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

describe.skipIf(!canLaunch)("R50 — 全 chrome 视觉探针", () => {
  it("顶栏 / 状态栏 / 主题按钮 / 版本徽标 / 铃铛 / 设置 全部渲染 + light/dark 截图成功", () => {
    const report = runProbe();
    expect(report.steps?.length).toBeGreaterThan(0);
    const failed = (report.steps ?? []).filter((s) => !s.ok);
    expect(failed).toEqual([]);
  });
});
