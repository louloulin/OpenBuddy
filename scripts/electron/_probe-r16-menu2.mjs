import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r16b-"));
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

// Attach a listener that records clicks
await page.evaluate(() => {
  window.__CLICKS__ = [];
  document.addEventListener("click", (e) => {
    const t = e.target;
    window.__CLICKS__.push({ cls: (t?.className || "").toString().slice(0, 60), tag: t?.tagName });
  }, true);
});

const btn = await page.$(".sidebar__user");
console.log("button found:", !!btn);
if (btn) {
  const box = await btn.boundingBox();
  console.log("button box:", JSON.stringify(box));
  await btn.click({ force: true });
  await page.waitForTimeout(1500);
}

const result = await page.evaluate(() => {
  const m = document.querySelector(".sidebar__account-menu");
  const wrap = document.querySelector(".sidebar__user-wrap");
  return {
    clicks: window.__CLICKS__ || [],
    menuExists: !!m,
    menuHTML: m ? m.outerHTML.slice(0, 500) : null,
    wrapHTML: wrap ? wrap.outerHTML.slice(0, 800) : null,
    ariaExpanded: document.querySelector(".sidebar__user")?.getAttribute("aria-expanded"),
  };
});
console.log(JSON.stringify(result, null, 2));
await app.close();
process.exit(0);
