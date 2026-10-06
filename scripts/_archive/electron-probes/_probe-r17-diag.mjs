import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17d-"));
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
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE-ERR:", m.text().slice(0, 300)); });
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e.message).slice(0, 300)));
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

const before = await page.evaluate(() => ({
  modalOpenBefore: !!document.querySelector(".settings-modal"),
  userBtnExists: !!document.querySelector(".sidebar__user"),
  userBtnText: document.querySelector(".sidebar__user")?.innerText,
  footerHTML: document.querySelector(".sidebar__footer")?.outerHTML?.slice(0, 400),
}));
console.log("BEFORE:", JSON.stringify(before, null, 2));

await page.click(".sidebar__user", { force: true });
await page.waitForTimeout(200);

const t1 = await page.evaluate(() => ({ menu1: !!document.querySelector(".sidebar__account-menu"), modal1: !!document.querySelector(".settings-modal") }));
console.log("T+0.2s:", JSON.stringify(t1));

await page.waitForTimeout(1500);
const t2 = await page.evaluate(() => {
  const content = document.querySelector(".settings-modal__content");
  return {
    menu2: !!document.querySelector(".sidebar__account-menu"),
    modal2: !!document.querySelector(".settings-modal"),
    contentText: (content?.textContent ?? "").slice(0, 200),
    contentChildCount: content?.children.length ?? -1,
    contentHTML: (content?.innerHTML ?? "").slice(0, 300),
    errs: window.__ERRS__ ?? [],
  };
});
console.log("T+1.7s:", JSON.stringify(t2, null, 2));
await page.screenshot({ path: join(ROOT, "tests/screenshots", "r17-diag.png") });
await app.close();
process.exit(0);
