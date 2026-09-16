import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17s-"));
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

async function tap(sel, ms = 700) { try { await page.click(sel, { timeout: 1500 }); await page.waitForTimeout(ms); } catch (e) { console.log("miss", sel, e.message.slice(0, 60)); } }

const summary = {};

// Sidebar - open + verify
summary.sidebar_user_click = await page.evaluate(() => {
  document.querySelector(".sidebar__user")?.click();
  const m = document.querySelector(".sidebar__account-menu");
  return { opened: !!m, hit: m ? (() => { const r = m.getBoundingClientRect(); return document.elementFromPoint(r.left + 40, r.top + 20); })() : null };
});
await page.waitForTimeout(400);
// close menu
await page.evaluate(() => document.querySelector(".sidebar__user")?.click());
await page.waitForTimeout(400);

// Theme picker reachable? Look in settings > appearance
summary.theme_picker_in_settings = await (async () => {
  await tap(".sidebar__icon-btn[aria-label='设置']", 1500);
  const opened = await page.evaluate(() => !!document.querySelector(".settings-modal"));
  if (!opened) return { settingsOpened: false };
  // try to navigate to appearance
  const navHit = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".settings-navigation__item, [class*='settings-nav'] *"));
    const appearance = items.find((el) => (el.textContent ?? "").includes("外观") || (el.textContent ?? "").includes("主题") || (el.textContent ?? "").toLowerCase().includes("appearance"));
    if (appearance) (appearance).click();
    return appearance ? appearance.textContent?.trim() : null;
  });
  await page.waitForTimeout(900);
  const picker = await page.evaluate(() => {
    const el = document.querySelector(".theme-picker, [class*='theme-picker'], [class*='ThemePicker']");
    return el ? { found: true, swatches: document.querySelectorAll("[class*='theme-picker__swatch'], [class*='theme-card']").length } : { found: false };
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  return { settingsOpened: opened, navLabel: navHit, picker };
})();

// close settings via Esc + reload snapshot
await page.waitForTimeout(500);
await page.screenshot({ path: join(ROOT, "tests/screenshots/r17-smoke.png"), fullPage: false });
summary.errors = await page.evaluate(() => window.__ERRS__ ?? []);

console.log("SMOKE:", JSON.stringify(summary, null, 2));
await app.close();
process.exit(0);
