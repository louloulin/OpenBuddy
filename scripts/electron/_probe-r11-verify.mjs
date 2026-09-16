import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-r11-"));
mkdirSync("/tmp/ob-r11", { recursive: true });

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

await page.screenshot({ path: "/tmp/ob-r11/home.png" });

// Inspect footer state
const footer = await page.evaluate(() => {
  const f = document.querySelector(".sidebar__footer");
  const userBtn = f?.querySelector(".sidebar__user");
  const notif = f?.querySelector("[aria-label='通知']");
  const settings = f?.querySelector("[aria-label='设置']");
  const statusInd = f?.querySelector(".status-indicator");
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  return {
    footer: r(f),
    userBtn: { rect: r(userBtn), dataTip: userBtn?.getAttribute("data-tip"), aria: userBtn?.getAttribute("aria-label") },
    notif: { rect: r(notif), dataTip: notif?.getAttribute("data-tip") },
    settings: { rect: r(settings), dataTip: settings?.getAttribute("data-tip") },
    statusInd: { rect: r(statusInd), cls: statusInd?.className, text: statusInd?.textContent?.trim().slice(0, 50) },
  };
});
console.log("=== R11 Footer State ===");
console.log(JSON.stringify(footer, null, 2));

// Click 通知 → verify it goes to notifications section
await page.click(".sidebar__footer [aria-label='通知']");
await page.waitForTimeout(1200);
const notifResult = await page.evaluate(() => {
  const dialog = document.querySelector("[role='dialog'], .settings-modal-overlay");
  if (!dialog) return { dialogVisible: false };
  // Check if "通知中心" heading or section is visible
  const allText = dialog.textContent || "";
  const hasNotifications = allText.includes("通知中心");
  const activeSection = dialog.querySelector(".settings-nav__item--active, [aria-current='true']")?.textContent?.trim();
  return {
    dialogVisible: true,
    dialogClass: dialog.className?.toString().slice(0, 60),
    hasNotifications,
    activeSection,
    textSnippet: allText.replace(/\s+/g, " ").slice(0, 100),
  };
});
console.log("\n=== Click 通知 ===");
console.log(JSON.stringify(notifResult, null, 2));
await page.keyboard.press("Escape");
await page.waitForTimeout(800);

// Click 设置 → verify it goes to default section (model)
await page.click(".sidebar__footer [aria-label='设置']");
await page.waitForTimeout(1200);
const setResult = await page.evaluate(() => {
  const dialog = document.querySelector("[role='dialog'], .settings-modal-overlay");
  if (!dialog) return { dialogVisible: false };
  return {
    dialogVisible: true,
    textSnippet: (dialog.textContent || "").replace(/\s+/g, " ").slice(0, 100),
  };
});
console.log("\n=== Click 设置 ===");
console.log(JSON.stringify(setResult, null, 2));
await page.keyboard.press("Escape");
await page.waitForTimeout(800);

// Verify user button shows tooltip
const userTip = await page.evaluate(() => {
  const btn = document.querySelector(".sidebar__user");
  return { dataTip: btn?.getAttribute("data-tip") };
});
console.log("\n=== User button tooltip ===");
console.log(JSON.stringify(userTip, null, 2));

await app.close();
