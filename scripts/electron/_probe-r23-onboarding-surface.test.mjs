/**
 * _probe-r23-onboarding-surface.test.mjs — R62+ 适配版的 R23 探针 CI 包装。
 *
 * 三个 onboarding 槽位各自断言一条**用户可见的**证据:
 *   - whats-new : 重载后右下角真的出现摘要卡,版本号 / 条目数都来自真 CHANGELOG;
 *   - feedback  : 左下角账户菜单点得开、里面有入口,提交后 audit.jsonl 真的多一条;
 *   - data-dir  : 设置 → 数据管理有入口,选择器打开且回填当前目录,IPC 可读可写。
 *
 * R62 适配:预写 onboarding 完成态,避免 macOS OS keydown 把 wizard 重弹
 * 抢走 .sidebar__user 的焦点。
 *
 * 没有 Electron 可执行文件时整体跳过(CI 无 display server)。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r23-onboarding-surface.mjs");
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

describe.skipIf(!canLaunch)("live electron probe: R62+ 后三个 onboarding 槽位都可见", () => {
  it("onboarding.whats-new:升版本后自动弹摘要,关闭后记下版本", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
    expect(stepOk(probe, "whats-new 卡片出现")).toBe(true);
    expect(stepOk(probe, "whats-new 有版本号与条目")).toBe(true);
    expect(probe.whatsNew.version).toContain("0.16.0");
    expect(probe.whatsNew.itemCount).toBeGreaterThan(0);
    expect(stepOk(probe, "关闭后卡片消失 + 记录版本")).toBe(true);
  });

  it("onboarding.feedback:左下角账户菜单 → 反馈卡 → 本地 audit.jsonl", () => {
    const probe = runProbe();
    expect(stepOk(probe, "账户菜单可点开")).toBe(true);
    expect(stepOk(probe, "账户菜单含「发送反馈」")).toBe(true);
    expect(stepOk(probe, "反馈卡出现")).toBe(true);
    expect(stepOk(probe, "反馈落到本地 audit.jsonl")).toBe(true);
    expect(probe.auditFile.hasFeedback).toBe(true);
  });

  it("onboarding.data-dir:设置入口 + 内核选择器 + IPC 可读写", () => {
    const probe = runProbe();
    expect(stepOk(probe, "host:data-dir 能读到当前目录")).toBe(true);
    expect(stepOk(probe, "host:data-dir-set 写入成功且要求重启")).toBe(true);
    expect(stepOk(probe, "host:data-dir-reset 复位成功")).toBe(true);
    expect(stepOk(probe, "设置→数据管理有「更改数据目录」入口")).toBe(true);
    expect(stepOk(probe, "数据目录选择器(内核槽位)打开")).toBe(true);
    expect(probe.dataDirPicker.defaults).toBeGreaterThan(0);
  });

  it("整轮没有页面异常", () => {
    const probe = runProbe();
    expect(probe.ok).toBe(true);
  });
});
