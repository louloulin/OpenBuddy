/**
 * _probe-slot-assembly.test.mjs — 把微内核装配探针变成 CI 可跑的断言。
 *
 * 探针本身是 top-level 脚本(自己 launch Electron),所以这里 spawn 它、
 * JSON.parse stdout,而不是 import。
 *
 * 断言的是「内核真的装配成了什么」,不是从 DOM 反推:
 *   - 24 个内置 ui-* 包的 apply() 全成功(失败会静默让界面退化成裸文本,
 *     这是最容易被忽略的一类回归)
 *   - Phase B–D 新增的 `files.tree` / `editor.body` / `onboarding.wizard`
 *     槽位真的有 1 条 entry,且由预期的包提供
 *   - 全新 profile 首启落在品牌主题,`--wb-accent` 是 #00C29A 而不是去饱和
 *     薄荷绿,`--wb-radius-md` 没被上一套主题(win95/winxp 的直角)残留
 *
 * 没有 Electron 可执行文件时整体跳过(CI 无 display server)。
 * 跑法:rtk proxy npx vitest run scripts/electron/_probe-slot-assembly.test.mjs
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-slot-assembly.mjs");
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
    timeout: 180_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `probe failed (status=${result.status}): ${(result.stderr || result.stdout || "").slice(-800)}`,
    );
  }
  const startIdx = result.stdout.indexOf("{");
  if (startIdx < 0) {
    throw new Error(`no JSON in probe stdout; tail: ${result.stdout.slice(-500)}`);
  }
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

describe.skipIf(!canLaunch)("live electron probe: 微内核装配 + 主题落地", () => {
  it("每个内置 ui-* 包的 apply() 都成功", () => {
    const report = runProbe();
    expect(report.builtinFailed).toEqual([]);
    // 24 条内置 apply;新增 ui-* 包时这里会涨,所以断言下界而不是相等。
    expect(report.builtinTotal).toBeGreaterThanOrEqual(24);
    expect(report.slotCount).toBeGreaterThanOrEqual(40);
    // 启动期不允许有未捕获的 renderer 错误(React #185 那类就是从这里冒出来的)。
    expect(report.pageErrors).toEqual([]);
  });

  it("Phase B–D 新增槽位各有一条预期实现", () => {
    const report = runProbe();
    const filesTree = report.slots["files.tree"];
    expect(filesTree).not.toBeNull();
    expect(filesTree.kind).toBe("single");
    expect(filesTree.entries).toBe(1);
    expect(filesTree.registrants).toEqual(["@openbuddy/ui-files-tree"]);

    const editorBody = report.slots["editor.body"];
    expect(editorBody).not.toBeNull();
    expect(editorBody.entries).toBe(1);
    expect(editorBody.registrants).toEqual(["@openbuddy/ui-editor"]);

    const onboarding = report.slots["onboarding.wizard"];
    expect(onboarding).not.toBeNull();
    expect(onboarding.entries).toBe(1);
    expect(onboarding.registrants).toEqual(["@openbuddy/ui-onboarding"]);

    // shell.overlay 是 list kind,由多个包共同填充。
    const overlay = report.slots["shell.overlay"];
    expect(overlay).not.toBeNull();
    expect(overlay.kind).toBe("list");
    expect(overlay.entries).toBeGreaterThanOrEqual(4);
  });

  it("首启落在品牌主题,accent 是 #00C29A", () => {
    const report = runProbe();
    expect(report.theme.attr).toBe("light");
    expect(report.theme.name).toBe("openbuddy");
    // rgb(0,194,154) 的 OKLCh 往返值;去饱和薄荷绿(旧值)会在这里挂。
    expect(report.theme.accent).toBe("oklch(0.7246 0.142 171)");
  });

  it("主题 token 不残留上一套主题的内联值", () => {
    const report = runProbe();
    // 只写 delta 的旧实现会把 win95/winxp 的 --wb-radius-*: 0 永久留在
    // documentElement 上,之后每套主题都是直角。这两个断言是那条回归的锁。
    expect(report.theme.radiusMd).toBe("6px");
    expect(report.theme.elevated).not.toBe("");
    expect(report.theme.elevated.startsWith("oklch(")).toBe(true);
  });

  it("外壳渲染完整:没有 error boundary,composer + sidebar 都在", () => {
    const report = runProbe();
    expect(report.errorBoundary).toBe(false);
    expect(report.hasComposer).toBe(true);
    expect(report.hasSidebar).toBe(true);
  });
});
