import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ts-"));
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
await win.evaluate((w) => { w.setContentSize(1728, 1031); });
await page.waitForTimeout(2500);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']").catch(() => {});
await page.waitForTimeout(800);

const before = await page.evaluate(() => {
  const body = document.body;
  const cs = getComputedStyle(body);
  return {
    theme: document.documentElement.getAttribute("data-theme"),
    themeName: document.documentElement.getAttribute("data-theme-name"),
    bg: cs.backgroundColor,
    color: cs.color,
  };
});
console.log("Before:", JSON.stringify(before));

// 打开主题选择
await page.click(".main-topbar [aria-label='切换主题']");
await page.waitForTimeout(800);

// 选 Claude
const claudeBtn = await page.$("[role='menu'] button:has-text('Claude')");
if (claudeBtn) {
  await claudeBtn.click();
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const body = document.body;
    const cs = getComputedStyle(body);
    return {
      theme: document.documentElement.getAttribute("data-theme"),
      themeName: document.documentElement.getAttribute("data-theme-name"),
      bg: cs.backgroundColor,
      color: cs.color,
    };
  });
  console.log("After Claude:", JSON.stringify(after));
  console.log("BG changed:", before.bg !== after.bg, "Color changed:", before.color !== after.color);
}

// 选回 openbuddy
await page.click(".main-topbar [aria-label='切换主题']");
await page.waitForTimeout(800);
const obBtn = await page.$("[role='menu'] button:has-text('OpenBuddy')");
if (obBtn) {
  await obBtn.click();
  await page.waitForTimeout(1500);
  const final = await page.evaluate(() => {
    const body = document.body;
    const cs = getComputedStyle(body);
    return {
      theme: document.documentElement.getAttribute("data-theme"),
      themeName: document.documentElement.getAttribute("data-theme-name"),
      bg: cs.backgroundColor,
      color: cs.color,
    };
  });
  console.log("After OpenBuddy:", JSON.stringify(final));
}

await app.close();
