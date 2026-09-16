/**
 * _probe-r28-details-rail.test.mjs — 把「右侧助理导轨真的在产品外壳里」变成 CI 断言。
 *
 * 背景:`details` 槽长期是"注册了却没人消费"—— ui-shell 把 SecondarySidebar
 * 注册进来,唯一的消费者 ui-layout 的 AppFrame 在 R23 之后降级成参考实现,
 * 于是这条 WorkBuddy peek-assistant 的等价能力在产品里根本不渲染。R28 把它接到
 * 产品外壳(AppShell)上,并补了空状态("还没有专家" + 一条去专家页的出口)。
 *
 * 断言的是用户能看到的东西:导轨位置、hover 浮层、空状态可点、点完真的跳走。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r28-details-rail.mjs");
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
  const startIdx = result.stdout.indexOf("{");
  if (startIdx < 0) {
    throw new Error(`no JSON in probe stdout; tail: ${(result.stdout + result.stderr).slice(-800)}`);
  }
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

describe.skipIf(!canLaunch)("live electron probe: `details` 槽(右侧助理导轨)", () => {
  it("没有活跃会话时不显示导轨(首页不该挂一条无用的导轨)", () => {
    const probe = runProbe();
    const step = probe.steps.find((s) => s.step === "首页不显示导轨");
    expect(step?.ok).toBe(true);
  });

  it("有活跃会话时导轨贴在窗口右缘(此前整条导轨根本不渲染)", () => {
    const probe = runProbe();
    expect(probe.rail).toBeTruthy();
    expect(probe.rail.styles.position).toBe("fixed");
    expect(probe.rail.styles.right).toBeLessThanOrEqual(2);
    expect(probe.rail.styles.label).toContain("助理");
    expect(probe.rail.box.width).toBeGreaterThan(8);
  });

  it("hover 浮出助理浮层,鼠标移开自动收起", () => {
    const probe = runProbe();
    expect(probe.peek).toBeTruthy();
    expect(probe.peek.width).toBe(268);
    const closed = probe.steps.find((s) => s.step === "鼠标移开自动收起");
    expect(closed?.ok).toBe(true);
  });

  it("一个专家都没有时给空状态 + 出口,不是一片空白", () => {
    const probe = runProbe();
    // 全新 agentHome 下 `~/.pi/agents/` 是空的,正好覆盖这条路径。
    expect(probe.peek.items).toBe(0);
    expect(probe.empty?.title).toContain("还没有专家");
    expect(probe.empty?.hasAction).toBe(true);
  });

  it("点「去创建专家」跳到专家页并收起浮层", () => {
    const probe = runProbe();
    expect(probe.navigated?.peekOpen).toBe(false);
    expect(probe.navigated?.hasExpertsHost).toBe(true);
    expect(probe.navigated?.expertCards).toBeGreaterThan(0);
  });

  it("全程没有 renderer 报错", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
  });
});
