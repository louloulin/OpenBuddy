/**
 * _probe-r91-experts-single-column.test.mjs — R91 专家页单栏探针的 vitest 包装。
 *
 * 用户反馈:「专家页面不需要展示任务删除」——即左侧那条 WorkBuddy 风格的
 * 「任务(N)」栏要移除。探针断言 tasks-panel 不在 DOM、主区独占整宽、专家卡
 * 仍然正常渲染。
 *
 * 跑法:`npx vitest run scripts/electron/_probe-r91-experts-single-column.test.mjs`
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r91-experts-single-column.mjs");
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
  const parsed = JSON.parse(result.stdout.slice(startIdx));
  // The probe keeps its DOM measurements under `geometry`; flatten them onto
  // the report so the assertions below read naturally.
  runProbe._cache = { ...parsed, ...(parsed.geometry ?? {}), stdout: result.stdout };
  return runProbe._cache;
};

describe.skipIf(!canLaunch)("live electron probe: R91 专家页单栏(任务栏已移除)", () => {
  it("左侧「任务」栏不在 DOM 里", () => {
    const probe = runProbe();
    expect((probe.steps ?? []).every((s) => s.ok), JSON.stringify((probe.steps ?? []).filter((s) => !s.ok), null, 2)).toBe(true);
    expect(probe.tasksPanelPresent).toBe(false);
  });

  it("主区独占整宽(split 容器退化为单栏)", () => {
    const probe = runProbe();
    expect(probe.mainFillRatio).toBeGreaterThanOrEqual(0.98);
    expect(probe.splitDisplay).toBe("block");
  });

  it("移栏没打断主路径:专家卡与精选场景仍在", () => {
    const probe = runProbe();
    expect(probe.cardCount).toBeGreaterThanOrEqual(5);
    expect(probe.scenesRect?.h ?? 0).toBeGreaterThan(0);
  });

  it("空态不再提 Windows 路径 `E:\\Pi\\agents`", () => {
    const probe = runProbe();
    expect(probe.stdout).not.toContain("E:\\Pi\\agents");
  });
});
