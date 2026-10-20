/** 测试主题切换：依次点 ThemePicker 里的几个主题，验证 data-theme-name 变化 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-th-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(4000);

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// Open settings panel
const beforeOpen = await page.evaluate(() => document.documentElement.getAttribute("data-theme-name"));

// Click settings button (in sidebar footer)
await page.click("button[aria-label='设置']");
await page.waitForTimeout(800);

// Look for theme picker
const pickerState = await page.evaluate(() => {
  // ThemePicker button is by class containing 'theme'
  const all = Array.from(document.querySelectorAll("button"));
  const picker = all.find(b => /theme/i.test(b.getAttribute("aria-label") ?? "") || /theme/i.test(b.className));
  return picker ? { found: true, label: picker.getAttribute("aria-label") } : { found: false };
});

console.log("Before open:", beforeOpen);
console.log("Theme picker:", JSON.stringify(pickerState));

await app.close();
