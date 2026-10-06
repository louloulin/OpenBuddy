/**
 * _probe-r91-sidebar-geom.test.mjs — R91 侧栏几何探针的 vitest 包装。
 *
 * 探针本身是 top-level 脚本,这里 spawn 它并断言 stdout JSON 的 steps[] 全绿。
 * 没有 Electron 可执行文件时整体跳过(CI 无 display server)。
 *
 * 跑法:`npx vitest run scripts/electron/_probe-r91-sidebar-geom.test.mjs`
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r91-sidebar-geom.mjs");
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

describe.skipIf(!canLaunch)("live electron probe: R91 侧栏会话行几何契约", () => {
  it("多会话下没有折行 / 行高不齐 / footer 重叠", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
    const failed = (probe.steps ?? []).filter((s) => !s.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(probe.ok).toBe(true);
  });

  it("会话行一律 30px 高、同宽,长标题不撑行", () => {
    const probe = runProbe();
    // 12 条敌对标题(超长中文 / 无空格 ASCII)也必须全部落在同一行盒里。
    expect(probe.geometry.rowHeights).toEqual([30]);
    expect(probe.geometry.rowWidths).toHaveLength(1);
    expect(probe.geometry.wrappedTitles).toEqual([]);
    expect(probe.geometry.rowCount).toBeGreaterThanOrEqual(4);
  });

  it("底部账户入口不与滚动区重叠,且点击真的弹出菜单", () => {
    const probe = runProbe();
    expect(probe.geometry.footer.top).toBeGreaterThanOrEqual(probe.geometry.scroll.bottom - 1);
    expect(probe.geometry.accountMenuOpens).toBe(true);
  });
});
