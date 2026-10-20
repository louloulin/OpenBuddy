import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-final-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));

const composerRect = { x: 331, y: 327, w: 938, h: 140 };
async function probeCard(theme) {
  await page.click(".sidebar__icon-btn[aria-label='设置']");
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
    const t = items.find((el) => (el.textContent ?? "").includes("个性化"));
    if (t) t.click();
  });
  await page.waitForTimeout(800);
  await page.evaluate((m) => {
    const b = Array.from(document.querySelectorAll(".theme-toggle__btn")).find((b) => (b.textContent ?? "").includes(m));
    b?.click();
  }, theme === "light" ? "浅色" : "深色");
  await page.waitForTimeout(1200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  const info = await page.evaluate((r) => {
    const composer = document.querySelector(".wb-composer");
    const input = composer?.querySelector(".wb-composer__input");
    const cs = composer ? getComputedStyle(composer) : null;
    const inpCs = input ? getComputedStyle(input) : null;
    return {
      dataTheme: document.documentElement.getAttribute("data-theme"),
      composerBg: cs?.backgroundColor,
      composerBorderColor: cs?.borderColor,
      composerBorderRadius: cs?.borderRadius,
      composerBoxShadow: cs?.boxShadow,
      composerPadding: cs?.padding,
      inputBg: inpCs?.backgroundColor,
      inputColor: inpCs?.color,
      inputPlaceholderColor: (() => { try { return getComputedStyle(input, "::placeholder").color; } catch { return null; } })(),
      composerRect: r,
    };
  }, composerRect);
  await page.screenshot({
    path: join(ROOT, `tests/screenshots/r17d-final-${theme}.png`),
    clip: { x: composerRect.x - 20, y: composerRect.y - 20, width: composerRect.w + 40, height: composerRect.h + 80 },
  });
  return info;
}

const light = await probeCard("light");
console.log("LIGHT:", JSON.stringify(light, null, 2));
const dark = await probeCard("dark");
console.log("DARK:", JSON.stringify(dark, null, 2));

console.log("PAGE_ERRORS:", JSON.stringify(errs));
await app.close();
process.exit(0);
