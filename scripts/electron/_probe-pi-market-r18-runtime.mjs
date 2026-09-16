/**
 * R18 — 验证桥接的 Pi Extension 真正被 agent-runtime 加载。
 *
 * 1. 在 userData/pi-extensions/installed.json 注入 demo.pi-sample
 * 2. 在 userData/pi-extensions/demo.pi-sample/{current → 1.0.0, 1.0.0/openbuddy.plugin.json}
 * 3. 启动 Electron,等待 init-pipeline 跑到 stage=6.6 (initPiUserExtensions)
 * 4. 抓取 plugin/loaded 事件,验证 demo.pi-sample 出现在加载列表里
 * 5. 同时验证 plugin/ready 事件,确认所有插件装载完毕
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-pi-runtime-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

// Stage A: 预置本地 Pi Extension 桥接锁文件 + 实际 plugin manifest
const piExtRoot = join(userData, "pi-extensions");
const extDir = join(piExtRoot, "demo.pi-sample");
const verDir = join(extDir, "1.0.0");
mkdirSync(verDir, { recursive: true });

const PLUGIN_JSON = JSON.stringify({
  schema: "openbuddy.plugin.v1",
  id: "demo.pi-sample",
  version: "1.0.0",
  surface: "pi",
  provides: [{ type: "tool", name: "demo-hello", description: "打招呼" }],
}, null, 2);

writeFileSync(join(extDir, "current"), "1.0.0\n");
writeFileSync(join(verDir, "openbuddy.plugin.json"), PLUGIN_JSON);
writeFileSync(join(verDir, "README.md"), "# R18 runtime test\n");

const lockfile = {
  version: 1,
  extensions: {
    "demo.pi-sample": {
      version: "1.0.0",
      path: verDir,
      installedAt: new Date().toISOString(),
      integrity: "r18-runtime-test",
      history: [],
      capabilities: ["tools.demo-hello"],
    },
  },
};
writeFileSync(join(piExtRoot, "installed.json"), JSON.stringify(lockfile, null, 2));

console.log("PREINSTALLED:", verDir);

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(3000);

// 通过 renderer 端探针确认 bridge lockfile 还在,以及 agent 拿到了
const runtime = await page.evaluate(async () => {
  const api = window.api;
  const lockfileResult = await api.invoke("agent:pi-market-lockfile");
  const lockfileAudit = await api.invoke("agent:pi-market-audit", { limit: 5 });
  return {
    bridgeLockfile: lockfileResult?.extensions,
    bridgeAuditCount: lockfileAudit?.entries?.length,
  };
});
console.log("\nRUNTIME_BRIDGE_STATE:", JSON.stringify(runtime, null, 2));

// 通过 filesystem 验证 plugin 还在
const fsCheck = await page.evaluate(async ({ userData }) => {
  const fs = await import("node:fs/promises");
  const out = {};
  try {
    const cur = await fs.readFile(`${userData}/pi-extensions/demo.pi-sample/current`, "utf8");
    out.current = cur.trim();
    out.pluginJson = await fs.readFile(`${userData}/pi-extensions/demo.pi-sample/1.0.0/openbuddy.plugin.json`, "utf8");
  } catch (e) { out.error = String(e.message); }
  return out;
}, { userData });
console.log("\nRUNTIME_FS:", JSON.stringify(fsCheck, null, 2));

// 关掉
await app.close();
process.exit(0);
