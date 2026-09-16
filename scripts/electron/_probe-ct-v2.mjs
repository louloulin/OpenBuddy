import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-ct2-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15_000);

async function dump(label) {
  const info = await page.evaluate(() => {
    const composer = document.querySelector(".wb-composer");
    const input = composer?.querySelector(".wb-composer__input");
    const inpCs = input ? getComputedStyle(input) : null;
    const cs = composer ? getComputedStyle(composer) : null;
    return {
      found: !!composer,
      dataTheme: document.documentElement.getAttribute("data-theme"),
      dataThemeName: document.documentElement.getAttribute("data-theme-name"),
      composerBg: cs?.backgroundColor,
      composerColor: cs?.color,
      inputBg: inpCs?.backgroundColor,
      inputColor: inpCs?.color,
    };
  });
  console.log(label, JSON.stringify(info));
  return info;
}

await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

console.log("=== INITIAL ===");
await dump("INIT:");

// Open settings via sidebar button (icon)
await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(2000);

// Click 个性化
const hasPersonalize = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
  return items.find((el) => (el.textContent ?? "").includes("个性化"))?.outerHTML?.slice(0, 200);
});
console.log("PERSONALIZE_FOUND:", hasPersonalize);

await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
  const t = items.find((el) => (el.textContent ?? "").includes("个性化"));
  if (t) t.click();
});
await page.waitForTimeout(1500);

// List theme-toggle buttons
const btns = await page.evaluate(() => {
  return Array.from(document.querySelectorAll(".theme-toggle__btn")).map((b) => ({
    text: b.textContent?.trim(),
    active: b.className.includes("--active"),
    visible: getComputedStyle(b).display !== "none",
  }));
});
console.log("BUTTONS:", JSON.stringify(btns));

// Click 浅色
console.log("--- click 浅色 ---");
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll(".theme-toggle__btn")).find((b) => (b.textContent ?? "").includes("浅色"));
  b?.click();
});
await page.waitForTimeout(1500);
await dump("LIGHT:");
await page.screenshot({ path: join(ROOT, "tests/screenshots/r17b-composer-light.png"), fullPage: false });

console.log("--- click 深色 ---");
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll(".theme-toggle__btn")).find((b) => (b.textContent ?? "").includes("深色"));
  b?.click();
});
await page.waitForTimeout(1500);
await dump("DARK:");
await page.screenshot({ path: join(ROOT, "tests/screenshots/r17b-composer-dark.png"), fullPage: false });

await app.close();
process.exit(0);
