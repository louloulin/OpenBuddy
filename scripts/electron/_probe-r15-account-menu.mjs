import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-acct-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });

await page.addInitScript(() => {
  window.__PAGE_ERRORS__ = [];
  window.addEventListener("error", (e) => window.__PAGE_ERRORS__.push({ msg: String(e.error?.message ?? e.message), stack: String(e.error?.stack ?? "").slice(0, 400) }));
  window.addEventListener("unhandledrejection", (e) => window.__PAGE_ERRORS__.push({ msg: "UnhandledRejection: " + String(e.reason?.message ?? e.reason) }));
});

await page.waitForTimeout(14_000);
try { await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {}); } catch {}
await page.waitForTimeout(1500);

// 1. Verify sidebar user button exists
const before = await page.evaluate(() => {
  const btn = document.querySelector(".sidebar__user");
  const r = btn ? btn.getBoundingClientRect() : null;
  return {
    exists: !!btn,
    rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    text: btn?.textContent?.replace(/\s+/g, " ").trim(),
    ariaExpanded: btn?.getAttribute("aria-expanded"),
    ariaHasPopup: btn?.getAttribute("aria-haspopup"),
  };
});
console.log("BEFORE CLICK:", JSON.stringify(before, null, 2));

// 2. Click the user button -> menu should open
try {
  await page.click(".sidebar__user");
  await page.waitForTimeout(1200);
} catch (e) { console.log("click failed:", String(e).slice(0, 150)); }

const menuOpen = await page.evaluate(() => {
  const menu = document.querySelector(".sidebar__account-menu");
  const r = menu ? menu.getBoundingClientRect() : null;
  return {
    menuExists: !!menu,
    menuRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    items: menu ? Array.from(menu.querySelectorAll("[role='menuitem']")).map((b) => b.textContent?.trim()) : [],
    headName: menu?.querySelector(".sidebar__account-menu-name")?.textContent?.trim(),
    ariaExpanded: document.querySelector(".sidebar__user")?.getAttribute("aria-expanded"),
    chevron: !!document.querySelector(".sidebar__user-chevron"),
  };
});
console.log("MENU OPEN:", JSON.stringify(menuOpen, null, 2));

// 3. Click the 企业登录 item
const loginBtn = await page.$(".sidebar__account-menu-item--primary");
if (loginBtn) {
  await loginBtn.click();
  await page.waitForTimeout(2500);
}
const afterLogin = await page.evaluate(() => {
  return {
    pageErrors: window.__PAGE_ERRORS__ || [],
    menuStillOpen: !!document.querySelector(".sidebar__account-menu"),
    // Look for any toast about login
    toasts: Array.from(document.querySelectorAll(".toast, [class*='toast']")).map((t) => t.textContent?.trim().slice(0, 100)),
  };
});
console.log("AFTER LOGIN CLICK:", JSON.stringify(afterLogin, null, 2));

await app.close();
process.exit(0);
