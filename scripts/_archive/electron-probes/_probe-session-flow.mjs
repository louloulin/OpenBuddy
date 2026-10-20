import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-flow-"));
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

// 检查 sidebar 中第一个 session item
const beforeClick = await page.evaluate(() => {
  const items = document.querySelectorAll(".sidebar__conv");
  return { count: items.length, first: items[0] ? { text: items[0].textContent.trim().slice(0, 30), y: Math.round(items[0].getBoundingClientRect().y) } : null };
});
console.log("Sessions in sidebar:", JSON.stringify(beforeClick));

// 点击第一个 session
const firstSession = await page.$(".sidebar__conv");
if (firstSession) {
  await firstSession.click();
  await page.waitForTimeout(1500);
  
  const afterClick = await page.evaluate(() => {
    const main = document.querySelector("main#main-content");
    return {
      activeSession: !!document.querySelector(".main-topbar__title-edit"),
      title: document.querySelector(".main-topbar__title")?.textContent.trim().slice(0, 50),
      mainKids: main ? Array.from(main.children).map(c => c.tagName + "." + c.className.toString().slice(0, 60)) : [],
      composer: !!document.querySelector(".wb-composer textarea, [contenteditable='true']"),
      hasMessages: document.querySelectorAll(".chat-message, [class*='message']").length,
      pageErrors: window.__PAGE_ERRORS__ || [],
    };
  });
  console.log("After session click:", JSON.stringify(afterClick, null, 2));
}

await app.close();
