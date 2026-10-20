import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17ad3-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

// Warm up the bridge with a few common invokes before clicking settings
const warmup = await page.evaluate(async () => {
  const r = [];
  for (const ch of ["casdoor:status", "agents_list"]) {
    try { r.push({ ch, ok: true, val: await window.api.invoke(ch) }); }
    catch (e) { r.push({ ch, err: String(e?.message ?? e) }); }
  }
  return r;
});
console.log("WARMUP:", JSON.stringify(warmup, null, 2));

// Now click settings
await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(3000);

const auditFile = join(userData, "audit.jsonl");
console.log("FILE:", existsSync(auditFile) ? readFileSync(auditFile, "utf8").slice(0, 600) : "missing");

// Also try direct
const direct = await page.evaluate(async () => {
  try { return { ok: true, val: await window.api.invoke("audit:record", { event: "test.after", outcome: "info", subject: "p" }) }; }
  catch (e) { return { err: String(e?.message ?? e) }; }
});
console.log("DIRECT:", JSON.stringify(direct, null, 2));

await app.close();
process.exit(0);
