/**
 * _probe-r51-casdoor-real-config.test.mjs — R51 真机探针的 vitest 包装。
 *
 * 该探针要打真实 Casdoor 实例,默认在 `OPENBUDDY_CASDOOR_REMOTE=1`
 * 才会跑(其它环境 skip),避免 CI / 离线机硬挂。
 *
 * 跑法:OPENBUDDY_CASDOOR_REMOTE=1 npx vitest run scripts/electron/_probe-r51-casdoor-real-config.test.mjs
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r51-casdoor-real-config.mjs");

const REMOTE = process.env.OPENBUDDY_CASDOOR_REMOTE === "1";

const runProbe = () => {
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
  return JSON.parse(result.stdout.slice(startIdx));
};

describe.skipIf(!REMOTE)("R51 — 真实 Casdoor 实例真机探针", () => {
  it("OIDC discovery 可达 + 登录对话框弹出 + 字段预填真实 URL + 缺 clientId 时给出明确提示", () => {
    const report = runProbe();
    const failed = (report.steps ?? []).filter((s) => !s.ok);
    expect(failed).toEqual([]);
    expect(report.discovery?.issuer).toBe("http://124.221.146.145:8000");
  }, 180_000);
});
