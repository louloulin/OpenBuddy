/**
 * Channel allowlist parity —— 全仓守卫。
 *
 * 每个 `ipcMain.handle("X")` 处理的通道,**必须**也出现在
 * `electron/preload/index.ts` 的 `allowedInvokeChannels` 集合里,否则渲染层
 * 的 `invoke` 会被静默拒绝(`invalid IPC channel`)。
 *
 * 这条不变式本来就有 526 条通道全部对齐的"好运",R41 一加就打破 —— 守卫把它
 * 钉死:忘记加进 allowlist 的人会立刻看到这条红。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SKIP = new Set(["node_modules", "__tests__", "dist", "out", ".turbo"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

const mainFiles = walk(join("electron", "main"));
const handledChannels = new Set<string>();
for (const file of mainFiles) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/ipcMain\.handle\(\s*["']([a-zA-Z0-9:_-]+)["']/g)) {
    handledChannels.add(match[1]);
  }
}

const preload = readFileSync(join("electron", "preload", "index.ts"), "utf8");
const setStart = preload.indexOf("allowedInvokeChannels = new Set([");
const setEnd = preload.indexOf("]);", setStart);
if (setStart === -1 || setEnd === -1) throw new Error("preload allowlist 形状变了,这个测试需要同步");
const allowedText = preload.slice(setStart, setEnd);
const allowed = new Set<string>();
for (const match of allowedText.matchAll(/["']([a-zA-Z0-9:_-]+)["']/g)) {
  allowed.add(match[1]);
}

describe("main ↔ preload 通道对齐", () => {
  it("扫描面不为空", () => {
    expect(handledChannels.size).toBeGreaterThan(200);
  });

  it("每个被 main 处理的通道,都能在 preload allowlist 里找到", () => {
    const missing = [...handledChannels].filter((c) => !allowed.has(c)).sort();
    expect(missing, `漏配 allowlist 的通道:\n  ${missing.join("\n  ")}`).toEqual([]);
  });
});
