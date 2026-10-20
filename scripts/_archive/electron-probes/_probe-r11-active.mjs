import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-r11b-"));
mkdirSync("/tmp/ob-r11b", { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, projectRoot],
  executablePath: join(projectRoot, "node_modules", ".bin", "electron"),
  cwd: projectRoot, timeout: 40000,
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

await page.click(".sidebar__footer [aria-label='通知']");
await page.waitForTimeout(1500);

const activeSection = await page.evaluate(() => {
  const active = document.querySelector(".settings-modal-overlay .settings-navigation__item--active, .settings-modal-overlay [aria-current='page'], .settings-modal-overlay [aria-current='true']");
  return active?.textContent?.trim();
});
console.log("Active section after 通知 click:", activeSection);

// Check the body content
const bodyContent = await page.evaluate(() => {
  const body = document.querySelector(".settings-modal-overlay .settings-panel__body, .settings-modal-overlay .settings-modal__body, .settings-modal-overlay main, .settings-modal-overlay section");
  return body?.textContent?.replace(/\s+/g, " ").trim().slice(0, 300);
});
console.log("Body content:", bodyContent);

// Take a screenshot
await page.screenshot({ path: "/tmp/ob-r11b/after-notif.png" });

// Now try 设置
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
await page.click(".sidebar__footer [aria-label='设置']");
await page.waitForTimeout(1500);

const activeSection2 = await page.evaluate(() => {
  const active = document.querySelector(".settings-modal-overlay .settings-navigation__item--active, .settings-modal-overlay [aria-current='page'], .settings-modal-overlay [aria-current='true']");
  return active?.textContent?.trim();
});
console.log("\nActive section after 设置 click:", activeSection2);

await app.close();
