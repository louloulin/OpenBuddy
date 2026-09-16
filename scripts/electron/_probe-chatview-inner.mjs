import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-cvi-"));
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

const firstSession = await page.$(".sidebar__conv");
if (firstSession) {
  await firstSession.click();
  await page.waitForTimeout(1500);
}

const r = await page.evaluate(() => {
  const main = document.querySelector(".chatview__main");
  if (!main) return { error: "no chatview__main" };
  const r = main.getBoundingClientRect();
  const kids = Array.from(main.children).map(c => {
    const cr = c.getBoundingClientRect();
    return { tag: c.tagName, cls: c.className.toString().slice(0, 60), y: Math.round(cr.y), h: Math.round(cr.height), text: c.textContent.trim().slice(0, 80) };
  });
  // Find specific areas
  const messageList = document.querySelector(".chatview__messages, [class*='messages'], [class*='message-list']");
  const welcome = document.querySelector(".chatview__welcome, [class*='welcome']");
  return {
    main: { y: Math.round(r.y), h: Math.round(r.height) },
    kids,
    hasMessages: !!messageList,
    hasWelcome: !!welcome,
    pageErrors: window.__PAGE_ERRORS__ || [],
  };
});
console.log(JSON.stringify(r, null, 2));
await app.close();
