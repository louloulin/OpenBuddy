import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17smoke-"));
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

const result = {};

// 1. Sidebar user click → menu opens
await page.click(".sidebar__user");
await page.waitForTimeout(800);
result.accountMenu = await page.evaluate(() => {
  const m = document.querySelector(".sidebar__account-menu");
  if (!m) return { found: false };
  const r = m.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + 40, r.top + m.offsetHeight / 2);
  return { found: true, hitInsideMenu: m.contains(top), items: Array.from(m.querySelectorAll("[role='menuitem']")).map((b) => b.textContent?.trim()) };
});
// close
await page.evaluate(() => document.querySelector(".sidebar__user")?.click());
await page.waitForTimeout(400);

// 2. Settings > 个性化 → ThemePicker + ThemeStudio
await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(1500);
result.personalize = await (async () => {
  const nav = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".settings-navigation__item, .settings-navigation__label"));
    const personalize = items.find((el) => (el.textContent ?? "").includes("个性化"));
    if (personalize) (personalize).click();
    return personalize?.textContent?.trim() ?? null;
  });
  await page.waitForTimeout(900);
  const panelInfo = await page.evaluate(() => {
    const panel = document.querySelector(".settings-modal__panel");
    if (!panel) return { found: false };
    const text = panel.textContent ?? "";
    return {
      found: true,
      hasThemePicker: !!panel.querySelector("[class*='ThemePicker'], [class*='theme-picker'], [class*='menu']") || text.includes("主题") || text.includes("主题库") || text.includes("Theme Studio"),
      hasThemeStudio: text.includes("Theme Studio") || text.includes("OKLCh"),
      bodyChars: text.length,
      themeNames: (text.match(/(claude|openbuddy|sakura|cyber|aurora|matrix|win95|winxp|apple)/gi) ?? []).slice(0, 8),
    };
  });
  return { nav: nav, panel: panelInfo };
})();
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

await page.screenshot({ path: join(ROOT, "tests/screenshots/r17-smoke2.png") });
result.errors = await page.evaluate(() => window.__ERRS__ ?? []);
console.log("SMOKE:", JSON.stringify(result, null, 2));
await app.close();
process.exit(0);
