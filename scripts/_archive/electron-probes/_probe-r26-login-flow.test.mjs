/**
 * _probe-r26-login-flow.test.mjs — 把「左下角账户菜单点登录会发生什么」变成 CI 断言。
 *
 * 历史(R26 / R48 / R62 之后):
 *   1. 菜单主按钮叫「登录」(R48 把它改回 git 历史 R15 / 536dc0e 的形态);
 *   2. 点一下必弹出 overlay.sign-in(Casdoor 登录对话框),未配置时框内给
 *      issuer / clientId 输入,已配置时直接拉起授权;
 *   3. 不弹新窗口(未配置时不能假装能登录);
 *   4. 设置 / 反馈入口都保留,菜单不变成单点;
 *   5. 界面上不再甩 `casdoor://localhost/callback` 这类运维术语。
 *
 * 没有 Electron 可执行文件时整体跳过(CI 无 display server)。
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
  if (result.status !== 0) {
    throw new Error(
      `probe failed (status=${result.status}): ${(result.stderr || result.stdout || "").slice(-800)}`,
    );
  }
  const startIdx = result.stdout.indexOf("{");
  if (startIdx < 0) {
    throw new Error(`no JSON in probe stdout; tail: ${(result.stdout + result.stderr).slice(-800)}`);
  }
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

const stepOk = (probe, step) => probe.steps.find((s) => s.step === step)?.ok === true;

describe.skipIf(!canLaunch)("live electron probe: R48/R62 后左下角账户菜单入口", () => {
  it("菜单主按钮叫「登录」且不再叫「配置企业登录」", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
    expect(probe.accountStatus.status).toBe("configuration_needed");
    expect(probe.menuItems).toContain("登录");
    expect(probe.menuItems).not.toContain("配置企业登录");
    expect(stepOk(probe, "菜单项「登录」存在且被点击")).toBe(true);
    expect(stepOk(probe, "账户菜单保留「打开设置」入口(兼容历史功能)")).toBe(true);
    expect(stepOk(probe, "账户菜单含「发送反馈」(R23 feedback 入口)")).toBe(true);
  });

  it("点「登录」→ overlay.sign-in 对话框弹出 + 不假装能登录 + 不漏运维术语", () => {
    const probe = runProbe();
    expect(stepOk(probe, "未配置时不假装能登录(没有新窗口)")).toBe(true);
    expect(stepOk(probe, "点「登录」后 overlay.sign-in 对话框真的弹出")).toBe(true);
    expect(stepOk(probe, "对话框里有 issuer / clientId 输入框(未配置时不跳设置)")).toBe(true);
    expect(stepOk(probe, "界面上不出现运维术语 casdoor://localhost/callback")).toBe(true);
  });
});
