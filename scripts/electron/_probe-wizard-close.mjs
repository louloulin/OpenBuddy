import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-wc-"));
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

// 关闭引导
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']");
await page.waitForTimeout(500);

const afterClose = await page.evaluate(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith("openbuddy.")) out[k] = localStorage.getItem(k);
  }
  return out;
});
console.log("After 关闭引导 (close):", JSON.stringify(afterClose));

// Walk through wizard: open settings, find way to "重新观看" or trigger wizard
// 实际上看下一步流程
// 第二轮:通过「下一步」走完
await page.evaluate(() => {
  // 重新打开 wizard by clearing localStorage
  localStorage.removeItem("openbuddy.onboarding.wizard");
});
await page.reload();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForTimeout(3000);
const wizard2 = await page.evaluate(() => !!document.querySelector("[data-testid='onboarding-wizard']"));
console.log("Wizard after reload:", wizard2);

if (wizard2) {
  // Walk: 下一步 → 下一步 → 完成/开始
  for (let i = 0; i < 2; i++) {
    const next = await page.$("[data-testid='onboarding-wizard'] button:has-text('下一步'), [data-testid='onboarding-wizard'] button:has-text('Next')");
    if (next) {
      await next.click();
      await page.waitForTimeout(800);
    }
  }
  const finish = await page.$("[data-testid='onboarding-wizard'] button:has-text('完成'), [data-testid='onboarding-wizard'] button:has-text('开始')");
  if (finish) {
    await finish.click();
    await page.waitForTimeout(2000);
  }
}

const afterFinish = await page.evaluate(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith("openbuddy.")) out[k] = localStorage.getItem(k);
  }
  return { ls: out, tourVisible: !!document.querySelector("[data-testid='tour-spotlight']") };
});
console.log("After walk-through:", JSON.stringify(afterFinish, null, 2));

await app.close();
