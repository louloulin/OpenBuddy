import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-se-"));
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

// Click settings (gear icon in sidebar footer)
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const settingsBtn = buttons.find(b => b.getAttribute('aria-label') === '设置' || b.getAttribute('aria-label') === '设置' || /settings/i.test(b.getAttribute('aria-label') || ''));
  if (settingsBtn) settingsBtn.click();
});
await page.waitForTimeout(2500);

await page.screenshot({ path: "/Users/louloulin/Downloads/ob-r7-settings.png", fullPage: false });

const m = await page.evaluate(() => {
  return {
    title: document.querySelector('h1, h2')?.textContent?.slice(0, 50),
    sections: Array.from(document.querySelectorAll('section, [class*="section"]')).slice(0,5).map(s => s.className?.slice(0, 40)),
    navItems: Array.from(document.querySelectorAll('nav button, .settings-nav-item, [class*="settings-nav"]')).slice(0,8).map(n => n.textContent?.trim().slice(0,20)),
  };
});
console.log(JSON.stringify(m, null, 2));
await app.close();
