/**
 * _probe-r26-login-flow.test.mjs — 把「未配置时点登录会发生什么」变成 CI 断言。
 *
 * 背景:用户反馈"点击登录没有弹出"。真根因不是按钮没接线,而是当时无论是否
 * 配置好都硬拉 Casdoor 登录页 —— 未配置环境下必然失败,用户拿到的只有一句
 * 「Casdoor 配置无效：请检查 issuer、client ID、…」。
 *
 * 修好之后的契约(这四步缺一不可):
 *   1. 主按钮是「配置企业登录」,不是点一下必失败的「企业登录」;
 *   2. 点击不假装能登录(没有新窗口);
 *   3. 落到设置 → 账户管理(用户能在这里补齐 issuer / client ID);
 *   4. 界面上不再出现 `casdoor://localhost/callback` 这类运维术语。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r26-login-flow.mjs");
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

const stepOk = (probe, step) => probe.steps.find((s) => s.step === step)?.ok === true;

describe.skipIf(!canLaunch)("live electron probe: 未配置企业身份时的登录入口(R26)", () => {
  it("未配置时主按钮是「配置企业登录」,且不提供必失败的「企业登录」", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
    expect(probe.accountStatus.status).toBe("configuration_needed");
    expect(probe.menuItems).toContain("配置企业登录");
    expect(probe.menuItems).not.toContain("企业登录");
    expect(stepOk(probe, "菜单项「配置企业登录」存在且被点击")).toBe(true);
  });

  it("点击后:不开假登录窗 + 落到账户设置 + 不出现运维术语", () => {
    const probe = runProbe();
    expect(stepOk(probe, "未配置时不假装能登录(没有新窗口)")).toBe(true);
    expect(stepOk(probe, "点击后落到账户设置(用户能在这里补齐配置)")).toBe(true);
    expect(stepOk(probe, "界面上不出现运维术语(不再甩 casdoor://localhost/callback)")).toBe(true);
  });
});
