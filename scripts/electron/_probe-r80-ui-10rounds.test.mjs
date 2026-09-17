/**
 * _probe-r80-ui-10rounds.test.mjs — R80 AI Chat 真机 10 轮对话(真实 UI 路径)CI 断言。
 *
 * 走用户真实操作:输入框逐字输入 → 点「发送」→ 校验 DOM 里 .msg--assistant 正文。
 * 需要真实 MiniMax 凭证;缺失时 skip。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveE2ECredentials } from "../lib/e2e-credentials.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const probePath = join(__dirname, "_probe-r80-ui-10rounds.mjs");
const electronBin = join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
const credentials = resolveE2ECredentials({});
const canRun = existsSync(electronBin) && Boolean(credentials.apiKey);

const runProbe = () => {
  if (runProbe._cache) return runProbe._cache;
  const result = spawnSync("node", [probePath], {
    cwd: root, encoding: "utf8", timeout: 900_000, stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`probe failed (status=${result.status}): ${(result.stderr || result.stdout || "").slice(-1200)}`);
  }
  const startIdx = result.stdout.indexOf("{");
  if (startIdx < 0) throw new Error(`no JSON in probe stdout; tail: ${(result.stdout + result.stderr).slice(-800)}`);
  runProbe._cache = JSON.parse(result.stdout.slice(startIdx));
  return runProbe._cache;
};

describe.skipIf(!canRun)("live electron probe: R80 AI Chat 真机 10 轮(真实 UI)", () => {
  it("composer 可用(apiReady=true),10/10 轮从 DOM 拿到正文", () => {
    const probe = runProbe();
    expect(probe.ok).toBe(true);
    expect(probe.composerEnabled).toBe(true);
    expect(probe.doneCount).toBe(10);
    expect(probe.rounds).toHaveLength(10);
  });

  it("每轮都有真实流式渲染(长度序列出现 ≥2 个不同中间值)", () => {
    const probe = runProbe();
    expect(probe.streamingRounds).toBe(10);
    for (const round of probe.rounds) {
      expect(round.isStreaming).toBe(true);
      expect(round.turnDone).toBe(true);
      expect(round.stopReason).toBe("stop");
      expect(round.error).toBeNull();
      expect(round.textLen).toBeGreaterThan(0);
    }
  });

  it("用户消息真的回显进 transcript", () => {
    const probe = runProbe();
    for (const round of probe.rounds) {
      expect(round.typedOk).toBe(true);
      expect(round.userEchoed).toBe(true);
    }
    expect(probe.pageErrors).toEqual([]);
  });
});
