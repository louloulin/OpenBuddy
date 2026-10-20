/**
 * _probe-r82-microkernel-panel.test.mjs — 「设置 → 系统信息」微内核面板 CI 断言。
 *
 * 关键不是"页面有数字",而是"页面上的数字 == 内核快照"。面板完全可以
 * 渲染一堆常量也看着很漂亮;只有逐个数字与 __ob_slotcore 对齐,才证明
 * 它显示的是真值。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const probePath = join(__dirname, "_probe-r82-microkernel-panel.mjs");
const electronBin = join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
const canLaunch = existsSync(electronBin);

const runProbe = () => {
  if (runProbe._cache) return runProbe._cache;
  const result = spawnSync("node", [probePath], {
    cwd: root, encoding: "utf8", timeout: 240_000, stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`probe failed (status=${result.status}): ${(result.stderr || result.stdout || "").slice(-1000)}`);
  }
  const startIdx = result.stdout.indexOf("{");
  if (startIdx < 0) throw new Error(`no JSON in probe stdout; tail: ${(result.stdout + result.stderr).slice(-800)}`);
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

const stepOk = (probe, needle) => probe.steps.find((s) => s.step.includes(needle))?.ok === true;

describe.skipIf(!canLaunch)("live electron probe: R82 微内核健康面板", () => {
  it("能从设置导航进入,面板渲染出摘要", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
    expect(stepOk(probe, "打开设置面板")).toBe(true);
    expect(stepOk(probe, "导航到「系统信息」")).toBe(true);
    expect(stepOk(probe, "面板渲染")).toBe(true);
  });

  it("面板数字与内核快照一致(槽位数 / 装配成功数)", () => {
    const probe = runProbe();
    expect(stepOk(probe, "槽位数与内核 snapshot 行数一致")).toBe(true);
    expect(stepOk(probe, "显式登记槽位数")).toBe(true);
    expect(stepOk(probe, "内置包装配成功数与内核报告一致")).toBe(true);
    expect(probe.kernel.ui.okPackages).toBe(probe.kernel.core.okPackages);
    expect(probe.kernel.ui.slotCount).toBe(probe.kernel.core.slots.length);
  });

  it("可见槽位行逐条与内核对齐,展开后覆盖全部槽位", () => {
    const probe = runProbe();
    expect(stepOk(probe, "可见槽位行的 entries 与内核快照逐条一致")).toBe(true);
    expect(stepOk(probe, "展开后显示全部槽位")).toBe(true);
    // 内置包全部装配成功(失败会让微内核静默退化成裸文本)
    expect(probe.kernel.core.okPackages).toBe(probe.kernel.core.totalPackages);
  });
});
