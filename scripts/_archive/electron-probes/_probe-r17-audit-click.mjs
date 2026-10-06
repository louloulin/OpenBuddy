import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17ac-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(2500);

// Use Playwright's locator click
const item = page.locator(".settings-navigation__item", { hasText: "审计追踪" });
console.log("VISIBLE:", await item.isVisible());
console.log("COUNT:", await item.count());
await item.click({ timeout: 5000 }).catch((e) => console.log("CLICK ERR:", e.message.slice(0, 200)));
await page.waitForTimeout(2500);

const after = await page.evaluate(() => {
  const p = document.querySelector(".settings-modal__panel");
  const activeNav = document.querySelector(".settings-navigation__item--active");
  return {
    panelExists: !!p,
    panelChildCount: p?.children.length ?? -1,
    activeNav: activeNav?.textContent?.trim() ?? null,
    tableExists: !!p?.querySelector(".audit-trail__table"),
    tableRows: p?.querySelectorAll(".audit-trail__row").length ?? 0,
  };
});
console.log("AFTER:", JSON.stringify(after, null, 2));

await page.screenshot({ path: join(ROOT, "tests/screenshots/r17-audit-panel.png") });
await app.close();
process.exit(0);
