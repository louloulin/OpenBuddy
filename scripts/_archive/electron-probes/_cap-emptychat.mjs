import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-ec-"));
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

// Create a new empty session
const ta = await page.$('textarea');
if (ta) {
  await ta.click();
  await page.waitForTimeout(300);
}
const m = await page.evaluate(() => {
  const cv = document.querySelector('.chatview');
  if (!cv) return { error: 'no chatview' };
  const scroll = cv.querySelector('.chatview__scroll');
  const inner = scroll?.querySelector('.chatview__inner');
  const status = cv.querySelector('.chatview__status');
  return {
    scrollHeight: scroll?.scrollHeight,
    innerHeight: inner?.scrollHeight,
    innerText: inner?.textContent?.trim().slice(0, 200),
    statusText: status?.textContent?.trim(),
    hasEmptyState: !!cv.querySelector('[class*="empty"], [class*="welcome"]'),
  };
});
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-chat-empty-state.png" });
await app.close();
