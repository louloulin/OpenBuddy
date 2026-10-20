import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-cd-"));
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
await page.click(".sidebar__conv");
await page.waitForTimeout(1500);

const r = await page.evaluate(() => {
  const main = document.querySelector(".chatview__main");
  const composer = document.querySelector(".wb-composer");
  const messages = document.querySelector(".chatview__messages, [class*='messages-list'], [class*='chat-list']");
  const welcome = document.querySelector(".chatview__welcome, [class*='welcome']");
  return {
    main: main ? { y: Math.round(main.getBoundingClientRect().y), h: Math.round(main.getBoundingClientRect().height) } : null,
    composer: composer ? { y: Math.round(composer.getBoundingClientRect().y), h: Math.round(composer.getBoundingClientRect().height) } : null,
    messages: messages ? { y: Math.round(messages.getBoundingClientRect().y), h: Math.round(messages.getBoundingClientRect().height) } : null,
    welcome: welcome ? { y: Math.round(welcome.getBoundingClientRect().y), h: Math.round(welcome.getBoundingClientRect().height) } : null,
    emptyState: document.querySelector(".chatview__empty, [class*='empty-state']") ? "found" : null,
  };
});
console.log(JSON.stringify(r, null, 2));
await app.close();
