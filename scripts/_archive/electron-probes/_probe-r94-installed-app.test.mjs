/**
 * _probe-r94-installed-app.test.mjs — 「已安装 bundle」探针的 vitest 包装。
 *
 * 与 `_probe-r94-expert-tasks` 的区别:后者跑 `out/`(源码构建产物),
 * 本包装跑 `/Applications/OpenBuddy.app`(用户实际点开的那个 bundle)。
 * 用户反馈「改了没效果」时,先看这条 —— 它能把「源码已修 / 安装包滞后」
 * 这类问题直接指出来。
 *
 * 跑法:`npx vitest run scripts/electron/_probe-r94-installed-app.test.mjs`
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r94-installed-app.mjs");
const installedBin = "/Applications/OpenBuddy.app/Contents/MacOS/OpenBuddy";

// 只有在装了 bundle 的机器(开发者 / CI mac agent)上才跑。
const canLaunch = existsSync(installedBin);

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
    throw new Error(`no JSON in probe stdout (status=${result.status}): ${(result.stdout + result.stderr).slice(-600)}`);
  }
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

describe.skipIf(!canLaunch)("live electron probe: R94 已安装 bundle 的专家页", () => {
  it("已安装包里的专家页没有任务面板 / 删除入口", () => {
    const probe = runProbe();
    expect(
      (probe.steps ?? []).every((s) => s.ok),
      JSON.stringify((probe.steps ?? []).filter((s) => !s.ok), null, 2),
    ).toBe(true);
    expect(probe.audit?.tasksPanel).toBe(false);
    expect(probe.audit?.killButtons).toBe(0);
    expect(probe.audit?.deleteLike ?? []).toEqual([]);
  });

  it("已安装包里的专家页是单栏且主路径可用", () => {
    const probe = runProbe();
    expect(probe.audit?.splitDisplay).toBe("block");
    expect(probe.audit?.cardCount ?? 0).toBeGreaterThanOrEqual(3);
    expect(probe.audit?.scenesVisible).toBe(true);
  });
});
