/**
 * _probe-r95-ui-inventory.test.mjs — UI 现状盘点探针的 vitest 包装。
 *
 * 把用户反复反馈过的三件事钉进 CI:
 *   1. **左下角的用户 + 设置**必须在 DOM 里且**在可视区内** —— 元素存在但被
 *      挤出视口,用户看到的仍然是"没有了",所以断言几何而不是只断言存在。
 *   2. **会话列表可滚动** —— 会话多了之后必须能滚,而不是把底部挤没了。
 *   3. **AI Chat 输入框可见** —— 暗色主题下曾经对比度不足。
 *
 * 跑法:`npx vitest run scripts/electron/_probe-r95-ui-inventory.test.mjs`
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r95-ui-inventory.mjs");
const electronBin = join(__dirname, "..", "..", "node_modules", ".bin", "electron");

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
    throw new Error(`no JSON in probe stdout (status=${result.status}): ${(result.stdout + result.stderr).slice(-800)}`);
  }
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

describe.skipIf(!canLaunch)("live electron probe: R95 UI 现状盘点", () => {
  it("所有步骤通过(无失败步骤)", () => {
    const probe = runProbe();
    expect(
      (probe.steps ?? []).filter((s) => !s.ok),
      JSON.stringify((probe.steps ?? []).filter((s) => !s.ok), null, 2),
    ).toEqual([]);
    expect(probe.ok).toBe(true);
  });

  it("左下角 footer(用户 + 设置)存在且在可视区内", () => {
    const probe = runProbe();
    const footer = probe.sidebarFooter ?? {};
    expect(footer.footer, "footer 元素缺失").toBeTruthy();
    expect(footer.footerInViewport).toBe(true);
    expect(footer.user, "用户按钮缺失").toBeTruthy();
    expect(footer.userInViewport).toBe(true);
    expect(footer.settings, "设置按钮缺失").toBeTruthy();
    expect(footer.settingsInViewport).toBe(true);
  });

  it("会话列表是滚动容器(会话多了不会把底部挤走)", () => {
    const probe = runProbe();
    expect(probe.sessionScroll?.canScroll).toBe(true);
  });

  it("AI Chat 输入框可见", () => {
    const probe = runProbe();
    expect(probe.composer?.visible).toBe(true);
  });

  it("无渲染异常", () => {
    const probe = runProbe();
    expect(probe.pageErrors ?? []).toEqual([]);
  });
});
