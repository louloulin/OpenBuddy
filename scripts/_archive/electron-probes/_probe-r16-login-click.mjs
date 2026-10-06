import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r16c-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.addInitScript(() => {
  window.__PAGE_ERRORS__ = [];
  window.addEventListener("error", (e) => window.__PAGE_ERRORS__.push(String(e.error?.message ?? e.message)));
});
await page.waitForTimeout(14_000);
try { await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {}); } catch {}
await page.waitForTimeout(1500);

// open menu
const btn = await page.$(".sidebar__user");
await btn.click({ force: true });
await page.waitForTimeout(1000);

// click 企业登录
const primary = await page.$(".sidebar__account-menu-item--primary");
console.log("primary found:", !!primary, primary ? (await primary.textContent()) : "");
if (primary) {
  await primary.click({ force: true });
  await page.waitForTimeout(4000);
}

const after = await page.evaluate(() => {
  const modal = document.querySelector(".settings-modal");
  return {
    pageErrors: window.__PAGE_ERRORS__ || [],
    settingsOverlay: !!document.querySelector(".settings-modal-overlay"),
    settingsModal: !!modal,
    navLabels: Array.from(document.querySelectorAll(".settings-navigation__label")).map((n) => n.textContent?.trim()).slice(0, 30),
    activeNav: document.querySelector(".settings-navigation__item--active, [aria-current='page']")?.textContent?.trim(),
    toasts: Array.from(document.querySelectorAll(".toast-stack *")).map((t) => t.textContent?.trim()).filter(Boolean).slice(0, 3),
    bodyText: document.body.innerText.split("\n").filter((l) => l.includes("Casdoor") || l.includes("企业") || l.includes("登录")).slice(0, 10),
  };
});
console.log(JSON.stringify(after, null, 2));
await app.close();
process.exit(0);
