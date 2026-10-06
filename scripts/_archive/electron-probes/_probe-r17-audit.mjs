import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17a-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.addInitScript(() => {
  window.__ERRS__ = [];
  window.addEventListener("error", (e) => window.__ERRS__.push(String(e.error?.message ?? e.message)));
  window.addEventListener("unhandledrejection", (e) => window.__ERRS__.push("UR: " + String(e.reason?.message ?? e.reason)));
});
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e.message).slice(0, 200)));
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1200);

// Open settings (triggers audit "settings.open")
await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(2000);

// Navigate to 审计追踪
const navHit = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
  const t = items.find((el) => (el.textContent ?? "").includes("审计追踪"));
  if (t) (t).click();
  return t?.textContent?.trim() ?? null;
});
await page.waitForTimeout(2500);

const auditPanel = await page.evaluate(() => {
  const panel = document.querySelector(".settings-modal__panel");
  if (!panel) return { found: false };
  const rows = Array.from(panel.querySelectorAll(".audit-trail__row"));
  return {
    found: true,
    title: panel.querySelector("h2, h3")?.textContent?.trim(),
    rows: rows.length,
    sample: rows.slice(0, 3).map((r) => Array.from(r.querySelectorAll("td")).map((c) => c.textContent?.trim())),
    hasClearBtn: !!Array.from(panel.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("清空本地审计")),
    hasSearch: !!panel.querySelector("input[type='search']"),
    hasChainHint: (panel.textContent ?? "").includes("链式 SHA-256"),
  };
});
console.log("AUDIT PANEL:", JSON.stringify(auditPanel, null, 2));

await page.screenshot({ path: join(ROOT, "tests/screenshots/r17-audit.png") });

// Check on-disk file
const auditFile = join(userData, "audit.jsonl");
const fileExists = existsSync(auditFile);
const fileLines = fileExists ? readFileSync(auditFile, "utf8").split("\n").filter(Boolean) : [];
console.log("AUDIT FILE:", JSON.stringify({ exists: fileExists, lines: fileLines.length, sample: fileLines.slice(0, 2) }, null, 2));

const errors = await page.evaluate(() => window.__ERRS__ ?? []);
console.log("ERRORS:", JSON.stringify(errors));

await app.close();
process.exit(0);
