/**
 * _probe-r80-chat-10rounds.test.mjs — R80 AI Chat 真机 10 轮对话(IPC 路径)CI 断言。
 *
 * 需要真实 MiniMax 凭证(.env.e2e.local 或 OPENBUDDY_E2E_* 环境变量)。
 * 凭证缺失时整个 suite skip —— 不是失败,是"本机无法验证"。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveE2ECredentials } from "../lib/e2e-credentials.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const probePath = join(__dirname, "_probe-r80-chat-10rounds.mjs");
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

describe.skipIf(!canRun)("live electron probe: R80 AI Chat 真机 10 轮(IPC)", () => {
  it("完成 10/10 轮,每轮都有非空 assistant 文本 + stop 收尾", () => {
    const probe = runProbe();
    expect(probe.ok).toBe(true);
    expect(probe.doneCount).toBe(10);
    expect(probe.rounds).toHaveLength(10);
  });

  it("provider 注册生效(authStatus.ready)+ 无 renderer 报错", () => {
    const probe = runProbe();
    expect(probe.authStatus?.ready).toBe(true);
    expect(probe.pageErrors).toEqual([]);
  });

  it("每轮都真的流过 agent_message_chunk(不是空回复)", () => {
    const probe = runProbe();
    for (const round of probe.rounds) {
      expect(round.error).toBeNull();
      expect(round.textLen).toBeGreaterThan(0);
      expect(round.updateTypes?.agent_message_chunk ?? 0).toBeGreaterThan(0);
      expect(round.stopReason).toBe("stop");
    }
  });
});
