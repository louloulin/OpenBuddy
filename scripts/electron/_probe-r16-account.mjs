import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r16-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });

await page.addInitScript(() => {
  window.__PAGE_ERRORS__ = [];
  window.addEventListener("error", (e) => window.__PAGE_ERRORS__.push({ msg: String(e.error?.message ?? e.message) }));
  window.addEventListener("unhandledrejection", (e) => window.__PAGE_ERRORS__.push({ msg: "UR: " + String(e.reason?.message ?? e.reason) }));
});

await page.waitForTimeout(14_000);
try { await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {}); } catch {}
await page.waitForTimeout(1500);

// 1. Verify the "openbuddy" pill is gone (builtin status-indicator should be sr-only)
const pillCheck = await page.evaluate(() => {
  const el = document.querySelector(".status-indicator--builtin");
  const r = el ? el.getBoundingClientRect() : null;
  return {
    exists: !!el,
    cls: el?.className,
    role: el?.getAttribute("role"),
    ariaLive: el?.getAttribute("aria-live"),
    ariaAtomic: el?.getAttribute("aria-atomic"),
    ariaLabel: el?.getAttribute("aria-label"),
    rect: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
    visibleText: el?.textContent?.trim() ?? "",
  };
});
console.log("PILL CHECK:", JSON.stringify(pillCheck, null, 2));

// 2. Footer layout
const footer = await page.evaluate(() => {
  const f = document.querySelector(".sidebar__footer");
  const r = f ? f.getBoundingClientRect() : null;
  const kids = f ? Array.from(f.children).map((c) => {
    const b = c.getBoundingClientRect();
    return { cls: c.className.toString().slice(0, 45), w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x) };
  }) : [];
  return { footer: r ? { w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y) } : null, kids };
});
console.log("FOOTER:", JSON.stringify(footer, null, 2));

// 3. Open the account menu and check the items
await page.click(".sidebar__user");
await page.waitForTimeout(1200);
const menu = await page.evaluate(() => {
  const m = document.querySelector(".sidebar__account-menu");
  return {
    exists: !!m,
    items: m ? Array.from(m.querySelectorAll("[role='menuitem']")).map((b) => ({ text: b.textContent?.trim(), cls: b.className.toString().slice(0, 60) })) : [],
    userText: document.querySelector(".sidebar__user")?.textContent?.replace(/\s+/g, " ").trim(),
  };
});
console.log("MENU:", JSON.stringify(menu, null, 2));

// 4. Click 企业登录 -> should open settings at account + attempt login
const primary = await page.$(".sidebar__account-menu-item--primary");
if (primary) {
  await primary.click();
  await page.waitForTimeout(3000);
}
const after = await page.evaluate(() => {
  const modal = document.querySelector(".settings-modal");
  const nav = Array.from(document.querySelectorAll(".settings-navigation__label")).map((n) => n.textContent?.trim());
  const activeNav = Array.from(document.querySelectorAll("[aria-current='page'], .settings-navigation__item--active")).map((n) => n.textContent?.trim());
  return {
    pageErrors: window.__PAGE_ERRORS__ || [],
    settingsOpen: !!modal,
    navItems: nav.slice(0, 20),
    activeNav,
    toasts: Array.from(document.querySelectorAll(".toast, [class*='toast']")).map((t) => t.textContent?.trim().slice(0, 120)).filter(Boolean),
  };
});
console.log("AFTER LOGIN CLICK:", JSON.stringify(after, null, 2));

await app.close();
process.exit(0);
