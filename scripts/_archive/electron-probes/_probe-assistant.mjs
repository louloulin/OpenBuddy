import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-asst-"));
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

await page.click(".sidebar__nav-item:nth-child(2)");
await page.waitForTimeout(1200);

const r = await page.evaluate(() => {
  // 找 "本地助理已连接" 文本
  const allText = document.body.textContent;
  const idx = allText.indexOf("本地助理已连接");
  const before = idx >= 0 ? allText.substring(Math.max(0, idx - 20), idx + 100) : null;
  return { snippet: before, fullText: allText.substring(0, 1000) };
});
console.log(JSON.stringify(r, null, 2));
await app.close();
