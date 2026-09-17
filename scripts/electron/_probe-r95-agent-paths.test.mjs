/**
 * _probe-r95-agent-paths.test.mjs — agent 数据目录探针的 vitest 包装。
 *
 * 把「main 的 agentHome 与 UI 文案必须一致」钉进 CI。跑的是真实 Electron
 * 进程(见同名 .mjs 的说明),因为它要验证的是 IPC 白名单 + handler 挂载 +
 * vite alias 这条**跨进程**链路 —— 链路上任何一环断了,单测都发现不了。
 *
 * 跑法:`npx vitest run scripts/electron/_probe-r95-agent-paths.test.mjs`
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r95-agent-paths.mjs");
const electronBin = join(__dirname, "..", "..", "node_modules", ".bin", "electron");

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
    throw new Error(`no JSON in probe stdout (status=${result.status}): ${(result.stdout + result.stderr).slice(-800)}`);
  }
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

describe.skipIf(!canLaunch)("live electron probe: R95 agent 数据目录", () => {
  it("所有步骤通过(无失败步骤)", () => {
    const probe = runProbe();
    expect(
      (probe.steps ?? []).filter((s) => !s.ok),
      JSON.stringify((probe.steps ?? []).filter((s) => !s.ok), null, 2),
    ).toEqual([]);
    expect(probe.ok).toBe(true);
  });

  it("agent:paths 反映显式覆盖的 agentHome,不含 .pi", () => {
    const probe = runProbe();
    expect(probe.snapshot?.fromEnv).toBe(true);
    expect(probe.snapshot?.home).toBeTruthy();
    expect(probe.snapshot.home).not.toMatch(/[\\/]\.pi([\\/]|$)/);
    expect(probe.snapshot.plugins).toBe(`${probe.snapshot.home}/plugins`);
    expect(probe.snapshot.extensions).toBe(`${probe.snapshot.home}/node_modules`);
  });

  it("UI 文案跟着 agentHome 走(证明 renderer 真在消费 IPC)", () => {
    const probe = runProbe();
    // 关键断言:不是「没有 ~/.pi」,而是「显示了自定义路径」。
    // 只查前者会漏掉「组件回落兜底常量」这种看起来正确的坏情况。
    expect(probe.assistantShowsCustomHome).toBe(true);
    expect(probe.assistantShowsFallbackHome).toBe(false);
  });

  it("界面可见文本里没有 ~/.pi", () => {
    const probe = runProbe();
    expect(probe.bodyHasPiPath).toBe(false);
    expect(probe.settingsHasPiPath).toBe(false);
    expect(probe.pageErrors ?? []).toEqual([]);
  });
});
