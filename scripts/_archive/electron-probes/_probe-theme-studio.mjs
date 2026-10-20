/**
 * Theme Studio 真实 Electron 验证 — 滑块拖动 → 实时变更 → 导出 → 重新导入 round-trip。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-studio-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const outDir = join(ROOT, "tests/screenshots/r18-studio");
mkdirSync(outDir, { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));

await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

// Open settings → 个性化
await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
  const t = items.find((el) => (el.textContent ?? "").includes("个性化"));
  if (t) t.click();
});
await page.waitForTimeout(1200);

// Click Theme Studio "打开"
const opened = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll("button"));
  const btn = buttons.find((b) => (b.textContent ?? "").trim() === "打开");
  if (!btn) return false;
  btn.click();
  return true;
});
console.log("STUDIO_OPENED:", opened);
await page.waitForTimeout(1500);

// Check ThemeStudio visible
const studioInfo = await page.evaluate(() => {
  const sliders = document.querySelectorAll("input[type='range']");
  const inputs = document.querySelectorAll("input[type='number'], input[type='text']");
  return {
    sliderCount: sliders.length,
    inputCount: inputs.length,
    studioLabel: Array.from(document.querySelectorAll("h2, h3, .settings-section__title, .studio__title")).map((e) => e.textContent?.slice(0, 40)).filter(Boolean),
  };
});
console.log("STUDIO_INFO:", JSON.stringify(studioInfo, null, 2));

// Move first 3 sliders
const sliderResults = await page.evaluate(() => {
  const sliders = Array.from(document.querySelectorAll("input[type='range']"));
  const results = [];
  for (let i = 0; i < Math.min(3, sliders.length); i++) {
    const s = sliders[i];
    const oldValue = s.value;
    const newValue = String(Math.min(Number(s.max ?? 100), Number(oldValue) + 5));
    s.value = newValue;
    s.dispatchEvent(new Event("input", { bubbles: true }));
    s.dispatchEvent(new Event("change", { bubbles: true }));
    results.push({ idx: i, oldValue, newValue, min: s.min, max: s.max });
  }
  return results;
});
console.log("SLIDER_MOVE:", JSON.stringify(sliderResults, null, 2));
await page.waitForTimeout(800);

// Check the live theme variables changed
const liveTheme = await page.evaluate(() => {
  const root = document.documentElement;
  return {
    bgPrimary: getComputedStyle(root).getPropertyValue("--wb-bg-primary").trim(),
    bgElevated: getComputedStyle(root).getPropertyValue("--wb-bg-elevated").trim(),
    dataThemeName: root.getAttribute("data-theme-name"),
  };
});
console.log("LIVE_THEME_AFTER_SLIDER:", JSON.stringify(liveTheme, null, 2));
await page.screenshot({ path: join(outDir, "studio-after-slider.png") });

// Try to export JSON
const exportJson = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll("button"));
  const exportBtn = buttons.find((b) => /export|导出/i.test(b.textContent ?? ""));
  if (!exportBtn) return { found: false };
  exportBtn.click();
  return { found: true, label: exportBtn.textContent?.trim() };
});
console.log("EXPORT:", JSON.stringify(exportJson));

await page.waitForTimeout(800);
// Check localStorage for exported theme
const stored = await page.evaluate(() => {
  const all = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k?.startsWith("openbuddy.theme.custom")) all[k] = window.localStorage.getItem(k);
  }
  return all;
});
console.log("LOCAL_STORAGE_THEME:", JSON.stringify(stored, null, 2));

console.log("ERRORS:", JSON.stringify(errs));
await app.close();
process.exit(0);
