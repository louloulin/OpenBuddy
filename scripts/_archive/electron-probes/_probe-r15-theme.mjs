import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r15-t-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(14_000);

// Theme picker button check
const themeBtns = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("button")).filter((b) => {
    const label = (b.getAttribute("aria-label") || "").toLowerCase();
    return label.includes("主题") || label.includes("theme") || label.includes("切换主题");
  }).map((b) => {
    const r = b.getBoundingClientRect();
    return { ariaLabel: b.getAttribute("aria-label"), dataTip: b.getAttribute("data-tip"), cls: b.className.toString().slice(0, 60), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
});
console.log("THEME BTNS:", JSON.stringify(themeBtns, null, 2));

// Click the theme menu button (try several selectors)
const candidates = [".theme-menu-button", "[data-testid='theme-menu-button']", "[aria-label*='主题']", "[aria-label*='theme']"];
for (const sel of candidates) {
  try {
    await page.click(sel, { timeout: 1500 });
    await page.waitForTimeout(2000);
    const opened = await page.evaluate(() => {
      // Look for any theme picker popup
      const popups = Array.from(document.querySelectorAll(".theme-picker, [class*='ThemePicker'], [class*='theme-picker'], [data-theme-popup]"));
      return popups.map(p => ({ cls: p.className.toString().slice(0, 60), childCount: p.children.length }));
    });
    console.log("OPENED:", sel, JSON.stringify(opened));
    break;
  } catch (e) {}
}

await app.close();
process.exit(0);
