import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-studio-rt-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const outDir = join(ROOT, "tests/screenshots/r18-studio-rt");
mkdirSync(outDir, { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
  const t = items.find((el) => (el.textContent ?? "").includes("个性化"));
  if (t) t.click();
});
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === "打开");
  b?.click();
});
await page.waitForTimeout(1500);

// Find "保存" (save) button
const allButtons = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim()).filter(Boolean);
});
console.log("BUTTONS:", JSON.stringify(allButtons.slice(0, 30)));

// Move the bg-primary L slider
await page.evaluate(() => {
  const sliders = Array.from(document.querySelectorAll("input[type='range']"));
  // bg-primary L is around index 1 (font-size is 0, bg-primary L is 1)
  const s = sliders[1];
  s.value = "0.5";  // way off from 0.985
  s.dispatchEvent(new Event("input", { bubbles: true }));
  s.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(800);
const beforeSave = await page.evaluate(() => ({
  bgPrimary: getComputedStyle(document.documentElement).getPropertyValue("--wb-bg-primary").trim(),
  dataThemeName: document.documentElement.getAttribute("data-theme-name"),
}));
console.log("BEFORE_SAVE:", JSON.stringify(beforeSave));
await page.screenshot({ path: join(outDir, "before-save.png") });

// Click save
const saveClicked = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll("button"));
  const candidates = ["保存", "Save", "保存为", "save as"];
  for (const c of candidates) {
    const btn = buttons.find((b) => (b.textContent ?? "").trim() === c || (b.textContent ?? "").includes(c));
    if (btn) { btn.click(); return c; }
  }
  return null;
});
console.log("SAVE_CLICKED:", saveClicked);
await page.waitForTimeout(800);

const afterSave = await page.evaluate(() => {
  const all = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k?.startsWith("openbuddy.theme.custom")) all[k] = window.localStorage.getItem(k);
  }
  return all;
});
console.log("AFTER_SAVE_LOCALSTORAGE:", JSON.stringify(afterSave, null, 2));

await app.close();
process.exit(0);
