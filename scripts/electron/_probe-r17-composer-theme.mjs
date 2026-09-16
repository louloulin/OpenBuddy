import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17ct-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.addInitScript(() => {
  window.__ERR__ = [];
  window.addEventListener("error", (e) => window.__ERR__.push(String(e.message ?? e)));
  window.addEventListener("unhandledrejection", (e) => window.__ERR__.push("UR:" + String(e.reason?.message ?? e.reason)));
});
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e.message).slice(0, 200)));
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

async function snapshotComposer(label) {
  const info = await page.evaluate(() => {
    const composer = document.querySelector(".wb-composer");
    if (!composer) return { found: false };
    const cs = getComputedStyle(composer);
    const input = composer.querySelector(".wb-composer__input");
    const inpCs = input ? getComputedStyle(input) : null;
    const hint = composer.querySelector(".wb-composer__setup-hint");
    const hintCs = hint ? getComputedStyle(hint) : null;
    const setupHintVisible = hint && getComputedStyle(hint).display !== "none" && (hint.textContent ?? "").trim().length > 0;
    const placeholder = inpCs?.color ?? null;
    const placeholderColor = input ? (() => {
      try {
        // pseudo-element color via getComputedStyle works in modern Chromium
        const style = getComputedStyle(input, "::placeholder");
        return style.color;
      } catch (e) { return null; }
    })() : null;
    return {
      found: true,
      composerBg: cs.backgroundColor,
      composerBorder: cs.borderColor,
      composerBoxShadow: cs.boxShadow,
      composerColor: cs.color,
      inputColor: inpCs?.color,
      inputBg: inpCs?.backgroundColor,
      inputFontSize: inpCs?.fontSize,
      hintText: setupHintVisible ? hint.textContent?.trim() : null,
      hintColor: hintCs?.color,
      hintBg: hintCs?.backgroundColor,
      placeholderColor,
      dataTheme: document.documentElement.getAttribute("data-theme"),
    };
  });
  console.log(label, JSON.stringify(info, null, 2));
  return info;
}

async function setTheme(mode) {
  // Use settings → 个性化 buttons
  await page.click(".sidebar__icon-btn[aria-label='设置']");
  await page.waitForTimeout(1500);
  // personalize
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
    const t = items.find((el) => (el.textContent ?? "").includes("个性化"));
    if (t) t.click();
  });
  await page.waitForTimeout(1000);
  // light / dark button
  await page.evaluate((m) => {
    const buttons = Array.from(document.querySelectorAll(".theme-toggle__btn"));
    const target = buttons.find((b) => (b.textContent ?? "").includes(m));
    if (target) target.click();
  }, mode === "light" ? "浅色" : "深色");
  await page.waitForTimeout(1200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
}

// Default theme is likely system — switch to light
await setTheme("light");
await snapshotComposer("LIGHT:");
await page.screenshot({ path: join(ROOT, "tests/screenshots/r17-composer-light.png"), fullPage: false });

await setTheme("dark");
await snapshotComposer("DARK:");
await page.screenshot({ path: join(ROOT, "tests/screenshots/r17-composer-dark.png"), fullPage: false });

console.log("ERRS:", JSON.stringify(await page.evaluate(() => window.__ERR__ ?? [])));
await app.close();
process.exit(0);
