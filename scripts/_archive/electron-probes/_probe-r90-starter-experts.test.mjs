/**
 * _probe-r90-starter-experts.test.mjs — 内置「起步专家」目录的 vitest 包装。
 *
 * 开源用户第一次打开「专家·技能·连接器」不该看到空状态卡 + Windows 路径。
 * 探针在**不注入任何外部目录**的前提下断言:seed 出来的
 * `<agentHome>/experts` 被 `expertDefaultRoot()` 选中,5 张专家卡 + 5 个精选
 * 场景 + 5 个分类 chip 全部渲染,专家团 tab 里有「成果交付专家团」+ 内置
 * 专家团 ribbon。
 *
 * 跑法:`npx vitest run scripts/electron/_probe-r90-starter-experts.test.mjs`
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r90-starter-experts.mjs");
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

describe.skipIf(!canLaunch)("live electron probe: R90 内置起步专家目录", () => {
  it("真机断言全绿(无问题、无页面异常)", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
    expect(probe.problems).toEqual([]);
    expect(probe.ok).toBe(true);
  });

  it("不注入外部目录也解析出内置种子目录", () => {
    const probe = runProbe();
    expect(probe.envMain.has).toBe(true);
    expect(probe.envMain.root).toContain("experts");
  });

  it("专家网格渲染 5 张卡 + 5 个精选场景 + 5 个分类 chip", () => {
    const probe = runProbe();
    expect(probe.dom.cards.length).toBeGreaterThanOrEqual(5);
    expect(probe.dom.cards.map((c) => c.title)).toContain("软件工程师");
    expect(probe.dom.scenes).toBe(5);
    expect(probe.dom.chips).toEqual(["全部", "工程开发", "内容创作", "研究分析", "办公效能"]);
  });

  it("专家团 tab 有「成果交付专家团」且带「内置专家团」ribbon", () => {
    const probe = runProbe();
    const team = probe.teamDom.cards;
    expect(team.some((c) => c.title?.includes("成果交付专家团"))).toBe(true);
    expect(team.some((c) => c.ribbon?.includes("内置专家团"))).toBe(true);
  });

  it("不是空状态、不卡在 loading", () => {
    const probe = runProbe();
    expect(probe.dom.emptyState).toBeNull();
    expect(probe.dom.loadingState).toBeNull();
  });
});
