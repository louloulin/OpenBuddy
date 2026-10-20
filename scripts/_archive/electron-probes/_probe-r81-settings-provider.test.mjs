/**
 * _probe-r81-settings-provider.test.mjs — 模型配置 → 真机对话闭环 CI 断言。
 *
 * 证明"设置页配出来的 provider"能直接驱动一次真实对话 —— 这是
 * "模型配置" 与 "AI Chat" 两块之间的接缝,单独测任何一块都覆盖不到。
 * 需要真实凭证;缺失时 skip。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveE2ECredentials } from "../lib/e2e-credentials.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const probePath = join(__dirname, "_probe-r81-settings-provider.mjs");
const electronBin = join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
const canRun = existsSync(electronBin) && Boolean(resolveE2ECredentials({}).apiKey);

const runProbe = () => {
  if (runProbe._cache) return runProbe._cache;
  const result = spawnSync("node", [probePath], {
    cwd: root, encoding: "utf8", timeout: 600_000, stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`probe failed (status=${result.status}): ${(result.stderr || result.stdout || "").slice(-1200)}`);
  }
  const startIdx = result.stdout.indexOf("{");
  if (startIdx < 0) throw new Error(`no JSON in probe stdout; tail: ${(result.stdout + result.stderr).slice(-800)}`);
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

const stepOk = (probe, needle) => probe.steps.find((s) => s.step.includes(needle))?.ok === true;

describe.skipIf(!canRun)("live electron probe: R81 模型配置 → 真机对话闭环", () => {
  it("设置页全流程走通(打开 → 模型页 → 添加厂商 → 选预设 → 填 key)", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
    expect(stepOk(probe, "打开设置面板")).toBe(true);
    expect(stepOk(probe, "模型面板渲染")).toBe(true);
    expect(stepOk(probe, "添加厂商对话框打开")).toBe(true);
    expect(stepOk(probe, "选中 MiniMax 预设")).toBe(true);
    expect(stepOk(probe, "填写 API Key")).toBe(true);
  });

  it("Test connection 对 MiniMax 返回 healthy(不是 404 degraded)", () => {
    const probe = runProbe();
    const step = probe.steps.find((s) => s.step.includes("Test connection"));
    expect(step?.ok).toBe(true);
    expect(step?.detail).toContain("ok");
  });

  it("保存后落盘 + UI 配置的厂商能真的对话", () => {
    const probe = runProbe();
    expect(stepOk(probe, "厂商保存后出现在列表")).toBe(true);
    expect(stepOk(probe, "providers-list 里有 minimax")).toBe(true);
    expect(probe.providerList?.providers ?? []).toContain("minimax");
    expect(stepOk(probe, "composer 可用")).toBe(true);
    expect(stepOk(probe, "真的能对话")).toBe(true);
    expect(String(probe.chatAnswer ?? "").length).toBeGreaterThan(0);
  });
});
