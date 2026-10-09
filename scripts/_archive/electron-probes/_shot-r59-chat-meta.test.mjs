/**
 * _shot-r59-chat-meta.test.mjs — R59 视觉探针的 vitest 包装。
 *
 * 跑 _shot-r59-chat-meta.mjs,断言:
 *   1. Electron 启动并截图成功。
 *   2. 截图文件存在。
 *   3. JSON 输出包含 inputBg / outputBg(说明 .msg__meta-chip--input 和
 *      --output 的 CSS 计算样式确实被注册到 global)。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const probePath = join(__dirname, "_shot-r59-chat-meta.mjs");
const electronBin = join(
  __dirname, "..", "..", "node_modules", "electron", "dist",
  "Electron.app", "Contents", "MacOS", "Electron",
);
const canLaunch = existsSync(electronBin);
const screenshotPath = join(
  __dirname, "..", "..", "tests", "screenshots", "r59-chat-meta.png",
);

const runProbe = () => {
  if (runProbe._cache) return runProbe._cache;
  const result = spawnSync("node", [probePath], {
    cwd: join(__dirname, "..", ".."),
    encoding: "utf8",
    timeout: 90_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `probe failed (status=${result.status}): ${(result.stderr || result.stdout || "").slice(-800)}`,
    );
  }
  // Pull the JSON object that the probe prints last. The probe prints
  // exactly one top-level object via console.log(JSON.stringify(...)),
  // so we look for the LAST balanced JSON object in stdout.
  const out = result.stdout || "";
  let depth = 0;
  let start = -1;
  let end = -1;
  for (let i = out.length - 1; i >= 0; i--) {
    const ch = out[i];
    if (ch === "}") {
      if (end === -1) end = i + 1;
      depth++;
    } else if (ch === "{") {
      depth--;
      if (depth === 0) {
        start = i;
        break;
      }
    }
  }
  if (start === -1) {
    throw new Error(`probe did not print a JSON object; stdout tail: ${out.slice(-400)}`);
  }
  const payload = JSON.parse(out.slice(start, end));
  runProbe._cache = payload;
  return payload;
};

describe.skipIf(!canLaunch)("R59 chat meta visual probe", () => {
  it("launches Electron, injects meta row, captures screenshot", () => {
    const payload = runProbe();
    expect(payload.ok).toBe(true);
    expect(existsSync(screenshotPath)).toBe(true);
  });

  it("registers .msg__meta-chip--input CSS rule", () => {
    const payload = runProbe();
    // CSS color-mix(in srgb, var(--wb-brand) 7%, transparent) → 浏览器返回
    // resolved background,只要不是 'none' / '' 就说明规则真生效了。
    expect(payload.probeResult.inputBg).toBeTruthy();
    expect(payload.probeResult.inputBg).not.toMatch(/^(none|rgba?\(0,\s*0,\s*0,\s*0\))$/);
  });

  it("registers .msg__meta-chip--output CSS rule", () => {
    const payload = runProbe();
    expect(payload.probeResult.outputBg).toBeTruthy();
  });
});
