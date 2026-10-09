import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17co-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e.message).slice(0, 200)));
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

// Switch to dark
await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(1500);
await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
    const t = items.find((el) => (el.textContent ?? "").includes("个性化"));
    if (t) t.click();
  });
await page.waitForTimeout(900);
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll(".theme-toggle__btn"));
  const target = buttons.find((b) => (b.textContent ?? "").includes("深色"));
  if (target) target.click();
});
await page.waitForTimeout(1200);
await page.keyboard.press("Escape");
await page.waitForTimeout(800);

// Check settings input still has dark bg (sanity check my exclusions didn't break it)
const settingsInputBg = await page.evaluate(async () => {
  document.querySelector(".sidebar__icon-btn[aria-label='设置']")?.click();
  await new Promise((r) => setTimeout(r, 1200));
  const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
  const t = items.find((el) => (el.textContent ?? "").includes("账户管理"));
  if (t) t.click();
  await new Promise((r) => setTimeout(r, 1500));
  const inputs = Array.from(document.querySelectorAll(".settings-modal input"));
  const sample = inputs.slice(0, 3).map((el) => ({
    type: (el).type,
    bg: getComputedStyle(el).backgroundColor,
    color: getComputedStyle(el).color,
  }));
  document.body.click();
  return sample;
});
console.log("SETTINGS INPUTS:", JSON.stringify(settingsInputBg, null, 2));

// Check composer + autocomplete visually
await page.waitForTimeout(500);
const composer = await page.evaluate(() => {
  const c = document.querySelector(".wb-composer");
  const i = document.querySelector(".wb-composer__input");
  const h = document.querySelector(".wb-composer__setup-hint");
  return {
    composerBg: c ? getComputedStyle(c).backgroundColor : null,
    inputBg: i ? getComputedStyle(i).backgroundColor : null,
    inputColor: i ? getComputedStyle(i).color : null,
    setupHintVisible: h && getComputedStyle(h).display !== "none",
    setupHintText: h ? h.textContent?.trim().slice(0, 50) : null,
    setupHintColor: h ? getComputedStyle(h).color : null,
  };
});
console.log("COMPOSER DARK:", JSON.stringify(composer, null, 2));

await page.screenshot({ path: join(ROOT, "tests/screenshots/r17-composer-dark-fixed.png"), fullPage: false });
await app.close();
process.exit(0);
