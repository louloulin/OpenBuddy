import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17ad4-"));
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

page.on("pageerror", (e) => console.log("PAGEERROR:", String(e.message).slice(0, 400)));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("CON-" + m.type() + ":", m.text().slice(0, 300)); });

// Set up a listener for window errors
await page.addInitScript(() => {
  window.__ERR__ = [];
  window.addEventListener("error", (e) => window.__ERR__.push("ERR: " + String(e.message ?? e)));
  window.addEventListener("unhandledrejection", (e) => window.__ERR__.push("UR: " + String(e.reason?.message ?? e.reason)));
});

await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(3500);

const errs = await page.evaluate(() => window.__ERR__ ?? []);
console.log("CLIENT ERRS:", JSON.stringify(errs, null, 2));

const auditFile = join(userData, "audit.jsonl");
console.log("FILE:", existsSync(auditFile) ? readFileSync(auditFile, "utf8").slice(0, 600) : "missing");
await app.close();
process.exit(0);
