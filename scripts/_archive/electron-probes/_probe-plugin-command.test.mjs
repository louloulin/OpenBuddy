/**
 * _probe-plugin-command.test.mjs — 把「插件命令 → ⌘K → 执行」的探针变成断言。
 *
 * 这条链路以前是断的:Plugin SDK 注册的命令进得了内核 `plugin.command` 槽,
 * 但没有任何消费者,用户永远看不到、也执行不了。没有 Electron 可执行文件时跳过。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-plugin-command.mjs");
const electronBin = join(
  __dirname, "..", "..", "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron",
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
    throw new Error(`probe failed (status=${result.status}): ${(result.stderr || result.stdout || "").slice(-800)}`);
  }
  const startIdx = result.stdout.indexOf("{");
  if (startIdx < 0) throw new Error(`no JSON in probe stdout; tail: ${result.stdout.slice(-500)}`);
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

describe.skipIf(!canLaunch)("live electron probe: 插件命令 → ⌘K → 执行", () => {
  it("Plugin SDK 事件进得了 plugin.command 槽", () => {
    const report = runProbe();
    expect(report.registered.slotEntries).toBeGreaterThanOrEqual(2);
    expect(report.registered.registrants).toContain("@openbuddy/plugin-sdk");
  });

  it("⌘K 面板列出插件命令(label 原样显示)", () => {
    const report = runProbe();
    expect(report.opened.open).toBe(true);
    expect(report.opened.counts.join(" ")).toContain("插件命令");
    expect(report.opened.items).toContain("/greet — 输出问候");
    expect(report.opened.items).toContain("整理工作区");
    // 提示文案也要跟着变,否则用户不知道还能执行插件命令。
    expect(report.opened.placeholder).toContain("/");
  });

  it("`/greet Alice` 过滤到只剩 greet,回车把 args 交给插件", () => {
    const report = runProbe();
    expect(report.filtered.items).toContain("/greet — 输出问候");
    expect(report.filtered.items).not.toContain("整理工作区");
    expect(report.afterEnter.calls).toEqual([{ id: "greet", args: "Alice" }]);
    // 执行后面板应当关闭(命令是「动作」,不是「跳转」)。
    expect(report.afterEnter.panelOpen).toBe(false);
  });

  it("Composer 的 `/` 菜单也列插件命令,发送时由插件执行(不发 agent)", () => {
    const report = runProbe();
    expect(report.composer.hasComposer).toBe(true);
    expect(report.composerPicker.open).toBe(true);
    expect(report.composerPicker.names).toContain("/greet");
    // 第一次是 ⌘K 的 /greet Alice,第二次是 Composer 输入的 /greet ComposerArgs ——
    // 后者证明发送路径把命令分流给了插件,而不是当成 prompt 发出去。
    expect(report.composerSend.calls).toEqual([
      { id: "greet", args: "Alice" },
      { id: "greet", args: "ComposerArgs" },
    ]);
    // 执行后输入框应被清空(命令是动作,不是待发送文本)。
    expect(report.composerSend.inputValue).toBe("");
  });

  it("没有页面错误", () => {
    const report = runProbe();
    expect(report.pageErrors).toEqual([]);
  });
});
