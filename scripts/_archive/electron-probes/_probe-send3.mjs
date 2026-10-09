import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-send3-"));
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

// Find ALL buttons in composer
const allBtns = await page.evaluate(() => {
  const composer = document.querySelector(".wb-composer");
  if (!composer) return { error: "no composer" };
  const btns = Array.from(composer.querySelectorAll("button")).map(b => ({
    aria: b.getAttribute("aria-label") || "",
    text: (b.textContent||"").trim().slice(0, 30),
    cls: b.className.toString().slice(0, 60),
    disabled: b.disabled,
  }));
  return { btns };
});
console.log("All composer buttons:", JSON.stringify(allBtns, null, 2));

// Type a real message
const ta = await page.$(".wb-composer textarea");
if (ta) {
  await ta.focus();
  await page.keyboard.type("测试消息");
  await page.waitForTimeout(500);
  const beforeSend = await page.evaluate(() => {
    const ta = document.querySelector(".wb-composer textarea");
    return { value: ta?.value };
  });
  console.log("Before send click:", JSON.stringify(beforeSend));
  
  // Click the actual send button (usually in composer-actions or similar)
  await page.click(".wb-composer button[aria-label*='发送']").catch(() => {});
  await page.waitForTimeout(2000);
  
  const afterSend = await page.evaluate(() => {
    const ta = document.querySelector(".wb-composer textarea");
    const all = document.querySelectorAll(".wb-composer button");
    const messageArea = document.querySelector(".chatview, .messages, [class*='message']");
    return {
      taValue: ta?.value,
      btnCount: all.length,
      msgAreaText: messageArea?.textContent.trim().slice(0, 100),
    };
  });
  console.log("After send click:", JSON.stringify(afterSend));
}

await app.close();
