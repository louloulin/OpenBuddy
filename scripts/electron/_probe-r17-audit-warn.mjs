import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17aw-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e.message).slice(0, 400)));
page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") console.log("CON-" + m.type() + ":", m.text().slice(0, 300)); });
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(3500);

const auditFile = join(userData, "audit.jsonl");
console.log("FILE:", existsSync(auditFile) ? readFileSync(auditFile, "utf8").slice(0, 800) : "missing");

// Direct test after settings open
const direct = await page.evaluate(async () => {
  try { return { ok: true, val: await window.api.invoke("audit:record", { event: "test.post", outcome: "info", subject: "probe" }) }; }
  catch (e) { return { err: String(e?.message ?? e) }; }
});
console.log("DIRECT:", JSON.stringify(direct, null, 2));

await app.close();
process.exit(0);
