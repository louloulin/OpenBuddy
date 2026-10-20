/**
 * _probe-r66-files-tree.test.mjs — files.tree slot 端到端接入 CI 断言。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r66-files-tree.mjs");
const electronBin = join(
  __dirname, "..", "..", "node_modules", "electron", "dist", "Electron.app",
  "Contents", "MacOS", "Electron",
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
    throw new Error(`no JSON in probe stdout; tail: ${(result.stdout + result.stderr).slice(-800)}`);
  }
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

const stepOk = (probe, step) => probe.steps.find((s) => s.step === step)?.ok === true;

describe.skipIf(!canLaunch)("live electron probe: R66 files.tree slot 全链路", () => {
  it("renderer bundle 加载 + LazyFileTree 符号已打包", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
    expect(stepOk(probe, "renderer bundle 已加载")).toBe(true);
    expect(stepOk(probe, "LazyFileTree 在 renderer bundle 中")).toBe(true);
    expect(stepOk(probe, "LazyFileTree 源文件存在")).toBe(true);
  });

  it("slot 字符串 + EXTENSION_POINTS.md 双侧一致", () => {
    const probe = runProbe();
    expect(stepOk(probe, "'files.tree' slot 字符串在 bundle 中")).toBe(true);
    expect(stepOk(probe, "docs/EXTENSION_POINTS.md 把 files.tree 标记为 ok")).toBe(true);
  });
});
