import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r16e-"));
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

// open menu + click login
await page.$(".sidebar__user").then(b => b.click({ force: true }));
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelector(".sidebar__account-menu-item--primary")?.click());
await page.waitForTimeout(4000);

const panel = await page.evaluate(() => {
  const modal = document.querySelector(".settings-modal");
  if (!modal) return { open: false };
  const activeNav = modal.querySelector(".settings-navigation__item--active, [aria-current='page']")?.textContent?.trim();
  const content = modal.querySelector(".settings-modal__content");
  return {
    open: true,
    activeNav,
    contentText: content?.innerText?.slice(0, 1200),
    buttons: Array.from(content?.querySelectorAll("button") ?? []).map((b) => b.textContent?.trim()).filter(Boolean).slice(0, 25),
    headings: Array.from(content?.querySelectorAll("h1,h2,h3,h4") ?? []).map((h) => h.textContent?.trim()).slice(0, 15),
  };
});
console.log(JSON.stringify(panel, null, 2));
await app.close();
process.exit(0);
