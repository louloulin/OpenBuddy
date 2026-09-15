import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-dka-"));
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

await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
await page.waitForTimeout(1000);

await page.screenshot({ path: "/Users/louloulin/Downloads/dark-home.png" });

// Open chat
const ta = await page.$('textarea');
await ta.click();
await ta.type('测试消息');
await page.keyboard.press('Meta+Enter');
await page.waitForTimeout(3000);
await page.screenshot({ path: "/Users/louloulin/Downloads/dark-chat.png" });

await app.close();
console.log("done");
