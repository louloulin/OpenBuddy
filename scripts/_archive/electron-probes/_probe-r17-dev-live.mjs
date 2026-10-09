import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });

console.log("[probe] connecting to dev CDP at ws://localhost:9223 ...");
let browser;
try {
  browser = await chromium.connectOverCDP("http://localhost:9223");
} catch (e) {
  console.error("[probe] CDP connect failed:", String(e.message).slice(0, 200));
  process.exit(2);
}
const context = browser.contexts()[0] || await browser.newContext();
const pages = context.pages();
const page = pages.find((p) => !p.url().startsWith("devtools://")) || await context.newPage();
console.log("[probe] attached to", page.url().slice(0, 80));

let errCount = 0;
page.on("pageerror", (e) => { errCount++; console.log("PAGEERROR:", String(e.message).slice(0, 300)); });
page.on("console", (m) => { if (m.type() === "error") console.log("CON-ERR:", m.text().slice(0, 250)); });

// Wait for renderer to be ready (dev server hot loads)
await page.waitForTimeout(15_000);

// Dismiss onboarding if present
const dismissed = await page.evaluate(() => {
  const w = document.querySelector("[data-testid='onboarding-wizard']");
  if (!w) return "no-wizard";
  const btn = w.querySelector("[aria-label='关闭引导']");
  if (!btn) return "no-close-btn";
  (btn).click();
  return "closed";
});
console.log("[probe] onboarding:", dismissed);
await page.waitForTimeout(1500);

const probe = async (label) => {
  const r = await page.evaluate(() => {
    const sidebar = document.querySelector(".sidebar__user");
    const composer = document.querySelector(".wb-composer");
    return {
      sidebarUser: !!sidebar,
      composer: !!composer,
      dataTheme: document.documentElement.getAttribute("data-theme"),
      url: location.pathname,
    };
  });
  console.log(label, JSON.stringify(r));
  return r;
};

await probe("AFTER DISMISS:");

// 1. Account menu
await page.click(".sidebar__user");
await page.waitForTimeout(800);
const menu = await page.evaluate(() => {
  const m = document.querySelector(".sidebar__account-menu");
  if (!m) return { found: false };
  const r = m.getBoundingClientRect();
  return {
    found: true,
    items: Array.from(m.querySelectorAll("[role='menuitem']")).map((b) => b.textContent?.trim()),
    hitInsideMenu: m.contains(document.elementFromPoint(r.left + 40, r.top + m.offsetHeight / 2)),
  };
});
console.log("[probe] account menu:", JSON.stringify(menu));
await page.evaluate(() => document.querySelector(".sidebar__user")?.click());
await page.waitForTimeout(400);

// 2. Settings → personalize → switch to dark
await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(2000);
await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
  const t = items.find((el) => (el.textContent ?? "").includes("个性化"));
  if (t) t.click();
});
await page.waitForTimeout(900);
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll(".theme-toggle__btn"));
  const target = buttons.find((b) => (b.textContent ?? "").includes("深色"));
  if (target) target.click();
});
await page.waitForTimeout(1200);

// 3. Theme picker — switch through a few themes
const themeChange = await page.evaluate(() => {
  const picker = document.querySelector("[class*='ThemePicker'], [class*='theme-picker'], [data-theme-name]");
  if (!picker) return { hasPicker: false };
  return { hasPicker: true, themeName: picker.getAttribute?.("data-theme-name") ?? null };
});
console.log("[probe] theme picker:", JSON.stringify(themeChange));

await page.keyboard.press("Escape");
await page.waitForTimeout(800);

await page.screenshot({ path: join(ROOT, "tests/screenshots/r17-dev-live-dark.png"), fullPage: false });

// 4. Composer dark bg inspection
const composerDark = await page.evaluate(() => {
  const c = document.querySelector(".wb-composer");
  const i = document.querySelector(".wb-composer__input");
  return {
    composerBg: c ? getComputedStyle(c).backgroundColor : null,
    inputBg: i ? getComputedStyle(i).backgroundColor : null,
    dataTheme: document.documentElement.getAttribute("data-theme"),
  };
});
console.log("[probe] composer dark:", JSON.stringify(composerDark));

console.log("[probe] pageerror count:", errCount);
await browser.close();
process.exit(0);
