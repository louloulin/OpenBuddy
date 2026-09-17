/**
 * _probe-r65-sidebar-resize.test.mjs — 侧栏宽度可拖拽 + 持久化 CI 断言。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r65-sidebar-resize.mjs");
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

describe.skipIf(!canLaunch)("live electron probe: R65 侧栏宽度可拖拽 + 持久化", () => {
  it("handle 存在 + ARIA 范围 + 默认宽度在 220-420 之间", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
    expect(stepOk(probe, "handle 存在且 edge=right")).toBe(true);
    expect(stepOk(probe, "handle aria 范围 220-420")).toBe(true);
    expect(stepOk(probe, "默认 wrapper 宽度介于 220-420")).toBe(true);
  });

  it("拖拽 → 宽度变化 + localStorage 持久化 + 极值 clamp", () => {
    const probe = runProbe();
    expect(stepOk(probe, "拖拽 +60px 后 wrapper 宽度变化")).toBe(true);
    expect(stepOk(probe, "拖拽后 localStorage 写入新宽度")).toBe(true);
    expect(stepOk(probe, "拖到极小被 clamp 到 220")).toBe(true);
    expect(stepOk(probe, "拖到极大被 clamp 到 420")).toBe(true);
  });

  it("重启后宽度从 localStorage 恢复", () => {
    const probe = runProbe();
    expect(stepOk(probe, "重启后 wrapper 宽度从 localStorage 恢复为 420")).toBe(true);
  });
});
