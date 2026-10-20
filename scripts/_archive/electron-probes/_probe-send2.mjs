import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-send2-"));
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

// Find composer
const composerInfo = await page.evaluate(() => {
  const ta = document.querySelector(".wb-composer textarea");
  const ce = document.querySelector(".wb-composer [contenteditable='true']");
  const sendBtn = document.querySelector("[aria-label*='发送'], [aria-label*='send']");
  return {
    hasTextarea: !!ta,
    hasContentEditable: !!ce,
    taValue: ta ? ta.value : null,
    ceText: ce ? ce.textContent : null,
    sendBtn: sendBtn ? { aria: sendBtn.getAttribute("aria-label"), disabled: sendBtn.disabled, cls: sendBtn.className } : null,
  };
});
console.log("Composer info:", JSON.stringify(composerInfo, null, 2));

// Try Enter key on textarea
if (composerInfo.hasTextarea) {
  await page.focus(".wb-composer textarea");
  await page.keyboard.type("Test message via Enter key");
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3000);
}

// Check after Enter
const after = await page.evaluate(() => {
  const ta = document.querySelector(".wb-composer textarea");
  return {
    taValue: ta ? ta.value : null,
    msgCount: document.querySelectorAll(".chat-message, [class*='message']").length,
    activeSession: !!document.querySelector(".main-topbar__title-edit"),
  };
});
console.log("After Enter:", JSON.stringify(after));

await app.close();
