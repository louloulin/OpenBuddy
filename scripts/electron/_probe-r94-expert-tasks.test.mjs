/**
 * _probe-r94-expert-tasks.test.mjs — R94 专家页「无任务/删除入口」探针的 vitest 包装。
 *
 * 用户反馈:「专家页面不需要展示任务删除」。R91 移除专家页内嵌的任务栏,
 * R93 摘掉全局任务浮层,R94 清掉零消费方的死代码。本包装把三条断言固化,
 * 让这份回归永远跑在 CI 里。
 *
 * 跑法:`npx vitest run scripts/electron/_probe-r94-expert-tasks.test.mjs`
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r94-expert-tasks.mjs");
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
  const startIdx = result.stdout.indexOf("{");
  if (startIdx < 0) {
    throw new Error(`no JSON in probe stdout (status=${result.status}): ${(result.stdout + result.stderr).slice(-600)}`);
  }
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

describe.skipIf(!canLaunch)("live electron probe: R94 专家页无任务/删除入口", () => {
  it("探针全部断言通过", () => {
    const probe = runProbe();
    expect(
      (probe.steps ?? []).every((s) => s.ok),
      JSON.stringify((probe.steps ?? []).filter((s) => !s.ok), null, 2),
    ).toBe(true);
  });

  it("DOM 里没有任何任务面板容器", () => {
    const probe = runProbe();
    expect(probe.audit?.tasksPanel).toBe(false);
    expect(probe.audit?.tasksPanelClass).toBe(false);
  });

  it("没有「删除 / 终止」语义按钮", () => {
    const probe = runProbe();
    expect(probe.audit?.killButtons).toBe(0);
    expect(probe.audit?.deleteLike ?? []).toEqual([]);
  });

  it("无渲染期异常", () => {
    const probe = runProbe();
    expect(probe.pageErrors ?? []).toEqual([]);
  });
});
