import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-search2-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(14_000);

try {
  await page.click(".main-topbar__search");
  await page.waitForTimeout(2500);
} catch (e) { console.log('click failed', String(e).slice(0, 200)); }

const after = await page.evaluate(() => {
  return {
    modalOpen: !!document.querySelector(".conversation-search-modal__overlay"),
    modalClass: document.querySelector(".conversation-search-modal")?.className,
    visibleModal: !!document.querySelector(".conversation-search-modal:not([style*='display: none'])"),
    pageErrors: window.__PAGE_ERRORS__ || [],
  };
});
console.log(JSON.stringify(after, null, 2));
await app.close();
process.exit(0);
