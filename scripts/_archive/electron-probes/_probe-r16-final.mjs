import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r16f-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.addInitScript(() => {
  window.__PAGE_ERRORS__ = [];
  window.addEventListener("error", (e) => window.__PAGE_ERRORS__.push(String(e.error?.message ?? e.message)));
  window.addEventListener("unhandledrejection", (e) => window.__PAGE_ERRORS__.push("UR: " + String(e.reason?.message ?? e.reason)));
});
await page.waitForTimeout(14_000);
try { await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {}); } catch {}
await page.waitForTimeout(1500);

// STEP 1 — pill removed?
const step1 = await page.evaluate(() => {
  const el = document.querySelector(".status-indicator--builtin");
  const r = el?.getBoundingClientRect();
  return { cls: el?.className, w: r ? Math.round(r.width) : null, h: r ? Math.round(r.height) : null, visibleText: el?.textContent?.trim() ?? "" };
});
console.log("STEP1 pill:", JSON.stringify(step1));

// STEP 2 — account menu opens with login entry
await page.$(".sidebar__user").then(b => b.click({ force: true }));
await page.waitForTimeout(1000);
const step2 = await page.evaluate(() => {
  const m = document.querySelector(".sidebar__account-menu");
  return { open: !!m, items: m ? Array.from(m.querySelectorAll("[role='menuitem']")).map(b => b.textContent?.trim()) : [] };
});
console.log("STEP2 menu:", JSON.stringify(step2));

// STEP 3 — clicking 企业登录 opens settings at 账户管理 with login buttons
await page.evaluate(() => document.querySelector(".sidebar__account-menu-item--primary")?.click());
await page.waitForTimeout(4000);
const step3 = await page.evaluate(() => {
  const modal = document.querySelector(".settings-modal");
  const content = modal?.querySelector(".settings-modal__content");
  return {
    settingsOpen: !!modal,
    activeNav: modal?.querySelector(".settings-navigation__item--active, [aria-current='page']")?.textContent?.trim(),
    buttons: Array.from(content?.querySelectorAll("button") ?? []).map(b => b.textContent?.trim()).filter(Boolean).slice(0, 15),
    loginButtonsVisible: ["企业账号登录", "短信登录", "微信登录"].every((label) => (content?.textContent ?? "").includes(label)),
  };
});
console.log("STEP3 settings:", JSON.stringify(step3, null, 2));

await page.screenshot({ path: join(ROOT, "tests/screenshots", "r16-account-panel.png") });

// STEP 4 — click 企业账号登录 (unconfigured -> expands config)
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll(".settings-modal__content button")).find(b => b.textContent?.trim() === "企业账号登录");
  btn?.click();
});
await page.waitForTimeout(1500);
const step4 = await page.evaluate(() => {
  const content = document.querySelector(".settings-modal__content");
  return {
    configFieldsVisible: (content?.textContent ?? "").includes("Issuer / Server URL"),
    pageErrors: window.__PAGE_ERRORS__ || [],
  };
});
console.log("STEP4 login click:", JSON.stringify(step4));

await app.close();
process.exit(0);
