import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r16d-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(14_000);
try { await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {}); } catch {}
await page.waitForTimeout(1500);

await page.$(".sidebar__user").then(b => b.click({ force: true }));
await page.waitForTimeout(1000);

// Directly dispatch a click on the primary item and capture errors
const trace = await page.evaluate(async () => {
  const item = document.querySelector(".sidebar__account-menu-item--primary");
  if (!item) return { error: "no primary item" };
  const log = [];
  const origError = console.error;
  console.error = (...a) => { log.push("console.error: " + a.map(String).join(" ").slice(0, 200)); origError.apply(console, a); };
  window.addEventListener("error", (e) => log.push("window.error: " + String(e.error?.message ?? e.message)));
  window.addEventListener("unhandledrejection", (e) => log.push("rejection: " + String(e.reason?.message ?? e.reason)));
  item.click();
  await new Promise((r) => setTimeout(r, 3500));
  console.error = origError;
  return {
    log,
    menuStillOpen: !!document.querySelector(".sidebar__account-menu"),
    settingsModal: !!document.querySelector(".settings-modal"),
    overlay: !!document.querySelector(".settings-modal-overlay"),
    rootChildren: Array.from(document.querySelector(".app")?.children ?? []).map(c => c.className.toString().slice(0, 50)),
  };
});
console.log(JSON.stringify(trace, null, 2));
await app.close();
process.exit(0);
