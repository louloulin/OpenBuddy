import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17l-"));
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

// 1. open account menu
await page.click(".sidebar__user");
await page.waitForTimeout(600);
const menuVisible = await page.evaluate(() => {
  const m = document.querySelector(".sidebar__account-menu");
  return !!m && m.getBoundingClientRect().width > 0 && document.elementFromPoint(
    m.getBoundingClientRect().left + 40,
    m.getBoundingClientRect().top + m.getBoundingClientRect().height - 12,
  ) !== null;
});
console.log("menuVisible:", menuVisible);

// 2. click 企业登录 → opens settings at 账户管理 with auto-expanded config
await page.evaluate(() => document.querySelector(".sidebar__account-menu-item--primary")?.click());
await page.waitForTimeout(4500);
const step2 = await page.evaluate(() => {
  const modal = document.querySelector(".settings-modal");
  const content = modal?.querySelector(".settings-modal__content");
  return {
    settingsOpen: !!modal,
    activeNav: modal?.querySelector(".settings-navigation__item--active, [aria-current='page']")?.textContent?.trim(),
    contentChars: (content?.textContent ?? "").length,
    casdoorHeadline: (content?.textContent ?? "").includes("Casdoor 企业登录"),
    loginButtons: ["企业账号登录", "短信登录", "微信登录"].every((l) => (content?.textContent ?? "").includes(l)),
    configFormExpanded: (content?.textContent ?? "").includes("Issuer / Server URL"),
    toast: Array.from(document.querySelectorAll(".toast, [class*='toast']")).map((n) => n.textContent?.trim()).filter(Boolean).slice(0, 3),
    errs: window.__ERRS__ ?? [],
  };
});
console.log("STEP2 settings:", JSON.stringify(step2, null, 2));

await page.screenshot({ path: join(ROOT, "tests/screenshots/r17-login-flow.png") });
await app.close();
process.exit(0);
