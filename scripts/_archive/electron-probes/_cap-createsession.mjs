import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-cs-"));
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

// Type and send
const ta = await page.$('textarea');
await ta.click();
await ta.type('hello world');
await page.keyboard.press('Meta+Enter');
await page.waitForTimeout(3000);

// Now look at the chat structure
const m = await page.evaluate(() => {
  const cv = document.querySelector('.chatview');
  if (!cv) return { error: 'no chatview' };
  // Get the scroll inner content
  const scrollInner = cv.querySelector('.chatview__inner');
  return {
    scrollInnerHTML: scrollInner?.innerHTML.slice(0, 2000),
    scrollChildren: Array.from(scrollInner?.children || []).map(c => ({
      tag: c.tagName.toLowerCase(),
      cls: c.className?.toString().slice(0, 80),
      text: c.textContent?.trim().slice(0, 60),
    })),
  };
});
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-chat-with-msg.png" });
await app.close();
