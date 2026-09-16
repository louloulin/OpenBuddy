/**
 * _probe-settings-appearance.test.mjs — 把「设置 → 个性化外观行」探针变成 CI 断言。
 *
 * 断言分两层,缺一不可:
 *   - 内核层:两个槽各有 1 条 entry、registrant 是 @openbuddy/ui-settings
 *     (证明"注册 + 消费"都接线了,而不是只声明);
 *   - 表现层:语言下拉真的切换了界面文案(scene/permission 词表从 zh 变 en)。
 *     只断言 slot 里有条目是不够的 —— 那正是这次要修的"注册了但没人消费"。
 *
 * 没有 Electron 可执行文件时整体跳过(CI 无 display server)。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-settings-appearance.mjs");
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
  const startIdx = result.stdout.indexOf("{");
  if (startIdx < 0) {
    throw new Error(`no JSON in probe stdout; tail: ${(result.stdout + result.stderr).slice(-800)}`);
  }
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

describe.skipIf(!canLaunch)("live electron probe: 设置 → 个性化的主题 / 语言行走内核槽位", () => {
  it("两个 appearance 槽都被 ui-settings 注册且真的渲染出来", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
    expect(probe.slots.language).toEqual({
      kind: "single",
      entries: 1,
      registrants: ["@openbuddy/ui-settings"],
    });
    expect(probe.slots.theme).toEqual({
      kind: "single",
      entries: 1,
      registrants: ["@openbuddy/ui-settings"],
    });
    expect(probe.before.found).toBe(true);
    expect(probe.before.options).toEqual(["zh-CN", "en-US"]);
    expect(probe.before.value).toBe("zh-CN");
  });

  it("切换语言后:内核 + localStorage + 界面文案三者一起变", () => {
    const probe = runProbe();
    expect(probe.switched).toBe(true);
    expect(probe.after.value).toBe("en-US");
    expect(probe.after.stored).toBe("en-US");
    // 至少一组 zh→en 文案真的翻转了(不是只有下拉框自己变了)。
    expect(probe.text.flipped.length).toBeGreaterThan(0);
  });
});
