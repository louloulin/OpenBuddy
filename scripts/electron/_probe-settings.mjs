import { _electron as electron } from "playwright";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-set-"));
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

// Open settings (footer 设置 button)
await page.click(".sidebar__footer .sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(1000);

const settings = await page.evaluate(() => {
  const dialog = document.querySelector("[role='dialog']");
  if (!dialog) return { error: "no dialog" };
  const r = dialog.getBoundingClientRect();
  // 找左侧 nav items (settings 的 section nav)
  const navItems = Array.from(dialog.querySelectorAll("button, [role='tab'], nav a, nav button")).map(el => ({
    tag: el.tagName,
    text: el.textContent.trim().slice(0, 30),
    aria: el.getAttribute("aria-label") || "",
  })).filter(o => o.text.length > 0).slice(0, 30);
  return { rect: { w: Math.round(r.width), h: Math.round(r.height) }, navItems };
});
console.log("Settings panel:", JSON.stringify(settings, null, 2));

await app.close();
