import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-send-"));
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

// 进入第一个 session
const firstSession = await page.$(".sidebar__conv");
if (firstSession) {
  await firstSession.click();
  await page.waitForTimeout(1500);
}

// 输入消息
const composer = await page.$(".wb-composer textarea, .wb-composer [contenteditable='true'], .chatview textarea, .chatview [contenteditable='true']");
if (composer) {
  await composer.fill("你好,这是测试消息");
  await page.waitForTimeout(500);
  
  const r = await page.evaluate(() => {
    const btn = document.querySelector("[aria-label*='发送'], [aria-label*='Send'], button[type='submit']");
    if (btn) btn.click();
    return { hasSendBtn: !!btn };
  });
  console.log("After fill:", JSON.stringify(r));
  await page.waitForTimeout(2000);
  
  // 检查是否生成了新消息
  const after = await page.evaluate(() => {
    const messages = document.querySelectorAll(".chat-message, [class*='message']");
    return {
      msgCount: messages.length,
      composerEmpty: (() => {
        const ta = document.querySelector(".wb-composer textarea");
        return ta ? ta.value === "" : null;
      })(),
      pageErrors: window.__PAGE_ERRORS__ || [],
    };
  });
  console.log("After send:", JSON.stringify(after));
}

await app.close();
