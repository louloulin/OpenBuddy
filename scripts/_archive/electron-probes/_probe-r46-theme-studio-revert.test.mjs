/**
 * _probe-r46-theme-studio-revert.test.mjs — R46 探针的 vitest 包装。
 *
 * 探针本身是 top-level 脚本,这里 spawn 它并断言 stdout 里 JSON 的 steps[] 全绿。
 *
 * 跑法:npx vitest run scripts/electron/_probe-r46-theme-studio-revert.test.mjs
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r46-theme-studio-revert.mjs");
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
    timeout: 120_000,
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

describe.skipIf(!canLaunch)("R46 — ThemeStudio 预览还原 + 保存即应用探针", () => {
  it("R46 真机断言全绿(mount 不污染 / 实时预览 / 未保存还原 / 已保存保留)", () => {
    const report = runProbe();
    expect(report.pageErrors).toEqual([]);
    const failed = (report.steps ?? []).filter((s) => !s.ok);
    expect(failed).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
