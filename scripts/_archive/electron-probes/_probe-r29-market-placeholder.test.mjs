/**
 * _probe-r29-market-placeholder.test.mjs — 「插件·市场」这条路径在 CI 里必须可达。
 *
 * 背景:`_probe-phase-bcd.mjs` 一直用 `[data-testid="marketplace-tab"]` 判断市场
 * 是否存在,而那个 testid 属于 `@openbuddy/ui-modules` 的**参考实现**
 * (MarketplaceTab,默认 apply 是 no-op、不注册)。产品里真正渲染的是
 * `@openbuddy/ui-mcp` 的 MarketplacePanel(挂在 `modules.marketplace` 槽的回退
 * 底座上)。于是"市场是不是可达"这个问题长期只有一个恒为 false 的假阴性答案。
 *
 * 本 wrapper 断言的是用户路径:侧栏进专家页 → 四个市场 tab 在 → 点「插件·市场」
 * → 面板真挂载(显示"N 个源 · M 个插件 · K 已安装")。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r29-market-placeholder.mjs");
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

describe.skipIf(!canLaunch)("live electron probe: 插件·市场可达性", () => {
  it("专家页有四个市场 tab(专家 / 技能 / 连接器 / 插件·市场)", () => {
    const probe = runProbe();
    expect(probe.pills?.map((p) => p.label)).toEqual(["专家", "技能", "连接器", "插件·市场"]);
  });

  it("市场面板真的挂载(不是参考实现的 testid 假阴性)", () => {
    const probe = runProbe();
    expect(probe.panel?.mounted).toBe(true);
    expect(probe.panel?.hasMarketplaceBody).toBe(true);
    expect(probe.panel?.activeTab).toContain("插件");
  });

  it("面板给出源 / 插件 / 已安装计数(空市场也要有明确数字,不是白板)", () => {
    const probe = runProbe();
    // 读的是统计行本身(`.marketplace-panel__stats`),不是面板全文的截断 ——
    // 前面区块的文案变长会把统计行挤出 `text.slice()` 窗口,那不是产品回归。
    expect(probe.panel?.stats).toMatch(/\d+ 个源/);
    expect(probe.panel?.stats).toMatch(/\d+ 个插件/);
    expect(probe.panel?.stats).toMatch(/\d+ 已安装/);
  });

  it("面板可以搜索", () => {
    const probe = runProbe();
    expect(probe.panel?.searchable).toBe(true);
  });

  it("全程没有 renderer 报错", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
  });
});
