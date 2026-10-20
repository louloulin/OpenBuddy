import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-tb-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(14_000);
const out = await page.evaluate(() => {
  // Find ALL CSS rules matching exactly .main-topbar (not children)
  const matched = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules || [];
      for (const rule of Array.from(rules)) {
        if (rule.selectorText && rule.selectorText.trim() === ".main-topbar") {
          matched.push({ selector: rule.selectorText, body: rule.cssText });
        }
      }
    } catch (e) {}
  }
  return { matched, count: matched.length };
});
console.log(JSON.stringify(out, null, 2));
await app.close();
process.exit(0);
