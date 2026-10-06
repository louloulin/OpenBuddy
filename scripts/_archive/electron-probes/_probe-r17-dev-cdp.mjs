import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });

const browser = await chromium.connectOverCDP("http://localhost:9223");
const context = browser.contexts()[0];
const page = context?.pages()[0] || await context.newPage();

page.on("pageerror", (e) => console.log("PAGEERROR:", String(e.message).slice(0, 400)));
page.on("console", (m) => { if (m.type() === "error") console.log("CON-ERR:", m.text().slice(0, 300)); });

await page.waitForTimeout(15_000);
// dismiss onboarding
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1200);

const result = {};

// 1. Sidebar user click → menu
await page.click(".sidebar__user");
await page.waitForTimeout(800);
result.accountMenu = await page.evaluate(() => {
  const m = document.querySelector(".sidebar__account-menu");
  if (!m) return { found: false };
  const r = m.getBoundingClientRect();
  return {
    found: true,
    hitInside: m.contains(document.elementFromPoint(r.left + 40, r.top + m.offsetHeight / 2)),
    items: Array.from(m.querySelectorAll("[role='menuitem']")).map((b) => b.textContent?.trim()),
  };
});
// close
await page.evaluate(() => document.querySelector(".sidebar__user")?.click());
await page.waitForTimeout(400);

// 2. Settings → audit
await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll(".settings-navigation__item"));
  const t = buttons.find((el) => (el.textContent ?? "").trim() === "审计追踪");
  if (t) t.click();
});
await page.waitForTimeout(2500);

result.audit = await page.evaluate(() => {
  const p = document.querySelector(".settings-modal__panel");
  if (!p) return { found: false };
  return {
    found: true,
    title: p.querySelector("h2, h3")?.textContent?.trim(),
    rows: p.querySelectorAll(".audit-trail__row").length,
    activeNav: document.querySelector(".settings-navigation__item--active")?.textContent?.trim(),
  };
});

await page.screenshot({ path: join(ROOT, "tests/screenshots/r17-dev-cdp.png") });
console.log("DEV CDP:", JSON.stringify(result, null, 2));

await browser.close();
process.exit(0);
