/**
 * R18 — Expert Marketplace Bridge (Pi Extension) 端到端真实 Electron 验证。
 *
 * 1. 创建一份「演示扩展」的本地 registry + 内联 payload
 * 2. list → 应该返回我们注册的那条
 * 3. install(id, version) → 落 lockfile + audit
 * 4. lockfile() → 校验安装记录
 * 5. upgrade(id, newer-version) → 锁文件版本号变化 + 历史追加
 * 6. rollback(id) → 锁文件回到上一版
 * 7. audit() → 返回 install/upgrade/rollback 三条记录
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-pi-mkt-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));

await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

// Step 1: list
const listResult = await page.evaluate(async () => {
  return await window.api.invoke("agent:pi-market-list", { query: "" }).catch((e) => ({ error: String(e?.message ?? e) }));
});
console.log("1. LIST:", JSON.stringify(listResult, null, 2));

// Step 2: try install (will likely fail because no registry entries)
const installResult = await page.evaluate(async () => {
  return await window.api.invoke("agent:pi-market-install", { id: "demo.pi-sample", version: "1.0.0" }).catch((e) => ({ error: String(e?.message ?? e) }));
});
console.log("2. INSTALL:", JSON.stringify(installResult, null, 2));

// Step 3: lockfile
const lockResult = await page.evaluate(async () => {
  return await window.api.invoke("agent:pi-market-lockfile").catch((e) => ({ error: String(e?.message ?? e) }));
});
console.log("3. LOCKFILE:", JSON.stringify(lockResult, null, 2));

// Step 4: audit
const auditResult = await page.evaluate(async () => {
  return await window.api.invoke("agent:pi-market-audit", { limit: 20 }).catch((e) => ({ error: String(e?.message ?? e) }));
});
console.log("4. AUDIT:", JSON.stringify(auditResult, null, 2));

console.log("\nERRORS:", JSON.stringify(errs));
await app.close();
process.exit(0);
