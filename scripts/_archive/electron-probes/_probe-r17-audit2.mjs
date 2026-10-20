import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17a2-"));
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
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e.message).slice(0, 400)));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE-ERR:", m.text().slice(0, 300)); });
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1200);

// Try to call audit:record directly from the page
const direct = await page.evaluate(async () => {
  try {
    // Test if window.api is exposed
    const has = !!window.api;
    const result = await window.api?.invoke?.("audit:record", { event: "test.direct", outcome: "info", subject: "probe" });
    return { has, result };
  } catch (e) {
    return { error: String(e), stack: e?.stack?.slice(0, 400) };
  }
});
console.log("DIRECT:", JSON.stringify(direct, null, 2));

await page.waitForTimeout(500);

// Open settings
await page.click(".sidebar__icon-btn[aria-label='设置']").catch((e) => console.log("settings click err:", e.message.slice(0, 80)));
await page.waitForTimeout(2200);

// Check what nav exists
const nav = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".settings-navigation__item, .settings-navigation__group"));
  return items.slice(0, 20).map((el) => ({ tag: el.tagName, text: (el.textContent ?? "").slice(0, 40), cls: el.className.slice(0, 60) }));
});
console.log("NAV:", JSON.stringify(nav, null, 2));

const auditFile = join(userData, "audit.jsonl");
console.log("AUDIT FILE:", existsSync(auditFile) ? readFileSync(auditFile, "utf8").slice(0, 400) : "missing");
await app.close();
process.exit(0);
