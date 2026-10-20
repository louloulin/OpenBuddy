/**
 * _probe-r91-team-tab.test.mjs — R91 专家团 tab 探针的 vitest 包装。
 *
 * 跑法:`npx vitest run scripts/electron/_probe-r91-team-tab.test.mjs`
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_probe-r91-team-tab.mjs");
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

describe.skipIf(!canLaunch)("live electron probe: R91 专家团 tab", () => {
  it("切到专家团后断言全部成立", () => {
    const probe = runProbe();
    expect(probe.pageErrors).toEqual([]);
    const failed = (probe.steps ?? []).filter((s) => !s.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(probe.ok).toBe(true);
  });

  it("团队卡有内置专家团 ribbon", () => {
    const probe = runProbe();
    expect(probe.dump.cards.some((c) => c.ribbon?.includes("内置专家团"))).toBe(true);
  });
});
