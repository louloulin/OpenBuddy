import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-bc-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(2500);
const win = await app.browserWindow(page);
await win.evaluate((w) => { w.setContentSize(1728, 1091); });
await page.waitForTimeout(2000);

await page.evaluate(() => {
  document.documentElement.setAttribute('data-theme', 'light');
});
await page.waitForTimeout(500);

await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const newBtn = buttons.find(b => /新建|new/i.test(b.textContent || b.getAttribute('aria-label') || ''));
  if (newBtn) newBtn.click();
});
await page.waitForTimeout(2000);

const ta = await page.locator('.wb-composer textarea').first();
await ta.fill('测试');
await ta.press('Enter');
await page.waitForTimeout(2000);

// Check the CSS variable values at the bubble's scope
const m = await page.evaluate(() => {
  const bubble = document.querySelector('.msg__bubble');
  if (!bubble) return null;
  const cs = getComputedStyle(bubble);
  const root = document.documentElement;
  const rootCs = getComputedStyle(root);
  return {
    bubbleBg: cs.backgroundColor,
    bubbleComputed: cs.getPropertyValue('background-color'),
    rootBgSecondary: rootCs.getPropertyValue('--wb-bg-secondary'),
    rootPaletteGray2: rootCs.getPropertyValue('--wb-palette-gray-2'),
    rootColorBgSecondary: rootCs.getPropertyValue('--wb-color-bg-secondary-hover-active'),
    // Walk up the tree to find var defs
    bubbleScopeBgSecondary: getComputedStyle(bubble.parentElement?.parentElement?.parentElement?.parentElement || document.body).getPropertyValue('--wb-bg-secondary'),
    // Find first defined parent
    parentsWithDef: ['html', 'body', 'main', '.app__main', '.chatview', '.timeline'].map(sel => {
      const el = document.querySelector(sel);
      if (!el) return { sel, bgSecondary: null };
      return { sel, bgSecondary: getComputedStyle(el).getPropertyValue('--wb-bg-secondary') };
    }),
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
