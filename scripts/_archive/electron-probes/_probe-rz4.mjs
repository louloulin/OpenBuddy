import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-rz4-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15_000);

// Don't dismiss onboarding - just check what's there
const initial = await page.evaluate(() => {
  return {
    body: document.body.children.length,
    bodyClasses: document.body.className,
    htmlClasses: document.documentElement.className,
    firstFew: Array.from(document.body.children).slice(0, 5).map(el => ({
      tag: el.tagName,
      cls: (el.className || "").toString().slice(0, 60),
      id: el.id,
    })),
  };
});
console.log("INITIAL:", JSON.stringify(initial, null, 2));

// Try to dismiss
const closeBtn = await page.$("[data-testid='onboarding-wizard'] [aria-label='关闭引导']");
console.log("CLOSE_BTN:", !!closeBtn);
if (closeBtn) {
  await closeBtn.click();
  await page.waitForTimeout(2000);
}

const afterClose = await page.evaluate(() => {
  return {
    body: document.body.children.length,
    firstFew: Array.from(document.body.children).slice(0, 5).map(el => ({
      tag: el.tagName,
      cls: (el.className || "").toString().slice(0, 60),
      id: el.id,
    })),
    asideCount: document.querySelectorAll("aside").length,
    asideClasses: Array.from(document.querySelectorAll("aside")).map(a => (a.className || "").toString().slice(0, 60)),
  };
});
console.log("AFTER_CLOSE:", JSON.stringify(afterClose, null, 2));

await app.close();
process.exit(0);
