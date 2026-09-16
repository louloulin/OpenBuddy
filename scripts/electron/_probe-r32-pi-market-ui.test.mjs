/**
 * _probe-r32-pi-market-ui.test.mjs — 把 R32 的真机探针纳入 CI。
 *
 * 单测(`pi-market-multi-source.test.ts`)注入 `fetchJson`,证明的是"合并函数写得对";
 * 这条 wrapper 证明的是**产品真的这么跑**:宿主从 sources.json 读源 → 两个真 HTTP
 * 源 + 一个死源 → 权重合并 → UI 顶部来源 chips → 点安装 → lockfile 落盘。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r32-pi-market-ui.mjs");
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
    timeout: 300_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const startIdx = result.stdout.indexOf("{");
  if (startIdx < 0) {
    throw new Error(
      `no JSON in probe stdout; tail: ${(result.stdout + result.stderr).slice(-800)}`,
    );
  }
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

const stepNamed = (probe, fragment) =>
  probe.steps?.find((step) => step.step.includes(fragment));

describe.skipIf(!canLaunch)("live electron probe: Pi 扩展市场多源 + UI", () => {
  it("市场面板顶部真的渲染了 Pi 扩展区块", () => {
    const probe = runProbe();
    expect(stepNamed(probe, "顶部真的渲染")?.ok).toBe(true);
    expect(probe.section?.mounted).toBe(true);
  });

  it("条目渲染成市场卡片,不是空态", () => {
    const probe = runProbe();
    expect(probe.section?.cards).toBeGreaterThanOrEqual(3);
    expect(probe.section?.empty).toBe(false);
  });

  it("同 id 只有权重大的源赢;低权重源独有的扩展照样收录", () => {
    const probe = runProbe();
    expect(probe.merged?.officialWins).toBe(true);
    expect(probe.merged?.mirrorOnlyKept).toBe(true);
  });

  it("刷新后来源 chips 带每源权威状态,并点名不可达的源", () => {
    const probe = runProbe();
    const chips = probe.afterRefresh?.chips ?? [];
    expect(chips.some((chip) => chip.includes("官方") && chip.includes("已拉取"))).toBe(true);
    expect(chips.some((chip) => chip.includes("不可达"))).toBe(true);
  });

  it("从卡片点安装 → 对话框 → lockfile 里真的多出这个扩展", () => {
    const probe = runProbe();
    expect(stepNamed(probe, "点安装")?.ok).toBe(true);
    expect(probe.install?.version).toBe("1.1.0");
    expect(probe.install?.dialogStillOpen).toBe(false);
  });

  it("全程没有 renderer 报错", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
    expect(probe.ok).toBe(true);
  });
});
