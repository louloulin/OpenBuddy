import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-fr-"));
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(3000);
await page.setViewportSize({ width: 1728, height: 1091 });
await page.waitForTimeout(1500);

// Start session by sending message then deleting it (or just check structure)
// Actually we can't delete a sent message easily. Let me just verify the CSS is loaded.

const m = await page.evaluate(() => {
  // Check if .chatview__empty-state class is defined
  const allElements = document.querySelectorAll('.chatview__empty-state');
  const style = document.querySelector('style')?.textContent || '';
  return {
    elementsWithClass: allElements.length,
    cssContains: style.includes('chatview__empty-state'),
  };
});
console.log(JSON.stringify(m, null, 2));

// Force a fresh empty state by reloading the app and not sending anything
// Then just type in composer but don't send
const ta = await page.$('textarea');
if (ta) {
  await ta.click();
  await ta.type('Just testing the empty state style');
  await page.waitForTimeout(500);
  // Press Escape to not send
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

// Now manually trigger the empty state check via the API
// Use a different approach: check if CSS class has empty state styles
const cssCheck = await page.evaluate(() => {
  const sheets = Array.from(document.styleSheets);
  for (const s of sheets) {
    try {
      for (const r of s.cssRules || []) {
        if (r.selectorText && r.selectorText.includes('chatview__empty-state')) {
          return { found: true, selector: r.selectorText, cssText: r.cssText.slice(0, 200) };
        }
      }
    } catch {}
  }
  return { found: false };
});
console.log("CSS check:", JSON.stringify(cssCheck, null, 2));
await app.close();
