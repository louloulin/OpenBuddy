import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-emp-"));
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

// Start a chat via composer
const ta = await page.$('textarea');
await ta.click();
await ta.type('x');
await page.keyboard.press('Meta+Enter');
await page.waitForTimeout(3000);

// Look at the chat empty state
const m = await page.evaluate(() => {
  const es = document.querySelector('.chatview__empty-state');
  const cv = document.querySelector('.chatview');
  return {
    hasEmptyState: !!es,
    emptyStateRect: es ? (() => { const r = es.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; })() : null,
    chatviewRect: cv ? (() => { const r = cv.getBoundingClientRect(); return {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}; })() : null,
    title: es?.querySelector('.chatview__empty-state-title')?.textContent,
    tagCount: es?.querySelectorAll('.chatview__empty-state-tag').length,
    kbdCount: es?.querySelectorAll('kbd').length,
  };
});
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: "/Users/louloulin/Downloads/ob-chat-empty-styled.png" });
await app.close();
