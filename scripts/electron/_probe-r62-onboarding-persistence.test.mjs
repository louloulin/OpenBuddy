/**
 * _probe-r62-onboarding-persistence.test.mjs — R62 首启引导持久化探针的 vitest 包装。
 *
 * 用户反馈:"为什么每次都弹出引导，引导过了就不需要弹出，需要存储这个状态"。
 * 探针真机启动两次 Electron(同一份 user-data-dir),证明关掉之后**跨进程**
 * 不再弹 —— 这是单次启动的断言无法覆盖的部分。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r62-onboarding-persistence.mjs");
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
    timeout: 240_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const startIdx = result.stdout.indexOf("{");
  if (startIdx < 0) {
    throw new Error(
      `probe produced no JSON (status=${result.status}); tail: ${(result.stdout + result.stderr).slice(-700)}`,
    );
  }
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

describe.skipIf(!canLaunch)("R62 — 首启引导关掉后不再弹(真机两次启动)", () => {
  it("冷启动有向导,关掉后落盘,第二次启动不再出现", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
    // 基线:冷启动必须真的弹过(否则这条断言毫无意义)。
    // 用"出现过"而非"此刻在":这台机器上真有 OS 级输入会落到窗口上。
    expect(probe.runs.run1.everVisible).toBe(true);
    // 关闭入口存在且关闭后浮层消失
    expect(probe.runs.run1.closeButtonPresent).toBe(true);
    expect(probe.runs.run1.afterDismiss.wizard).toBe(false);
    // 状态真的落盘,且是终结态
    expect(["dismissed", "done"]).toContain(probe.statusAfterDismiss);
    // 决定性断言:重启后不再弹
    expect(probe.runs.run2.onBoot.wizard).toBe(false);
    expect(probe.statusOnSecondBoot).toBe(probe.statusAfterDismiss);
    expect(probe.ok).toBe(true);
  });
});
