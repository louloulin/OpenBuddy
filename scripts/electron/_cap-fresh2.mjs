import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-fr2-"));
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

// Start a fresh session
const ta = await page.$('textarea');
await ta.click();
await ta.type('first message');
await page.keyboard.press('Meta+Enter');
await page.waitForTimeout(3000);

// Now delete the message via API directly
const before = await page.evaluate(() => {
  return {
    msgCount: document.querySelectorAll('.msg-wrap').length,
    emptyState: !!document.querySelector('.chatview__empty-state'),
  };
});
console.log("Before:", JSON.stringify(before));

// Click the "edit" button on the first message, then delete the bubble content
// Actually simpler: just click "rewind" or similar to revert
// Or just look at what we have
const after = await page.evaluate(() => {
  const cv = document.querySelector('.chatview');
  return {
    cvHTML: cv?.innerHTML.slice(0, 500),
    msgCount: document.querySelectorAll('.msg-wrap').length,
    emptyState: !!document.querySelector('.chatview__empty-state'),
  };
});
console.log("After:", JSON.stringify(after, null, 2));

await page.screenshot({ path: "/Users/louloulin/Downloads/ob-chat-styled.png" });
await app.close();
